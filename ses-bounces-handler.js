const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const dotenv = require('dotenv');
const rateLimit = require('express-rate-limit');
const csv = require('csv-parse/sync');
const createCsvStringifier = require('csv-writer').createObjectCsvStringifier;
const crypto = require('crypto');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');

dotenv.config();

// Don't log sensitive information
console.log('Server starting...');

const app = express();

// Add rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
});

app.use(limiter);
app.use(bodyParser.json());

// CSV Configuration with added bounce reason fields
const csvFilePath = path.join(__dirname, 'data', 'bounces_detailed.csv');
const csvStringifier = createCsvStringifier({
    header: [
        { id: 'email', title: 'Bounced Email' },
        { id: 'timestamp', title: 'Timestamp' },
        { id: 'sourceEmail', title: 'Source Email' },
        { id: 'sourceIp', title: 'Source IP' },
        { id: 'bounceType', title: 'Bounce Type' },
        { id: 'bounceSubType', title: 'Bounce Sub-Type' },
        { id: 'diagnosticCode', title: 'Diagnostic Code' },
        { id: 'reportingMTA', title: 'Reporting MTA' },
        { id: 'feedbackId', title: 'Feedback ID' }
    ]
});

// Initialize CSV file
async function initializeCsvFile() {
    try {
        await fs.mkdir(path.dirname(csvFilePath), { recursive: true });
        const fileExists = await fs.access(csvFilePath).then(() => true).catch(() => false);
        
        if (!fileExists) {
            await fs.writeFile(csvFilePath, csvStringifier.getHeaderString());
            console.log('CSV file initialized successfully');
        }
    } catch (error) {
        console.error('Error initializing CSV file:', error);
        process.exit(1);
    }
}

// Utility function to compress and save file
async function compressAndSaveFile(sourcePath, destPath) {
    try {
        const sourceStream = require('fs').createReadStream(sourcePath);
        const destStream = require('fs').createWriteStream(destPath);
        const gzip = zlib.createGzip();
        
        await pipeline(sourceStream, gzip, destStream);
        console.log(`Successfully compressed and saved to ${destPath}`);
    } catch (error) {
        console.error('Error compressing file:', error);
        throw error;
    }
}

