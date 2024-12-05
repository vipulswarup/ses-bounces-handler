# ses-bounces-handler
Simple HTTP Server to Handle API requests from Amazon SNS for SES Email Bounces

npm install -g yarn
npm install



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