const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const dotenv = require('dotenv');

dotenv.config({ path: './email-details.config' });

const app = express();

// Middleware for parsing JSON requests
app.use(bodyParser.json());

// Define the path for the CSV file
const csvFilePath = path.join(__dirname, 'bounces_detailed.csv');

// Create the CSV file with headers if it doesn't exist
if (!fs.existsSync(csvFilePath)) {
    fs.writeFileSync(csvFilePath, 'Bounced Email,Timestamp,Source Email,Source IP\n');
}

// Handle SNS notifications
app.post('/sns', (req, res) => {
    try {
        const message = req.body;
        console.log(message);

        if (message.notificationType === 'Bounce') {
            const bounce = message.bounce;
            const mail = message.mail;

            const bouncedEmail = bounce.bouncedRecipients[0].emailAddress;
            const timestamp = bounce.timestamp;
            const sourceEmail = mail.source;
            const sourceIp = mail.sourceIp;

            const csvData = `${bouncedEmail},${timestamp},${sourceEmail},${sourceIp}\n`;
            fs.appendFileSync(csvFilePath, csvData);
        } else if (message.Type === 'SubscriptionConfirmation') {
            const subscribeURL = message.SubscribeURL;
            console.log('Subscription confirmation received. Visiting:', subscribeURL);

    

            //Log the URL for manual confirmation
            console.log('Please visit the following URL to confirm subscription:', subscribeURL);
        }

        res.status(200).json({ message: 'Notification processed' });
    } catch (error) {
        console.error('Error processing notification:', error);
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

    // Clean up old entries
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const lines = fs.readFileSync(csvFilePath, 'utf8').split('\n');
    const filteredLines = lines.filter(line => {
        const timestamp = line.split(',')[1];
        const timestampDate = new Date(timestamp);
        return timestampDate > thirtyDaysAgo;
    });

    fs.writeFileSync(csvFilePath, filteredLines.join('\n'));
});

// Start the server
const PORT = 5001;
app.listen(PORT, () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});