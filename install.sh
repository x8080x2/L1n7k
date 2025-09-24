
#!/bin/bash

# Outlook Automation VPS Installation Script
# Supports Ubuntu/Debian systems

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
APP_NAME="outlook-automation"
APP_USER="www-data"
APP_DIR="/opt/$APP_NAME"
SERVICE_NAME="outlook-automation"
NGINX_SITE="outlook-automation"

echo -e "${BLUE}🚀 Outlook Automation VPS Installation${NC}"
echo "==========================================="

# Check if running as root
if [[ $EUID -eq 0 ]]; then
   echo -e "${RED}❌ This script should not be run as root${NC}"
   echo "Please run as a regular user with sudo privileges"
   exit 1
fi

# Function to print status
print_status() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Update system packages
echo -e "${BLUE}📦 Updating system packages...${NC}"
sudo apt update && sudo apt upgrade -y
print_status "System packages updated"

# Install Node.js 18.x
echo -e "${BLUE}📦 Installing Node.js 18.x...${NC}"
if ! command_exists node || [[ $(node -v | cut -d'v' -f2 | cut -d'.' -f1) -lt 18 ]]; then
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
    print_status "Node.js $(node -v) installed"
else
    print_status "Node.js $(node -v) already installed"
fi

# Install system dependencies
echo -e "${BLUE}📦 Installing system dependencies...${NC}"
sudo apt install -y git nginx chromium-browser certbot python3-certbot-nginx ufw
print_status "System dependencies installed"

# Create application directory
echo -e "${BLUE}📁 Setting up application directory...${NC}"
sudo mkdir -p $APP_DIR
sudo chown $USER:$USER $APP_DIR

# Get current directory (where the script is running from)
CURRENT_DIR=$(pwd)

