// Import required libraries
const express = require('express'); // Web framework for building APIs
const mongoose = require('mongoose'); // MongoDB object modeling tool
const bodyParser = require('body-parser'); // Middleware for parsing request bodies
const nodemailer = require('nodemailer'); // Module for sending emails
const cron = require('node-cron'); // Library for scheduling tasks
const dotenv = require('dotenv'); // Module to manage environment variables
const rateLimit = require('express-rate-limit'); // Middleware to limit repeated requests
const createCsvStringifier = require('csv-writer').createObjectCsvStringifier; // For creating CSV strings

// Load environment variables from .env file
dotenv.config();

// Log message indicating server startup
console.log('Server starting...');

// Initialize Express app
const app = express();

// Set up rate limiting to prevent abuse
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes window
    max: 100 // Limit each IP to 100 requests per windowMs
});

// Apply middleware
app.use(limiter); // Apply rate limiting middleware
app.use(bodyParser.json()); // Parse JSON request bodies

// MongoDB connection string from environment variables
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('MongoDB connected successfully'))
    .catch(err => {
        console.error('MongoDB connection error:', err);
        process.exit(1);
    });

// Define Mongoose schema for Bounce records
const bounceSchema = new mongoose.Schema({
    email: String,
    timestamp: Date,
    sourceEmail: String,
    sourceIp: String,
    bounceType: String,
    bounceSubType: String,
    diagnosticCode: String,
    reportingMTA: String,
    feedbackId: String
});

// Create a model based on the schema
const Bounce = mongoose.model('Bounce', bounceSchema);

// CSV configuration for generating reports
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

// Function to send daily report via email with CSV attachment
async function sendDailyReport(transporter) {
    try {
        // Get records from the last 24 hours from MongoDB
        const twentyFourHoursAgo = new Date();
        twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);
        
        const recentRecords = await Bounce.find({ timestamp: { $gte: twentyFourHoursAgo } });
        
        console.log(`Recent records found for last 24 hours: ${recentRecords.length}`);

        if (recentRecords.length === 0) {
            console.log('No bounce data in the last 24 hours');
            return;
        }

        // Create CSV string for attachment using the recent records
        const csvString = csvStringifier.getHeaderString() + csvStringifier.stringifyRecords(recentRecords);
        
        // Generate a summary of bounce types for the email body
        const bounceTypeSummary = recentRecords.reduce((acc, record) => {
            const type = record.bounceType || 'Unknown';
            acc[type] = (acc[type] || 0) + 1;
            return acc;
        }, {});

        const summaryText = Object.entries(bounceTypeSummary)
            .map(([type, count]) => `${type}: ${count}`)
            .join('\n');

        // Configure email options
        const mailOptions = {
            from: process.env.EMAIL_FROM,
            to: process.env.EMAIL_TO,
            subject: `Daily Bounced Emails Report - ${new Date().toISOString().split('T')[0]}`,
            text: `Attached is the bounced email report for the last 24 hours.\n\n` +
                  `Total bounces: ${recentRecords.length}\n\n` +
                  `Bounce Type Summary:\n${summaryText}`,
            attachments: [{
                filename: `bounces_${new Date().toISOString().split('T')[0]}.csv`,
                content: csvString,
                contentType: 'text/csv'
            }]
        };

        // Send email with retry logic in case of failure
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
                await new Promise(resolve => setTimeout(resolve, 5000)); // Wait before retrying
            }
        }
    } catch (error) {
        console.error('Error sending daily report:', error);
    }
}

// Function to verify SNS message signature (placeholder for actual implementation)
function verifySignature(message) {
    try {
        if (!message.SigningCertURL || !message.Signature || !message.SignatureVersion) {
            return false; // Invalid message structure
        }

        const certUrl = new URL(message.SigningCertURL);
        
        if (!certUrl.hostname.endsWith('.amazonaws.com')) {
            return false; // Only accept URLs from AWS domains
        }

        // Create canonical string to verify here (not fully implemented)
        
        console.log('Warning: SNS signature verification not fully implemented');
        return true; // Trust messages in production for now (placeholder)
    } catch (error) {
        console.error('Error verifying SNS signature:', error);
        return false;
    }
}

// Validate and process incoming SNS message
async function processSNSMessage(message) {
    try {
        if (!verifySignature(message)) {
            throw new Error('Invalid SNS message signature');
        }

        let messageContent;

        if (typeof message.Message === 'object') {
            messageContent = message.Message;
        } else {
            try {
                messageContent = JSON.parse(message.Message); // Parse JSON string if necessary
            } catch (parseError) {
                console.error('Error parsing Message:', parseError);
                throw new Error('Invalid Message format');
            }
        }

        if (messageContent.notificationType !== 'Bounce') {
            console.log('Not a bounce notification:', messageContent.notificationType);
            return null; // Ignore non-bounce notifications
        }

        return messageContent; // Return parsed message content for further processing
    } catch (error) {
        console.error('Error in processSNSMessage:', error);
    }
}

// Add this endpoint after the existing /sns endpoint and before the server startup code

app.get('/download', async (req, res) => {
    try {
        // Query all records from MongoDB
        const allRecords = await Bounce.find({}).sort({ timestamp: -1 });

        if (allRecords.length === 0) {
            return res.status(404).json({ message: 'No bounce records found' });
        }

        // Generate CSV string using the existing csvStringifier
        const csvString = csvStringifier.getHeaderString() + csvStringifier.stringifyRecords(allRecords);

        // Set response headers for CSV download
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=bounce_records_${new Date().toISOString().split('T')[0]}.csv`);

        // Send the CSV data
        res.send(csvString);

        console.log(`CSV download completed - ${allRecords.length} records`);
    } catch (error) {
        console.error('Error generating CSV download:', error);
        res.status(500).json({ error: 'Internal server error while generating CSV' });
    }
});

// Append bounce data to MongoDB collection and send response back to SNS
app.post('/sns', async (req, res) => {
    try {
        console.log('Received SNS notification');
        
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
            timestamp: new Date(bounce.timestamp),
            sourceEmail: mail.source,
            sourceIp: mail.sourceIp,
            bounceType: bounce.bounceType || 'Unknown',
            bounceSubType: bounce.bounceSubType || 'Unknown',
            diagnosticCode: recipient.diagnosticCode || 'Not provided',
            reportingMTA: bounce.reportingMTA || 'Not provided',
            feedbackId: bounce.feedbackId || 'Not provided'
        }));

        await Bounce.insertMany(bounceRecords); // Insert records into MongoDB collection

        res.status(200).json({ message: 'Bounce processed successfully' });
    } catch (error) {
        console.error('Error processing SNS notification:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Create transporter for sending emails using nodemailer
const createTransporter = async () => {
    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT, 10),
        secure: process.env.SMTP_SECURE === 'true',
         auth:{
             user : process.env.SMTP_USER,
             pass : process.env.SMTP_PASSWORD 
         }
     });

     try{
         await transporter.verify();
         return transporter; 
     }catch(error){
         console.error("Failed to create mail transporter:", error);
         throw error;
     }
};

// Schedule a cron job to run every day at midnight 
cron.schedule('0 0 * * *', async () => {
    try{
       const transporter= await createTransporter(); 
       await sendDailyReport(transporter); 
     }catch(error){
         console.error("Error in cron job:", error); 
     }
});

// Start server and listen on specified port 
const PORT= process.env.PORT || 5001; 
app.listen(PORT, () =>{ 
   console.log(`Server running on http://localhost:${PORT}`); 
}).on("error",(error)=>{ 
   console.error("Failed to start server:", error); 
   process.exit(1); 
});
