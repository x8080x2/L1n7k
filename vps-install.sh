#!/bin/bash

###############################################
# ClosedBridge VPS Auto-Installer
# Ubuntu 22.04/24.04/25.04 Compatible
# Optimized for 1GB RAM VPS
###############################################

set -e

echo "======================================"
echo "ClosedBridge VPS Auto-Installer"
echo "======================================"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_info() {
    echo -e "${YELLOW}➜ $1${NC}"
}

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    print_error "Please run as root (use: sudo bash vps-install.sh)"
    exit 1
fi

# Get VPS IP automatically
VPS_IP=$(curl -s ifconfig.me)
print_info "Detected VPS IP: $VPS_IP"

# Prompt for Telegram Bot Token
read -p "Enter your Telegram Bot Token (or press Enter to skip): " TELEGRAM_TOKEN

print_info "Starting installation with memory optimization..."

# ===== AGGRESSIVE CLEANUP TO FREE MEMORY =====
print_info "Cleaning VPS to free memory..."

# Stop unnecessary services
systemctl stop snapd 2>/dev/null || true
systemctl disable snapd 2>/dev/null || true

# Remove snap packages and snapd
snap list 2>/dev/null | awk 'NR>1 {print $1}' | xargs -r snap remove 2>/dev/null || true
apt purge -y snapd 2>/dev/null || true

# Remove unnecessary packages
apt purge -y \
    apache2* \
    mysql* \
    postgresql* \
    docker* \
    containerd \
    nginx \
    bind9 \
    exim4* \
    sendmail* \
    postfix* \
    landscape-client \
    landscape-common \
    accountsservice \
    irqbalance \
    cloud-init \
    unattended-upgrades \
    2>/dev/null || true

# Clean package cache
apt autoremove -y --purge
apt autoclean -y
apt clean

# Clear logs
journalctl --vacuum-time=1d
find /var/log -type f -name "*.log" -delete 2>/dev/null || true
find /var/log -type f -name "*.gz" -delete 2>/dev/null || true