# Copy application files
echo -e "${BLUE}📋 Copying application files...${NC}"
cp -r $CURRENT_DIR/* $APP_DIR/
cd $APP_DIR

# Install npm dependencies
echo -e "${BLUE}📦 Installing npm dependencies...${NC}"
npm install --production
print_status "NPM dependencies installed"

# Create session data directory
mkdir -p session_data
chmod 755 session_data
print_status "Session data directory created"

# Create environment file from sample
if [ -f ".env.sample" ]; then
    cp .env.sample .env
    print_status "Environment file created from sample"
else
    # Create basic .env file
    cat > .env << EOF
# Server Configuration
PORT=5000
NODE_ENV=production

# Azure App Registration (REQUIRED - Replace with your values)
AZURE_CLIENT_ID=your_client_id_here
AZURE_CLIENT_SECRET=your_client_secret_here
AZURE_TENANT_ID=your_tenant_id_here
AZURE_REDIRECT_URI=https://yourdomain.com/api/auth-callback

# Admin Access (IMPORTANT - Generate secure token)
ADMIN_TOKEN=$(openssl rand -hex 32)

# Telegram Notifications (Optional)
TELEGRAM_BOT_TOKEN=

# Browser Automation
CHROMIUM_PATH=/usr/bin/chromium-browser
EOF
    print_status "Basic environment file created"
fi

# Set proper permissions
sudo chown -R $APP_USER:$APP_USER $APP_DIR
sudo chmod 600 $APP_DIR/.env
print_status "File permissions set"

# Create systemd service
echo -e "${BLUE}⚙️ Creating systemd service...${NC}"
sudo tee /etc/systemd/system/${SERVICE_NAME}.service > /dev/null << EOF
[Unit]
Description=Outlook Automation Service
After=network.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=$SERVICE_NAME

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable $SERVICE_NAME
print_status "Systemd service created and enabled"

# Configure Nginx
echo -e "${BLUE}🌐 Configuring Nginx...${NC}"
sudo tee /etc/nginx/sites-available/$NGINX_SITE > /dev/null << 'EOF'
server {
    listen 80;
    server_name _;  # Replace with your domain

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer-when-downgrade" always;

    # Main application
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

    # Static files caching
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
        proxy_pass http://127.0.0.1:5000;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Security: block access to sensitive files
    location ~ /\. {
        deny all;
    }
    
    location ~* \.(env|json)$ {
        deny all;
    }
}
EOF

# Enable Nginx site
sudo ln -sf /etc/nginx/sites-available/$NGINX_SITE /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl restart nginx
print_status "Nginx configured and restarted"

# Configure firewall
echo -e "${BLUE}🔥 Configuring firewall...${NC}"
sudo ufw --force enable
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 'Nginx Full'
sudo ufw deny 5000  # Block direct access to app port
print_status "Firewall configured"

# Start the application
echo -e "${BLUE}🚀 Starting application...${NC}"
sudo systemctl start $SERVICE_NAME
sleep 3

# Check if service is running
if sudo systemctl is-active --quiet $SERVICE_NAME; then
    print_status "Application started successfully"
else
    print_error "Failed to start application"
    echo "Check logs with: sudo journalctl -u $SERVICE_NAME -f"
fi

# Create backup script
echo -e "${BLUE}💾 Creating backup script...${NC}"
sudo tee /usr/local/bin/backup-outlook-automation.sh > /dev/null << EOF
#!/bin/bash
BACKUP_DIR="/var/backups/outlook-automation"
DATE=\$(date +%Y%m%d_%H%M%S)
mkdir -p \$BACKUP_DIR

cd $APP_DIR
tar -czf \$BACKUP_DIR/backup-\$DATE.tar.gz session_data/ .env analytics.json telegram_subscriptions.json 2>/dev/null || true

# Keep only last 30 days of backups
find \$BACKUP_DIR -name "backup-*.tar.gz" -mtime +30 -delete 2>/dev/null || true

echo "Backup completed: \$BACKUP_DIR/backup-\$DATE.tar.gz"
EOF

sudo chmod +x /usr/local/bin/backup-outlook-automation.sh
print_status "Backup script created"

# Create health check script
echo -e "${BLUE}🏥 Creating health check script...${NC}"
sudo tee /usr/local/bin/health-check-outlook-automation.sh > /dev/null << EOF
#!/bin/bash
if curl -f http://localhost:5000/api/health > /dev/null 2>&1; then
    echo "\$(date): Service healthy"
else
    echo "\$(date): Service down - restarting..."
    systemctl restart $SERVICE_NAME
    sleep 5
    if curl -f http://localhost:5000/api/health > /dev/null 2>&1; then
        echo "\$(date): Service restored"
    else
        echo "\$(date): Service still down - manual intervention required"
    fi
fi
EOF

sudo chmod +x /usr/local/bin/health-check-outlook-automation.sh
print_status "Health check script created"

# Display completion information
echo ""
echo -e "${GREEN}🎉 Installation completed successfully!${NC}"
echo "==========================================="
echo ""
echo -e "${BLUE}📋 Next Steps:${NC}"
echo ""
echo -e "${YELLOW}1. Configure Environment Variables:${NC}"
echo "   Edit: $APP_DIR/.env"
echo "   Set your Azure app credentials and domain"
echo ""
echo -e "${YELLOW}2. Update Nginx Domain:${NC}"
echo "   sudo nano /etc/nginx/sites-available/$NGINX_SITE"
echo "   Replace 'server_name _;' with your domain"
echo ""
echo -e "${YELLOW}3. Setup SSL Certificate:${NC}"
echo "   sudo certbot --nginx -d yourdomain.com"
echo ""
echo -e "${YELLOW}4. Test the Application:${NC}"
echo "   curl http://localhost:5000/api/health"
echo ""
echo -e "${BLUE}📊 Service Management:${NC}"
echo "   Status:  sudo systemctl status $SERVICE_NAME"
echo "   Start:   sudo systemctl start $SERVICE_NAME"
echo "   Stop:    sudo systemctl stop $SERVICE_NAME"
echo "   Restart: sudo systemctl restart $SERVICE_NAME"
echo "   Logs:    sudo journalctl -u $SERVICE_NAME -f"
echo ""
echo -e "${BLUE}🔧 Admin Access:${NC}"
echo "   Admin Token: $(grep ADMIN_TOKEN $APP_DIR/.env | cut -d'=' -f2)"
echo "   Admin Panel: http://yourserver/ad.html?token=<admin_token>"
echo ""
echo -e "${BLUE}💾 Maintenance:${NC}"
echo "   Backup:      sudo /usr/local/bin/backup-outlook-automation.sh"
echo "   Health Check: sudo /usr/local/bin/health-check-outlook-automation.sh"
echo ""
print_warning "Remember to:"
print_warning "- Configure Azure app registration"
print_warning "- Set up your domain and SSL certificate"
print_warning "- Keep your admin token secure"
print_warning "- Set up automated backups (crontab)"
echo ""
echo -e "${GREEN}🚀 Your Outlook Automation is ready!${NC}"
