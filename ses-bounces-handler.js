const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const dotenv = require('dotenv');
const axios = require('axios');

dotenv.config({ path: './email-details.config' });

const app = express();

// Middleware for parsing JSON requests
app.use(bodyParser.json());
// Middleware for parsing text/plain requests
app.use(bodyParser.text({ type: 'text/plain' }));

// Define the path for the CSV file
const csvFilePath = path.join(__dirname, 'bounces_detailed.csv');

// Create the CSV file with headers if it doesn't exist
if (!fs.existsSync(csvFilePath)) {
    fs.writeFileSync(csvFilePath, 'Bounced Email,Timestamp,Source Email,Source IP\n');
}

app.post('/sns', (req, res) => {
    try {
        console.log("Inside the POST /sns block");

        let snsMessage;

        if (req.is('application/json')) {
            console.log("Received a application/json request");
            snsMessage = req.body; // Direct JSON parsing
            //console.log('Raw SNS Message (application/json):', JSON.stringify(snsMessage, null, 2));

            // Debug: Log the raw Message content
            //console.log('Raw Message:', snsMessage.Message);

            // Try multiple parsing strategies
            let messageContent;
            try {
                // First, try direct parsing
                messageContent = JSON.parse(snsMessage.Message);
                console.log('Parsed Message Object:', messageContent);
            } catch (directParseError) {
                try {
                    // If that fails, try parsing after removing extra quotes and escaping
                    messageContent = JSON.parse(snsMessage.Message.replace(/\\"/g, '"').replace(/^"|"$/g, ''));
                    console.log('Parsed Message Object with Replace:', messageContent);
                } catch (escapedParseError) {
                    // If both fail, try parsing the original message content
                    try {
                        messageContent = JSON.parse(JSON.parse(snsMessage.Message));
                        console.log('Double Parsed Message Object:', messageContent);
                    } catch (nestedParseError) {
                        console.error("Failed to parse Message content through multiple strategies:", {
                            directParseError,
                            escapedParseError,
                            nestedParseError
                        });
                        return res.status(400).json({ error: 'Unable to parse Message content', details: snsMessage.Message });
                    }
                }
            }

            //console.log('Parsed Message Content:', JSON.stringify(messageContent, null, 2));

            console.log("Notification Type : "+messageContent.notificationType);

            // Rest of your existing processing logic...
            if (messageContent.notificationType === 'Bounce') {
                const { bounce, mail } = messageContent;

                if (bounce && mail && Array.isArray(bounce.bouncedRecipients) && bounce.bouncedRecipients.length > 0) {
                    bounce.bouncedRecipients.forEach(recipient => {
                        const bouncedEmail = recipient.emailAddress;
                        const timestamp = bounce.timestamp;
                        const sourceEmail = mail.source;
                        const sourceIp = mail.sourceIp;

                        const csvData = `"${bouncedEmail}","${timestamp}","${sourceEmail}","${sourceIp}"\n`;
                        fs.appendFileSync(csvFilePath, csvData);
                    });

                    console.log('Bounce data saved successfully.');
                } else {
                    console.log('Invalid bounce or mail data.');
                }
            } else {
                console.log('Notification type is not Bounce.');
            }

            res.status(200).json({ message: 'Notification processed' });
        } else {
            throw new Error('Unsupported Content-Type');
        }
    } catch (error) {
        console.error('Error processing notification:', error.message);
        console.error('Stack Trace:', error.stack);
        res.status(500).json({ error: error.message });
    }
});


// Endpoint to download the CSV file
app.get('/download', (req, res) => {
    if (fs.existsSync(csvFilePath)) {
        res.download(csvFilePath);
    } else {
        res.status(404).json({ error: 'CSV file not found' });
    }
});


// Schedule email with bounced emails every midnight
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD
    }
});

cron.schedule('0 0 * * *', () => {
    if (fs.existsSync(csvFilePath)) {
        const csvContent = fs.readFileSync(csvFilePath, 'utf8');
        const lines = csvContent.split('\n');
        
        // Calculate 24 hours ago
        const twentyFourHoursAgo = new Date();
        twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

        // Filter lines from the last 24 hours
        const filteredLines = lines.filter((line, index) => {
            if (index === 0) return true; // Keep header
            if (line.trim() === '') return false; // Skip empty lines
            
            const timestamp = line.split(',')[1].replace(/"/g, '');
            const lineDate = new Date(timestamp);
            
            return lineDate > twentyFourHoursAgo;
        });

        // If no data in last 24 hours, skip email
        if (filteredLines.length <= 1) {
            console.log('No bounce data in the last 24 hours. Skipping email.');
            return;
        }

        // Create CSV for the last 24 hours
        const last24HoursCsv = filteredLines.join('\n');

        const mailOptions = {
            from: process.env.EMAIL_FROM,
            to: process.env.EMAIL_TO,
            subject: 'Daily Bounced Emails Report',
            text: 'Attached is the bounced email report for the last 24 hours.',
            attachments: [
                {
                    filename: `bounces_${new Date().toISOString().split('T')[0]}.csv`,
                    content: last24HoursCsv
                }
            ]
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.error('Error sending email:', error);
            } else {
                console.log('Email sent:', info.response);
            }
        });
    }

    // Existing backup and cleanup logic remains the same
    const backupPath = `${csvFilePath}.${Date.now()}.backup`;
    fs.copyFileSync(csvFilePath, backupPath);

    // Clean up old entries (older than 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const allLines = fs.readFileSync(csvFilePath, 'utf8').split('\n');
    const retainedLines = allLines.filter((line, index) => {
        if (index === 0) return true; // Preserve header
        const timestamp = line.split(',')[1].replace(/"/g, '');
        if (!timestamp) return false; // Handle potential empty lines
        const timestampDate = new Date(timestamp);
        return timestampDate > thirtyDaysAgo;
    });

    fs.writeFileSync(csvFilePath, retainedLines.join('\n'));

    console.log('Cleanup completed. Backup saved to:', backupPath);
});

// Start the server
const PORT = 5001;
app.listen(PORT, () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});
