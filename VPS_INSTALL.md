
# VPS Installation Guide

## System Requirements

- **OS**: Ubuntu 20.04+ / CentOS 8+ / Debian 10+
- **RAM**: Minimum 2GB (4GB recommended)
- **Storage**: 5GB available space
- **Node.js**: 18.x or higher
- **Chrome/Chromium**: For browser automation

## Quick Installation

### 1. Install Dependencies

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install -y nodejs npm git chromium-browser

# CentOS/RHEL
sudo yum install -y nodejs npm git chromium

# Or install Node.js 18+ manually
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### 2. Clone and Setup Project

```bash
# Clone the project
git clone <your-repo-url> outlook-automation
cd outlook-automation

# Install npm dependencies
npm install

# Make session data directory
mkdir -p session_data
chmod 755 session_data
```

### 3. Configure Environment Variables

```bash
# Copy environment template
cp .env.sample .env

# Edit configuration
nano .env
```

**Required Configuration (.env file):**
```bash
# Server Configuration
PORT=5000
NODE_ENV=production

# Azure App Registration (for Microsoft Graph API)
AZURE_CLIENT_ID=your_client_id_here
AZURE_CLIENT_SECRET=your_client_secret_here
AZURE_TENANT_ID=your_tenant_id_here
AZURE_REDIRECT_URI=https://yourdomain.com/api/auth-callback

# Admin Access (IMPORTANT!)
ADMIN_TOKEN=your_secure_admin_token_here

# Telegram Notifications (Optional)
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here

# Browser Automation
CHROMIUM_PATH=/usr/bin/chromium-browser
```

### 4. Setup Reverse Proxy (Nginx)

```bash
# Install Nginx
sudo apt install nginx

# Create site configuration
sudo nano /etc/nginx/sites-available/outlook-automation
```

**Nginx Configuration:**
```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }
}
```

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/outlook-automation /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### 5. Setup SSL with Let's Encrypt

```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx

# Get SSL certificate
sudo certbot --nginx -d yourdomain.com

# Auto-renewal
sudo crontab -e
# Add: 0 12 * * * /usr/bin/certbot renew --quiet
```

### 6. Create Systemd Service

```bash
sudo nano /etc/systemd/system/outlook-automation.service
```

**Service Configuration:**
```ini
[Unit]
Description=Outlook Automation Service
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/path/to/outlook-automation
Environment=NODE_ENV=production
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=outlook-automation

[Install]
WantedBy=multi-user.target
```

```bash
# Enable and start service
sudo systemctl daemon-reload
sudo systemctl enable outlook-automation
sudo systemctl start outlook-automation
sudo systemctl status outlook-automation
```

## Security Configuration

### 1. Firewall Setup

```bash
# UFW Firewall
sudo ufw enable
sudo ufw allow ssh
sudo ufw allow 80
sudo ufw allow 443
sudo ufw deny 5000  # Block direct access to app port
```

### 2. Secure Admin Access

**Important**: Change the default admin token!

```bash
# Generate secure admin token
openssl rand -hex 32

# Add to .env file
echo "ADMIN_TOKEN=your_generated_token_here" >> .env
```

### 3. File Permissions

```bash
# Set proper permissions
sudo chown -R www-data:www-data /path/to/outlook-automation
sudo chmod 600 .env
sudo chmod 755 session_data
```

## Azure App Registration

### 1. Create Azure App

1. Go to [Azure Portal](https://portal.azure.com)
2. Navigate to "Azure Active Directory" > "App registrations"
3. Click "New registration"
4. Name: "Outlook Automation"
5. Redirect URI: `https://yourdomain.com/api/auth-callback`

### 2. Configure Permissions

**API Permissions needed:**
- `Mail.Read` - Read user mail
- `Mail.Send` - Send mail as user
- `User.Read` - Read user profile
- `offline_access` - Maintain access to data

### 3. Get Credentials

- **Application (client) ID** → `AZURE_CLIENT_ID`
- **Directory (tenant) ID** → `AZURE_TENANT_ID`
- **Client secret** (create new) → `AZURE_CLIENT_SECRET`

## Monitoring and Maintenance

### 1. Log Monitoring

```bash
# View application logs
sudo journalctl -u outlook-automation -f

# View Nginx logs
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

### 2. Backup Strategy

```bash
# Backup session data
tar -czf backup-$(date +%Y%m%d).tar.gz session_data/ .env analytics.json

# Automated backup script
cat > backup.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="/backup/outlook-automation"
DATE=$(date +%Y%m%d_%H%M%S)
mkdir -p $BACKUP_DIR
tar -czf $BACKUP_DIR/backup-$DATE.tar.gz session_data/ .env analytics.json telegram_subscriptions.json
find $BACKUP_DIR -name "backup-*.tar.gz" -mtime +30 -delete
EOF

chmod +x backup.sh
sudo mv backup.sh /usr/local/bin/
```

### 3. Health Monitoring

```bash
# Simple health check script
cat > health_check.sh << 'EOF'
#!/bin/bash
if curl -f http://localhost:5000/api/health > /dev/null 2>&1; then
    echo "✅ Service healthy"
else
    echo "❌ Service down - restarting..."
    sudo systemctl restart outlook-automation
fi
EOF

chmod +x health_check.sh
# Add to crontab: */5 * * * * /path/to/health_check.sh
```

## Updating the Application

```bash
# Stop service
sudo systemctl stop outlook-automation

# Backup current version
cp -r /path/to/outlook-automation /path/to/outlook-automation.backup

# Pull updates
git pull origin main
npm install

# Restart service
sudo systemctl start outlook-automation
sudo systemctl status outlook-automation
```

## Access URLs

After installation:

- **Main Application**: `https://yourdomain.com`
- **Admin Panel**: `https://yourdomain.com/ad.html?token=your_admin_token`
- **Health Check**: `https://yourdomain.com/api/health`

## Troubleshooting

### Common Issues

1. **Chrome/Chromium not found**:
   ```bash
   which chromium-browser
   # Add path to CHROMIUM_PATH in .env
   ```

2. **Permission denied**:
   ```bash
   sudo chown -R www-data:www-data /path/to/outlook-automation
   ```

3. **Port already in use**:
   ```bash
   sudo lsof -i :5000
   # Kill process or change PORT in .env
   ```

4. **Session data not saving**:
   ```bash
   ls -la session_data/
   sudo chmod 755 session_data/
   ```

### Log Analysis

```bash
# Application errors
sudo journalctl -u outlook-automation --since "1 hour ago"

# Browser automation issues
grep -i "puppeteer\|chrome" /var/log/syslog

# Authentication failures
grep -i "authentication\|login" /var/log/syslog
```

## Performance Optimization

### 1. Node.js Optimization

```bash
# Add to service file
Environment=NODE_OPTIONS="--max-old-space-size=2048"
```

### 2. Nginx Caching

```nginx
# Add to nginx config
location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
}
```

### 3. Session Cleanup

```bash
# Auto-cleanup old sessions (add to crontab)
0 2 * * * find /path/to/outlook-automation/session_data -name "*.json" -mtime +7 -delete
```

---

**Need Help?** 
- Check logs: `sudo journalctl -u outlook-automation -f`
- Verify configuration: `https://yourdomain.com/api/health`
- Test authentication: `https://yourdomain.com/ad.html`

This installation provides enterprise-grade deployment with security, monitoring, and maintenance capabilities.
