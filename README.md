# ses-bounces-handler

This is a simple HTTP Server to Handle API requests from Amazon SNS for SES Email Bounces. It exposes an api endpoint for receiving HTTP requests from SNS, and stores the bounce details in a CSV file. This CSV file is emailed every night to specified email addresses, and it can also be accessed via an API end point.


<h1>API Endpoints Available</h1>
## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/sns` | POST | Called by Amazon SNS to post the Subscribe and Bounce events |
| `/download` | GET | Downlod the last 30 days of Bounce data in CSV format |




<h1> Installing the Script using NPM </h1>
Ensure you gave Node and NPM installed.
Enter the directory where this script is cloned.
```
npm install -g yarn
npm install
```

Make sure you update the file "email-details.conf" with your SMTP server details and recipient email address.


<h1>Running the Server</h1>
To run your script on a Linux server so it keeps running after you close the terminal, follow these steps:

### 1. **Use `nohup` to Run the Script**
`nohup` allows the process to continue running in the background even after the terminal is closed.

Run the script as follows:
```bash
nohup node path/to/your/script.js > output.log 2> error.log &
```

- **`output.log`**: Captures the standard output of your script.
- **`error.log`**: Captures the standard error (errors and logs sent via `console.error`).
- **`&`**: Runs the process in the background.

### 2. **View the Logs**
You can monitor the logs at any time:
- Standard output: `tail -f output.log`
- Errors: `tail -f error.log`

### 3. **Stop the Process**
To stop the script, find its process ID (PID) using:
```bash
ps aux | grep node
```
Then kill the process:
```bash
kill <PID>
```

### 4. **Alternative: Use a Process Manager (Optional)**
Using a process manager like **PM2** or **systemd** provides better management for scripts. PM2 is particularly user-friendly for Node.js applications:

#### Install PM2:
```bash
npm install -g pm2
```

#### Start the Script:
```bash
pm2 start path/to/your/script.js --name sns-ses-handler
```

#### Check Logs:
```bash
pm2 logs sns-ses-handler
```

#### Ensure Auto-Restart:
Enable PM2 to start the script automatically on server boot:
```bash
pm2 startup
pm2 save
```

This approach ensures reliability and ease of monitoring. Let me know if you want detailed steps for setting up PM2 or using another method.