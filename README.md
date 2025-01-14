# SES Bounces Handler

This is a Node.js server that handles Amazon Simple Email Service (SES) bounce notifications via Amazon SNS. It stores bounce details in a CSV file, sends daily email reports, and provides an API endpoint for downloading bounce data.

## Features

- Processes SES bounce notifications from SNS
- Stores bounce data in CSV format
- Sends daily email reports with bounce statistics
- Maintains compressed backups of bounce data
- Automatically cleans up old data based on retention policy
- Rate limiting for API endpoints
- File locking for concurrent write operations

## API Endpoints

| Endpoint | Method | Description |
|----------|---------|-------------|
| `/sns` | POST | Receives bounce notifications from Amazon SNS |
| `/download` | GET | Downloads bounce data in CSV format |

## Prerequisites

- Node.js (>= 14.0.0)
- PM2 (for process management)
- SMTP server access for sending reports

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd ses-bounces-handler
```

2. Install dependencies:
```bash
npm install
```

3. Create required directories:
```bash
mkdir -p data backups
```

4. Create .env file:
```bash
cat > .env << EOF
PORT=5001
SMTP_HOST=your_smtp_host
SMTP_PORT=your_smtp_port
SMTP_USER=your_smtp_user
SMTP_PASSWORD=your_smtp_password
SMTP_SECURE=true
EMAIL_FROM=sender@example.com
EMAIL_TO=recipient@example.com
DATA_RETENTION_DAYS=7
NODE_ENV=production
EOF
```

## Running with PM2

1. Install PM2 globally if not already installed:
```bash
npm install -g pm2
```

2. Start the service:
```bash
pm2 start ses-bounces-handler.js --name sns-ses-handler
```

3. Monitor the service:
```bash
# View logs
pm2 logs sns-ses-handler

# Monitor process
pm2 monit sns-ses-handler

# View status
pm2 status
```

4. Configure auto-restart on system boot:
```bash
pm2 startup
pm2 save
```

5. Common PM2 commands:
```bash
# Restart service
pm2 restart sns-ses-handler

# Stop service
pm2 stop sns-ses-handler

# Delete service
pm2 delete sns-ses-handler
```

## Amazon SNS Configuration

1. In your SNS topic subscription:
   - Go to the subscription settings
   - Expand "Subscription details"
   - Click "Edit"

2. Configure delivery settings:
   - Under "Delivery policy (HTTP/S)" section:
   - Uncheck "Use default delivery policy"
   - Set "Content type" to: `application/json`
   - Save changes

3. Verify the endpoint:
   - SNS will send a subscription confirmation request
   - The server will automatically handle the confirmation

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| PORT | Server port | 5001 |
| SMTP_HOST | SMTP server hostname | smtp.gmail.com |
| SMTP_PORT | SMTP server port | 587 |
| SMTP_USER | SMTP username | user@example.com |
| SMTP_PASSWORD | SMTP password | your_password |
| SMTP_SECURE | Use SSL/TLS | true |
| EMAIL_FROM | Sender email address | sender@example.com |
| EMAIL_TO | Report recipient(s) | recipient@example.com |
| DATA_RETENTION_DAYS | Days to keep bounce data | 7 |
| NODE_ENV | Environment (development/production) | production |

## Data Management

- Bounce data is stored in `data/bounces_detailed.csv`
- Daily backups are created in `backups/YYYY-MM-DD/`
- Backups are compressed using gzip
- Data older than DATA_RETENTION_DAYS is automatically removed
- Daily email reports include only last 24 hours of bounce data

## Troubleshooting

1. Check PM2 logs:
```bash
pm2 logs sns-ses-handler --lines 100
```

2. Verify service status:
```bash
pm2 status
```

3. Check system logs:
```bash
tail -f /var/log/syslog | grep sns-ses-handler
```

4. Common issues:
   - SMTP connection failures: Check credentials and firewall settings
   - Permission errors: Ensure proper directory permissions
   - SNS verification failures: Verify SNS topic configuration

## Security Considerations

- The `/download` endpoint is publicly accessible; consider adding authentication
- SMTP credentials are stored in .env file; ensure proper file permissions
- SNS message verification is implemented but should be enhanced for production
- Rate limiting is enabled to prevent abuse

## Maintenance

- Monitor disk space usage
- Regularly check email delivery success
- Review bounce patterns for potential issues
- Update dependencies periodically for security patches
