
# VPS Deployment Guide

## Quick Installation

1. **Download and run the installation script:**
   ```bash
   curl -o install.sh https://raw.githubusercontent.com/your-repo/outlook-automation/main/install.sh
   chmod +x install.sh
   ./install.sh
   ```

2. **Follow the interactive prompts to configure:**
   - Azure credentials (required)
   - Admin token (required)
   - Telegram Bot (optional)
   - Server settings

3. **Start the application:**
   ```bash
   npm start
   ```

## Manual Installation

If you prefer to configure manually:

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-repo/outlook-automation.git
   cd outlook-automation
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Create .env file:**
   ```bash
   cp .env.sample .env
   nano .env
   ```

4. **Configure environment variables:**
   ```env
   # Microsoft Azure Configuration
   AZURE_CLIENT_ID=your-azure-client-id-here
   AZURE_CLIENT_SECRET=your-azure-client-secret-here
   AZURE_TENANT_ID=your-tenant-id-or-common
   AZURE_REDIRECT_URI=https://your-domain.com/api/auth-callback

   # Admin Access Configuration
   ADMIN_TOKEN=your-strong-admin-password-here

   # Telegram Bot Configuration (Optional)
   TELEGRAM_BOT_TOKEN=your-telegram-bot-token-here
   ADMIN_CHAT_IDS=your-telegram-chat-id-here

   # Server Configuration
   PORT=5000
   ```

## Telegram Bot Setup (Optional)

The Telegram Bot provides:
- Real-time login notifications
- Admin token retrieval
- Remote admin panel access

### Setup Steps:

1. **Create a Telegram Bot:**
   - Message @BotFather on Telegram
   - Send `/newbot`
   - Follow the instructions to create your bot
   - Copy the bot token

2. **Get your Chat ID:**
   - Start a chat with your new bot
   - Send any message
   - Visit: `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
   - Find your chat ID in the response

3. **Configure in .env:**
   ```env
   TELEGRAM_BOT_TOKEN=1234567890:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
   ADMIN_CHAT_IDS=123456789
   ```

## Production Setup

### Using PM2 (Recommended)

1. **Install PM2:**
   ```bash
   npm install -g pm2
   ```

2. **Start with PM2:**
   ```bash
   pm2 start server.js --name "outlook-automation"
   pm2 startup
   pm2 save
   ```

### Using systemd

1. **Create service file:**
   ```bash
   sudo nano /etc/systemd/system/outlook-automation.service
   ```

2. **Add service configuration:**
   ```ini
   [Unit]
   Description=Outlook Automation Service
   After=network.target

   [Service]
   Type=simple
   User=your-username
   WorkingDirectory=/path/to/outlook-automation
   ExecStart=/usr/bin/node server.js
   Restart=always
   RestartSec=10
   Environment=NODE_ENV=production

   [Install]
   WantedBy=multi-user.target
   ```

3. **Enable and start:**
   ```bash
   sudo systemctl enable outlook-automation
   sudo systemctl start outlook-automation
   ```

## Reverse Proxy Setup (Nginx)

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## Security Considerations

- **Admin Token**: Use a strong, unique password
- **Telegram Bot**: Only share bot access with trusted users
- **Firewall**: Only expose necessary ports
- **HTTPS**: Use SSL certificates in production
- **Updates**: Keep dependencies updated regularly

## Troubleshooting

### Common Issues:

1. **Port already in use:**
   ```bash
   sudo lsof -i :5000
   sudo kill -9 <PID>
   ```

2. **Permission denied:**
   ```bash
   sudo chown -R $USER:$USER /path/to/outlook-automation
   ```

3. **Environment variables not loading:**
   - Check `.env` file exists and has correct permissions
   - Verify no spaces around `=` in `.env`

### Log Files:

- **PM2 logs:** `pm2 logs outlook-automation`
- **systemd logs:** `sudo journalctl -u outlook-automation -f`

## Support

For issues and questions:
- Check the logs first
- Verify environment variables are correctly set
- Ensure Azure app registration is properly configured