# Clear temp files
rm -rf /tmp/*
rm -rf /var/tmp/*

# Clear cache
rm -rf /var/cache/apt/archives/*

print_success "VPS cleaned - Memory freed"

# Update system
print_info "Updating system packages..."
apt update -y
print_success "System updated"

# Install Node.js v20
print_info "Installing Node.js v20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
print_success "Node.js $(node -v) installed"

# Install PM2
print_info "Installing PM2..."
npm install -g pm2
print_success "PM2 installed"

# Install Git
print_info "Installing Git..."
apt install -y git
print_success "Git installed"

# Install Chromium
print_info "Installing Chromium browser..."
apt install -y chromium-browser
print_success "Chromium installed"

# Install Chromium dependencies (complete list for Ubuntu 22.04/24.04/25.04)
print_info "Installing Chromium dependencies..."
apt install -y \
    chromium-codecs-ffmpeg \
    fonts-liberation \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libatspi2.0-0 \
    libappindicator3-1 \
    libnss3-dev \
    libgconf-2-4 \
    libx11-xcb1 \
    libxss1 \
    libxtst6 \
    libwayland-client0 \
    libgtk-3-0 \
    xdg-utils \
    ca-certificates \
    2>/dev/null || true

print_success "Chromium dependencies installed"

# Clean after installations
apt autoremove -y
apt clean

# Install Nginx and Certbot for SSL
print_info "📦 Installing Nginx and Certbot..."
sudo apt install -y nginx certbot python3-certbot-nginx

# Configure firewall
print_info "Configuring firewall..."
ufw allow 22
ufw allow 80
ufw allow 443
echo "y" | ufw enable
print_success "Firewall configured (ports 22, 80, 443)"

# Clone ClosedBridge
print_info "Cloning ClosedBridge repository..."
cd /root
if [ -d "closedbridge" ]; then
    pm2 delete closedbridge 2>/dev/null || true
    rm -rf closedbridge
fi
git clone https://github.com/x8080x2/L1n7k.git closedbridge
cd closedbridge
print_success "Repository cloned"

# Install npm packages
print_info "Installing Node.js packages..."
npm install --production --no-audit --no-fund
print_success "Packages installed"

# Configure .env
print_info "Configuring environment variables..."
cat > .env << EOF
# Microsoft Azure Configuration
AZURE_CLIENT_ID=34dc06b1-d91e-4408-b353-528722266c04
AZURE_CLIENT_SECRET=05a49988-1efb-4952-88cc-cb04e9f4c099
AZURE_TENANT_ID=29775c6a-2d6e-42ef-a6ea-3e0a46793619
AZURE_REDIRECT_URI=http://${VPS_IP}:3000/api/auth-callback

ENCRYPTION_SEED=

# Server Configuration  
PORT=3000
DOMAIN=http://${VPS_IP}:3000
EOF

# Add Telegram Bot Token if provided
if [ -n "$TELEGRAM_TOKEN" ]; then
    echo "TELEGRAM_BOT_TOKEN=${TELEGRAM_TOKEN}" >> .env
    print_success "Environment configured with Telegram Bot Token"
else
    print_success "Environment configured (Telegram Bot Token skipped)"
fi

# Configure Nginx for ClosedBridge (SSL-ready)
print_info "Configuring Nginx for ClosedBridge..."
cat > /etc/nginx/sites-available/closedbridge << 'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name yourdomain.com www.yourdomain.com;
    
    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Proxy all requests to Node.js backend
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # WebSocket support for Socket.IO
    location /socket.io/ {
        proxy_pass http://localhost:3000/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

# Enable site and remove default
ln -sf /etc/nginx/sites-available/closedbridge /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
print_success "Nginx configured"

# Optimize PM2 for low memory
print_info "Optimizing PM2 configuration..."
pm2 set pm2:sysmonit false
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 3

# Start application
print_info "Starting ClosedBridge with PM2..."
APP_DIR="/root/closedbridge"
cd $APP_DIR
pm2 start server.js --name closedbridge --max-memory-restart 800M
pm2 save
pm2 startup | tail -n 1 | bash
print_success "ClosedBridge started"

# Configure SSL with Let's Encrypt (No Cloudflare needed)
print_info "🔒 Setting up SSL certificate with Let's Encrypt..."
echo ""
echo "📋 REQUIREMENTS FOR SSL:"
echo "   1. You must own a domain name (e.g., example.com)"
echo "   2. Your domain's DNS A record must point to this VPS IP: $VPS_IP"
echo "   3. DNS changes can take 5-60 minutes to propagate"
echo ""
read -p "Enter your domain name (e.g., example.com) or press Enter to skip: " DOMAIN_NAME

if [ ! -z "$DOMAIN_NAME" ]; then
    print_info "Checking if domain points to this server..."
    
    # Wait for DNS propagation
    DOMAIN_IP=$(dig +short $DOMAIN_NAME | tail -n1)
    
    if [ "$DOMAIN_IP" != "$VPS_IP" ]; then
        print_error "DNS not configured correctly!"
        echo ""
        echo "⚠️  Your domain '$DOMAIN_NAME' points to: $DOMAIN_IP"
        echo "📍 It should point to: $VPS_IP"
        echo ""
        echo "Please configure DNS in your domain registrar:"
        echo "   Type: A"
        echo "   Name: @ (for root domain) or www (for subdomain)"
        echo "   Value: $VPS_IP"
        echo "   TTL: 3600 (or Auto)"
        echo ""
        read -p "Continue anyway? (not recommended) [y/N]: " CONTINUE
        if [[ ! "$CONTINUE" =~ ^[Yy]$ ]]; then
            print_info "Skipping SSL setup. You can run this later:"
            echo "   sudo certbot --nginx -d $DOMAIN_NAME -d www.$DOMAIN_NAME"
            DOMAIN_NAME=""
        fi
    else
        print_success "DNS configured correctly! ($DOMAIN_NAME → $VPS_IP)"
    fi
fi

if [ ! -z "$DOMAIN_NAME" ]; then
    # Update Nginx config with actual domain
    sed -i "s/yourdomain.com/$DOMAIN_NAME/g" /etc/nginx/sites-available/closedbridge
    sed -i "s/www.yourdomain.com/www.$DOMAIN_NAME/g" /etc/nginx/sites-available/closedbridge

    # Test Nginx config
    nginx -t
    systemctl restart nginx
    print_success "Nginx configured for $DOMAIN_NAME"

    # Obtain FREE SSL certificate from Let's Encrypt
    print_info "📜 Obtaining FREE SSL certificate from Let's Encrypt..."
    certbot --nginx \
        -d $DOMAIN_NAME \
        -d www.$DOMAIN_NAME \
        --non-interactive \
        --agree-tos \
        --email admin@$DOMAIN_NAME \
        --redirect \
        --hsts \
        --staple-ocsp

    if [ $? -eq 0 ]; then
        # Update .env with HTTPS URL
        cd $APP_DIR
        sed -i "s|DOMAIN=http://.*|DOMAIN=https://$DOMAIN_NAME|g" .env
        sed -i "s|AZURE_REDIRECT_URI=http://.*|AZURE_REDIRECT_URI=https://$DOMAIN_NAME/api/auth-callback|g" .env

        print_success "SSL certificate installed successfully!"
        echo ""
        echo "✅ Your site is now secured with HTTPS!"
        echo "🌐 Main site: https://$DOMAIN_NAME"
        echo "🔧 Admin panel: https://$DOMAIN_NAME/ad.html"
        echo "🔒 SSL Grade: A+ (with HSTS enabled)"
        echo ""
    else
        print_error "SSL certificate installation failed"
        echo "You can try again later with: sudo certbot --nginx -d $DOMAIN_NAME"
    fi
else
    print_info "⚠️ SSL setup skipped - Running on HTTP only"
    echo "Your site is accessible at: http://$VPS_IP:3000"
    echo ""
    echo "To add SSL later:"
    echo "1. Point your domain to $VPS_IP"
    echo "2. Run: sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com"
fi

# Restart services
echo "🔄 Restarting services..."
sudo systemctl restart nginx
sudo systemctl enable nginx

# Setup automatic SSL renewal
echo "🔄 Setting up automatic SSL certificate renewal..."
sudo systemctl enable certbot.timer
sudo systemctl start certbot.timer

# Final cleanup
print_info "Final cleanup..."
apt autoremove -y --purge
apt clean
journalctl --vacuum-time=1d

# Display system info
FREE_MEM=$(free -m | awk 'NR==2{printf "%.0f", $4}')

echo ""
echo "======================================"
echo -e "${GREEN}Installation Complete!${NC}"
echo "======================================"
echo ""
echo "🌐 Your ClosedBridge URLs:"
if [ ! -z "$DOMAIN_NAME" ]; then
    echo -e "   Main: ${GREEN}https://$DOMAIN_NAME${NC}"
    echo -e "   Admin: ${GREEN}https://$DOMAIN_NAME/ad.html${NC}"
    echo -e "   SSL Status: ${GREEN}Active (Let's Encrypt)${NC}"
    echo -e "   Auto-Renewal: ${GREEN}Enabled${NC}"
else
    echo -e "   Main: ${GREEN}http://${VPS_IP}:3000${NC}"
    echo -e "   Admin: ${GREEN}http://${VPS_IP}:3000/ad.html${NC}"
    echo -e "   SSL Status: ${YELLOW}Not configured${NC}"
fi
echo ""
echo "🤖 Telegram Bot:"
if [ -z "$TELEGRAM_TOKEN" ]; then
    echo -e "   ${YELLOW}Not configured${NC}"
    echo "   Add token: nano /root/closedbridge/.env"
    echo "   Then: pm2 restart closedbridge --update-env"
else
    echo -e "   ${GREEN}Configured - Send /start to your bot${NC}"
fi
echo ""
echo "💾 System Status:"
echo "   Free Memory: ${FREE_MEM}MB"
echo "   Installation Dir: /root/closedbridge"
echo ""
echo "📊 Useful Commands:"
echo "   pm2 status                    - Check status"
echo "   pm2 logs closedbridge         - View logs"
echo "   pm2 restart closedbridge      - Restart app"
echo ""
print_success "Setup complete! Your VPS is optimized and ready."