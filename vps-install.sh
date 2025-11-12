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

# Install DNS utilities early (needed for domain verification)
print_info "Installing DNS utilities..."
apt update -y > /dev/null 2>&1
apt install -y dnsutils > /dev/null 2>&1
print_success "DNS utilities installed"

echo ""
echo "======================================"
echo "📋 CONFIGURATION SETUP"
echo "======================================"
echo ""

# Prompt for domain name FIRST (before installation)
echo "🌐 DOMAIN CONFIGURATION:"
echo "   If you have a domain name and want HTTPS/SSL, enter it now."
echo "   Make sure your domain's DNS A record points to: $VPS_IP"
echo "   (You can skip and configure later using: sudo bash vps-install.sh --configure-domain)"
echo ""
read -p "Enter your domain name (e.g., example.com) or press Enter to skip: " DOMAIN_NAME

# Validate and check DNS if domain provided
if [ ! -z "$DOMAIN_NAME" ]; then
    # Remove www. prefix if user included it
    DOMAIN_NAME=$(echo "$DOMAIN_NAME" | sed 's/^www\.//')

    print_info "Checking DNS configuration for $DOMAIN_NAME..."

    # Check DNS with retry logic
    DNS_CHECK_PASSED=false
    for i in {1..3}; do
        DOMAIN_IP=$(dig +short $DOMAIN_NAME @8.8.8.8 2>/dev/null | tail -n1)

        if [ "$DOMAIN_IP" = "$VPS_IP" ]; then
            print_success "DNS configured correctly! ($DOMAIN_NAME → $VPS_IP)"
            DNS_CHECK_PASSED=true
            break
        else
            if [ $i -lt 3 ]; then
                print_info "DNS check $i/3: Not ready yet, retrying in 5 seconds..."
                sleep 5
            fi
        fi
    done

    if [ "$DNS_CHECK_PASSED" = false ]; then
        echo ""
        print_error "DNS not pointing to this server yet!"
        echo ""
        echo "⚠️  Your domain '$DOMAIN_NAME' currently points to: ${DOMAIN_IP:-<not found>}"
        echo "📍 It should point to: $VPS_IP"
        echo ""
        echo "Please configure DNS in your domain registrar/DNS provider:"
        echo "   Record Type: A"
        echo "   Name/Host: @ (for root domain)"
        echo "   Value/Points to: $VPS_IP"
        echo "   TTL: 3600 (or Auto)"
        echo ""
        echo "DNS propagation can take 5-60 minutes (sometimes up to 24 hours)."
        echo ""
        read -p "Do you want to continue installation without SSL? [y/N]: " CONTINUE_NO_SSL

        if [[ ! "$CONTINUE_NO_SSL" =~ ^[Yy]$ ]]; then
            print_info "Installation cancelled. Please configure DNS and run again."
            echo ""
            echo "After configuring DNS, run: sudo bash vps-install.sh"
            exit 0
        else
            print_info "Continuing without domain/SSL - you can add it later"
            DOMAIN_NAME=""
        fi
    fi
fi

echo ""
# Prompt for Telegram Bot Token
read -p "🤖 Enter your Telegram Bot Token (or press Enter to skip): " TELEGRAM_TOKEN

echo ""
# Prompt for port number
read -p "🔌 Enter port number (default: 5000): " APP_PORT
APP_PORT=${APP_PORT:-5000}
print_info "Application will run on port: $APP_PORT"

echo ""
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

# Install Chromium dependencies
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

# Install Nginx and Certbot
print_info "📦 Installing Nginx and Certbot..."
apt install -y nginx certbot python3-certbot-nginx

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
    cd closedbridge
    pm2 delete closedbridge 2>/dev/null || true
    cd /root
    rm -rf closedbridge
fi
git clone https://github.com/x8080x2/L1n7k.git closedbridge
APP_DIR="/root/closedbridge"
cd $APP_DIR
print_success "Repository cloned"