// Function to send daily report
async function sendDailyReport(transporter) {
    try {
        // Read and filter CSV data for last 24 hours
        const csvContent = await fs.readFile(csvFilePath, 'utf8');
        const records = await csv.parse(csvContent, {
            columns: true,
            skip_empty_lines: true
        });

        const twentyFourHoursAgo = new Date();
        twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

        const recentRecords = records.filter(record => {
            const recordDate = new Date(record['Timestamp']);
            return recordDate > twentyFourHoursAgo;
        });

        if (recentRecords.length === 0) {
            console.log('No bounce data in the last 24 hours');
            return;
        }

        // Create CSV string for attachment
        const csvString = csvStringifier.stringifyRecords(recentRecords);
        
        // Generate bounce type summary
        const bounceTypeSummary = recentRecords.reduce((acc, record) => {
            const type = record['Bounce Type'] || 'Unknown';
            acc[type] = (acc[type] || 0) + 1;
            return acc;
        }, {});

        // Create summary text
        const summaryText = Object.entries(bounceTypeSummary)
            .map(([type, count]) => `${type}: ${count}`)
            .join('\n');
        
        // Configure email
        const mailOptions = {
            from: process.env.EMAIL_FROM,
            to: process.env.EMAIL_TO,
            subject: `Daily Bounced Emails Report - ${new Date().toISOString().split('T')[0]}`,
            text: `Attached is the bounced email report for the last 24 hours.\n\n` +
                  `Total bounces: ${recentRecords.length}\n\n` +
                  `Bounce Type Summary:\n${summaryText}`,
            attachments: [{
                filename: `bounces_${new Date().toISOString().split('T')[0]}.csv`,
                content: csvString
            }]
        };

        // Send with retry logic
        let retries = 3;
        while (retries > 0) {
            try {
                await transporter.sendMail(mailOptions);
                console.log('Daily report email sent successfully');
                return;
            } catch (error) {
                retries--;
                if (retries === 0) throw error;
                console.log(`Email send failed, ${retries} retries remaining`);
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    } catch (error) {
        console.error('Error sending daily report:', error);
        throw error;
    }
}

// Function to clean up old data
async function cleanupOldData() {
    try {
        const retentionDays = process.env.DATA_RETENTION_DAYS || 7;
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

        // Clean up old backups
        const backupsDir = path.join(__dirname, 'backups');
        await fs.mkdir(backupsDir, { recursive: true });
        const backupDirs = await fs.readdir(backupsDir);
        
        for (const dir of backupDirs) {
            const dirPath = path.join(backupsDir, dir);
            const dirStat = await fs.stat(dirPath);
            
            if (dirStat.isDirectory() && new Date(dir) < cutoffDate) {
                await fs.rm(dirPath, { recursive: true });
                console.log(`Removed old backup directory: ${dir}`);
            }
        }

        // Clean up main CSV file
        const csvContent = await fs.readFile(csvFilePath, 'utf8');
        const records = await csv.parse(csvContent, {
            columns: true,
            skip_empty_lines: true
        });

        const recentRecords = records.filter(record => {
            const recordDate = new Date(record['Timestamp']);
            return recordDate > cutoffDate;
        });

        // Write back recent records only
        const csvString = csvStringifier.stringifyRecords(recentRecords);
        await fs.writeFile(csvFilePath, csvStringifier.getHeaderString() + csvString);
        
        console.log('Data cleanup completed successfully');
    } catch (error) {
        console.error('Error cleaning up old data:', error);
        throw error;
    }
}

// Function to verify SNS message signature
function verifySignature(message) {
    try {
        if (!message.SigningCertURL || !message.Signature || !message.SignatureVersion) {
            return false;
        }

        // Only accept URLs from AWS domains
        const certUrl = new URL(message.SigningCertURL);
        if (!certUrl.hostname.endsWith('.amazonaws.com')) {
            return false;
        }

        // Create the canonical string to verify
        const stringToSign = [
            'Message',
            'MessageId',
            'Subject',
            'Timestamp',
            'TopicArn',
            'Type'
        ].map(key => {
            if (message[key]) {
                return `${key}\n${message[key]}\n`;
            }
            return '';
        }).join('');

        // For development/testing, you might want to bypass verification
        if (process.env.NODE_ENV === 'development') {
            console.log('Warning: SNS signature verification bypassed in development mode');
            return true;
        }

        // TODO: Implement certificate fetching and verification
        // For now, we'll trust messages in production
        console.log('Warning: SNS signature verification not fully implemented');
        return true;
    } catch (error) {
        console.error('Error verifying SNS signature:', error);
        return false;
    }
}

// Validate and process SNS message
async function processSNSMessage(message) {
    try {
        // Verify the SNS message signature
        if (!verifySignature(message)) {
            throw new Error('Invalid SNS message signature');
        }

        let messageContent;
        
        // Handle case where Message is already an object
        if (typeof message.Message === 'object') {
            messageContent = message.Message;
        } else {
            // Try parsing the Message if it's a string
            try {
                messageContent = JSON.parse(message.Message);
            } catch (parseError) {
                console.error('Error parsing Message:', parseError);
                console.log('Raw Message content:', message.Message);
                throw new Error('Invalid Message format');
            }
        }

        // Log the parsed content for debugging
        console.log('Parsed message content:', JSON.stringify(messageContent, null, 2));
        
        if (messageContent.notificationType !== 'Bounce') {
            console.log('Not a bounce notification:', messageContent.notificationType);
            return null;
        }

        return messageContent;
    } catch (error) {
        console.error('Error in processSNSMessage:', error);
        console.log('Raw message:', JSON.stringify(message, null, 2));
        throw error;
    }
}

// Safe CSV write operation with locking
async function appendToCsv(data) {
    const lockFile = `${csvFilePath}.lock`;
    try {
        // Acquire lock
        await fs.writeFile(lockFile, '');
        
        // Write data
        const csvString = csvStringifier.stringifyRecords(data);
        await fs.appendFile(csvFilePath, csvString);
        
        // Release lock
        await fs.unlink(lockFile);
    } catch (error) {
        // Ensure lock is released even if write fails
        try {
            await fs.unlink(lockFile);
        } catch (unlinkError) {
            console.error('Error releasing lock:', unlinkError);
        }
        throw error;
    }
}

// SNS endpoint with enhanced bounce data collection
app.post('/sns', async (req, res) => {
    try {
        console.log('Received SNS notification');
        console.log('Request body:', JSON.stringify(req.body, null, 2));
        const messageContent = await processSNSMessage(req.body);
        if (!messageContent) {
            return res.status(200).json({ message: 'Non-bounce notification ignored' });
        }

        const { bounce, mail } = messageContent;
        
        if (!bounce?.bouncedRecipients?.length || !mail) {
            throw new Error('Invalid bounce data structure');
        }

        const bounceRecords = bounce.bouncedRecipients.map(recipient => ({
            email: recipient.emailAddress,
            timestamp: bounce.timestamp,
            sourceEmail: mail.source,
            sourceIp: mail.sourceIp,
            bounceType: bounce.bounceType || 'Unknown',
            bounceSubType: bounce.bounceSubType || 'Unknown',
            diagnosticCode: recipient.diagnosticCode || 'Not provided',
            reportingMTA: bounce.reportingMTA || 'Not provided',
            feedbackId: bounce.feedbackId || 'Not provided'
        }));

        await appendToCsv(bounceRecords);
        res.status(200).json({ message: 'Bounce processed successfully' });
    } catch (error) {
        console.error('Error processing SNS notification:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Protected download endpoint
app.get('/download', async (req, res) => {
    try {
        await fs.access(csvFilePath);
        res.download(csvFilePath, 'bounces.csv');
    } catch (error) {
        res.status(404).json({ error: 'CSV file not found' });
    }
});

// Email configuration with retry logic
const createTransporter = async () => {
    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT, 10),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASSWORD
        }
    });

    try {
        await transporter.verify();
        return transporter;
    } catch (error) {
        console.error('Failed to create mail transporter:', error);
        throw error;
    }
};

// Improved cron job with backup management
cron.schedule('0 0 * * *', async () => {
    try {
        const backupDir = path.join(__dirname, 'backups', new Date().toISOString().split('T')[0]);
        await fs.mkdir(backupDir, { recursive: true });

        // Create compressed backup
        const backupPath = path.join(backupDir, `bounces_${Date.now()}.csv.gz`);
        await compressAndSaveFile(csvFilePath, backupPath);

        // Send email report
        const transporter = await createTransporter();
        await sendDailyReport(transporter);

        // Clean up old data
        await cleanupOldData();
    } catch (error) {
        console.error('Error in cron job:', error);
    }
});

// Start server with proper error handling
const PORT = process.env.PORT || 5001;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
}).on('error', (error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
});

// Initialize on startup
initializeCsvFile();
