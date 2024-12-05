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

        if (req.is('text/plain')) {
            // Log raw body for debugging
            //console.log('Raw SNS Message (text/plain):', req.body);
            console.log ("Received a text/plain request");
            // Replace invalid single quotes and parse as JSON-like object
            const sanitizedBody = req.body.replace(/([a-zA-Z0-9_]+):/g, '"$1":').replace(/'/g, '"');
            console.log('Sanitized Body:', sanitizedBody);

            snsMessage = JSON.parse(sanitizedBody); // Parses fixed JSON
        } else if (req.is('application/json')) {
            //console.log('Raw SNS Message (application/json):', req.body);
            console.log ("Received a application/json request");
            snsMessage = req.body; // Direct JSON parsing
        } else {
            throw new Error('Unsupported Content-Type');
        }

        console.log('Parsed SNS Message:', snsMessage);

        // Parse the `Message` field, which is a stringified JSON
        //const messageContent = JSON.parse(snsMessage.Message);
        messageContent = snsMessage.Message;
        //console.log('Parsed Message Content:', messageContent);

        console.log("****************************");
        console.log("Notification Type: "+messageContent.notificationType);
        console.log("****************************");

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

// Confirm subscription
app.get('/sns', async (req, res) => {
    console.log("Inside the GET /sns block");
    try {
        const subscribeURL = req.query['SubscribeURL'];
        if (subscribeURL) {
            console.log('Subscription confirmation received. Visiting:', subscribeURL);
            await axios.get(subscribeURL);
        }
        res.sendStatus(200);
    } catch (error) {
        console.error('Error processing subscription confirmation:', error);
        res.status(500).send('Error processing request');
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

        // Check if the file contains data other than headers
        const dataLines = csvContent.split('\n').slice(1).filter(line => line.trim() !== '');
        if (dataLines.length === 0) {
            console.log('No data to send. Skipping email.');
            return;
        }

        const mailOptions = {
            from: process.env.EMAIL_FROM,
            to: process.env.EMAIL_TO,
            subject: 'Daily Bounced Emails Report',
            text: 'Attached is the bounced email report for the last 24 hours.',
            attachments: [
                {
                    filename: 'bounces_detailed.csv',
                    content: csvContent
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

    // Backup the file before cleanup
    const backupPath = `${csvFilePath}.${Date.now()}.backup`;
    fs.copyFileSync(csvFilePath, backupPath);

    // Clean up old entries (older than 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const lines = fs.readFileSync(csvFilePath, 'utf8').split('\n');
    const filteredLines = lines.filter((line, index) => {
        if (index === 0) return true; // Preserve header
        const timestamp = line.split(',')[1];
        if (!timestamp) return false; // Handle potential empty lines
        const timestampDate = new Date(timestamp);
        return timestampDate > thirtyDaysAgo;
    });

    fs.writeFileSync(csvFilePath, filteredLines.join('\n'));

    console.log('Cleanup completed. Backup saved to:', backupPath);
});

// Start the server
const PORT = 5001;
app.listen(PORT, () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});