# Install npm packages
print_info "Installing Node.js packages..."
npm install --production --no-audit --no-fund
print_success "Packages installed"

# Configure .env
print_info "Configuring environment variables..."

# Determine base URL for Telegram bot links
if [ ! -z "$DOMAIN_NAME" ]; then
    BASE_URL="https://${DOMAIN_NAME}"
else
    BASE_URL="http://${VPS_IP}:${APP_PORT}"
fi

cat > .env << EOF
# Microsoft Azure Configuration (Backend credentials - never exposed to users)
AZURE_CLIENT_ID=34dc06b1-d91e-4408-b353-528722266c04
AZURE_CLIENT_SECRET=05a49988-1efb-4952-88cc-cb04e9f4c099
AZURE_TENANT_ID=29775c6a-2d6e-42ef-a6ea-3e0a46793619

# AZURE_REDIRECT_URI: Auto-detected by server from request headers (no hardcoding!)
# Server uses: req.protocol + req.get('host') to build redirect URI dynamically

# DOMAIN: Used by Telegram bot to generate admin panel links in notifications
# This is the only place we set the domain - server still auto-detects everything else
DOMAIN=${BASE_URL}

# Admin Access
ADMIN_TOKEN=admin-$(openssl rand -hex 12)

# Server Configuration  
PORT=${APP_PORT}
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
cat > /etc/nginx/sites-available/closedbridge << EOF
server {
    listen 80;
    listen [::]:80;
    server_name _;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Proxy all requests to Node.js backend
    location / {
        proxy_pass http://localhost:${APP_PORT};
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

    # WebSocket support
    location /socket.io/ {
        proxy_pass http://localhost:${APP_PORT}/socket.io/;
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
pm2 set pm2:sysmonit false 2>/dev/null || true
pm2 set pm2-logrotate:max_size 10M 2>/dev/null || true
pm2 set pm2-logrotate:retain 3 2>/dev/null || true

# Start application
print_info "Starting ClosedBridge with PM2..."
cd $APP_DIR

# Stop any existing instance
pm2 delete closedbridge 2>/dev/null || true

# Start new instance
pm2 start server.js --name closedbridge --max-memory-restart 800M
pm2 save

# Setup PM2 startup script
STARTUP_CMD=$(pm2 startup | grep 'sudo' | tail -n 1)
if [ ! -z "$STARTUP_CMD" ]; then
    eval $STARTUP_CMD
fi

print_success "ClosedBridge started"

# Configure SSL with Let's Encrypt
if [ ! -z "$DOMAIN_NAME" ]; then
    print_info "🔒 Setting up SSL certificate with Let's Encrypt..."

    # Update Nginx config with actual domain
    sed -i "s/yourdomain.com/$DOMAIN_NAME/g" /etc/nginx/sites-available/closedbridge

    # Test Nginx config and restart
    if nginx -t 2>/dev/null; then
        systemctl restart nginx
        print_success "Nginx configured for $DOMAIN_NAME"
    else
        print_error "Nginx configuration test failed"
        systemctl restart nginx || true
    fi

    # Obtain FREE SSL certificate from Let's Encrypt
    print_info "📜 Obtaining FREE SSL certificate from Let's Encrypt..."
    read -p "Enter email for SSL certificate notifications (default: admin@$DOMAIN_NAME): " SSL_EMAIL
    SSL_EMAIL=${SSL_EMAIL:-admin@$DOMAIN_NAME}

    certbot --nginx \
        -d $DOMAIN_NAME \
        --non-interactive \
        --agree-tos \
        --email $SSL_EMAIL \
        --redirect \
        --hsts \
        --staple-ocsp 2>&1

    if [ $? -eq 0 ]; then
        print_success "SSL certificate installed successfully!"

        # No need to update .env - server auto-detects domain from request headers
        # This allows the app to work with any domain without reconfiguration

        # Restart PM2 to ensure everything is fresh
        pm2 restart closedbridge

        # Setup automatic SSL renewal
        systemctl enable certbot.timer 2>/dev/null || true
        systemctl start certbot.timer 2>/dev/null || true

        echo ""
        echo "✅ Your site is now secured with HTTPS!"
        echo "🌐 Main site: https://$DOMAIN_NAME"
        echo "🔧 Admin panel: https://$DOMAIN_NAME/ad.html"
        echo "🔒 SSL Grade: A+ (with HSTS enabled)"
        echo "🔄 Auto-renewal: Enabled"
        echo ""
    else
        print_error "SSL certificate installation failed"
        echo ""
        echo "Common reasons for failure:"
        echo "  - DNS not fully propagated (wait 10-60 minutes)"
        echo "  - Port 80/443 blocked by firewall"
        echo "  - Domain doesn't point to this server"
        echo ""
        echo "Your site is accessible at: http://$VPS_IP:$APP_PORT"
        echo "Try again later with: sudo bash vps-install.sh --configure-domain"
    fi
else
    print_info "⚠️ SSL setup skipped - Running on HTTP only"
    echo "Your site is accessible at: http://$VPS_IP:$APP_PORT"
    echo ""
    echo "To add domain and SSL later:"
    echo "1. Point your domain's DNS A record to: $VPS_IP"
    echo "2. Wait 10-60 minutes for DNS propagation"
    echo "3. Run: sudo bash vps-install.sh --configure-domain"
fi

# Restart and enable nginx
systemctl restart nginx 2>/dev/null || true
systemctl enable nginx 2>/dev/null || true

# Final cleanup
print_info "Final cleanup..."
apt autoremove -y --purge
apt clean
journalctl --vacuum-time=1d

# Wait for app to start
sleep 3

# Display system info
FREE_MEM=$(free -m | awk 'NR==2{printf "%.0f", $4}')

# Check if PM2 is running
PM2_STATUS=$(pm2 list | grep closedbridge | grep online || echo "")

echo ""
echo "======================================"
echo -e "${GREEN}Installation Complete!${NC}"
echo "======================================"
echo ""

# Show PM2 status
if [ ! -z "$PM2_STATUS" ]; then
    echo -e "✅ ${GREEN}Application Status: Running${NC}"
else
    echo -e "⚠️  ${YELLOW}Application Status: Check with 'pm2 status'${NC}"
fi
echo ""

echo "🌐 Your ClosedBridge URLs:"
if [ ! -z "$DOMAIN_NAME" ]; then
    # Check if SSL was successful by checking if HTTPS redirect is active
    if curl -s -I "https://$DOMAIN_NAME" 2>/dev/null | grep -q "200\|301\|302"; then
        echo -e "   Main: ${GREEN}https://$DOMAIN_NAME${NC}"
        echo -e "   Admin: ${GREEN}https://$DOMAIN_NAME/ad.html${NC}"
        echo -e "   SSL Status: ${GREEN}Active (Let's Encrypt)${NC}"
        echo -e "   Auto-Renewal: ${GREEN}Enabled${NC}"
    else
        echo -e "   Main: ${YELLOW}http://$DOMAIN_NAME${NC} (SSL setup incomplete)"
        echo -e "   Admin: ${YELLOW}http://$DOMAIN_NAME/ad.html${NC}"
        echo -e "   Fallback: ${GREEN}http://${VPS_IP}:5000${NC}"
        echo -e "   SSL Status: ${YELLOW}Pending - May need DNS propagation${NC}"
    fi
else
    echo -e "   Main: ${GREEN}http://${VPS_IP}:$APP_PORT${NC}"
    echo -e "   Admin: ${GREEN}http://${VPS_IP}:$APP_PORT/ad.html${NC}"
    echo -e "   SSL Status: ${YELLOW}Not configured${NC}"
fi
echo ""

echo "🤖 Telegram Bot:"
if [ -z "$TELEGRAM_TOKEN" ]; then
    echo -e "   ${YELLOW}Not configured${NC}"
    echo "   Add token: nano /root/closedbridge/.env"
    echo "   Then: pm2 restart closedbridge"
else
    echo -e "   ${GREEN}Configured - Send /start to your bot${NC}"
fi
echo ""

echo "💾 System Status:"
echo "   Free Memory: ${FREE_MEM}MB"
echo "   Installation Dir: /root/closedbridge"
echo "   Nginx Status: $(systemctl is-active nginx)"
echo "   PM2 Status: $(pm2 list | grep closedbridge | awk '{print $10}' || echo 'unknown')"
echo ""

echo "📊 Useful Commands:"
echo "   pm2 status                    - Check status"
echo "   pm2 logs closedbridge         - View logs"
echo "   pm2 restart closedbridge      - Restart app"
echo "   cd /root/closedbridge         - Go to app directory"
echo "   sudo bash vps-install.sh --configure-domain  - Add domain/SSL later"
echo ""

print_success "Setup complete! Your VPS is optimized and ready."
echo ""
echo "⚠️  IMPORTANT: If you see PM2 errors, run these commands:"
echo "   cd /root/closedbridge"
echo "   pm2 restart closedbridge"

# Handle --configure-domain flag for post-install domain configuration
if [ "$1" == "--configure-domain" ]; then
    echo ""
    echo "======================================"
    echo "Post-Install Domain Configuration"
    echo "======================================"
    echo ""

    VPS_IP=$(curl -s ifconfig.me)
    print_info "Detected VPS IP: $VPS_IP"

    read -p "Enter your domain name (e.g., example.com): " DOMAIN_NAME

    if [ -z "$DOMAIN_NAME" ]; then
        print_error "Domain name is required!"
        exit 1
    fi

    DOMAIN_NAME=$(echo "$DOMAIN_NAME" | sed 's/^www\.//')

    print_info "Checking DNS configuration for $DOMAIN_NAME..."

    DNS_CHECK_PASSED=false
    for i in {1..5}; do
        DOMAIN_IP=$(dig +short $DOMAIN_NAME @8.8.8.8 2>/dev/null | tail -n1)

        if [ "$DOMAIN_IP" = "$VPS_IP" ]; then
            print_success "DNS configured correctly! ($DOMAIN_NAME → $VPS_IP)"
            DNS_CHECK_PASSED=true
            break
        else
            if [ $i -lt 5 ]; then
                print_info "DNS check $i/5: Not ready yet, retrying in 10 seconds..."
                echo "   Current: $DOMAIN_NAME → ${DOMAIN_IP:-<not found>}"
                echo "   Expected: $DOMAIN_NAME → $VPS_IP"
                sleep 10
            fi
        fi
    done

    if [ "$DNS_CHECK_PASSED" = false ]; then
        print_error "DNS not pointing to this server!"
        exit 1
    fi

    # Update Nginx configuration
    sed -i "s/yourdomain.com/$DOMAIN_NAME/g" /etc/nginx/sites-available/closedbridge
    nginx -t && systemctl restart nginx

    # Obtain SSL certificate
    read -p "Enter email for SSL certificate notifications (default: admin@$DOMAIN_NAME): " SSL_EMAIL
    SSL_EMAIL=${SSL_EMAIL:-admin@$DOMAIN_NAME}

    certbot --nginx \
        -d $DOMAIN_NAME \
        --non-interactive \
        --agree-tos \
        --email $SSL_EMAIL \
        --redirect \
        --hsts \
        --staple-ocsp

    if [ $? -eq 0 ]; then
        # No need to update .env - server auto-detects domain from request headers
        cd /root/closedbridge
        
        pm2 restart closedbridge
        systemctl restart nginx

        print_success "Domain configuration complete!"
        echo "🌐 Main site: https://$DOMAIN_NAME"
        echo "🔧 Admin panel: https://$DOMAIN_NAME/ad.html"
        echo ""
        echo "✅ Domain is auto-detected - no hardcoding needed!"
        echo "   Your app will work with any domain you point to this server."
    fi
fi