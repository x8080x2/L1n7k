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

# Install Chromium dependencies (handles both t64 and non-t64 versions)
print_info "Installing Chromium dependencies..."
apt install -y \
    libnss3-t64 \
    libnspr4-t64 \
    libatk1.0-t64 \
    libatk-bridge2.0-t64 \
    libcups2-t64 \
    libdrm2-t64 \
    libdbus-1-3-t64 \
    libxkbcommon0-t64 \
    libxcomposite1-t64 \
    libxdamage1-t64 \
    libxfixes3-t64 \
    libxrandr2-t64 \
    libgbm1-t64 \
    libpango-1.0-0-t64 \
    libcairo2-t64 \
    libasound2-t64 \
    libatspi2.0-0-t64 \
    2>/dev/null || apt install -y \
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
    libatspi2.0-0

print_success "Chromium dependencies installed"

# Clean after installations
apt autoremove -y
apt clean

# Configure firewall
print_info "Configuring firewall..."
ufw allow 22
ufw allow 3000
echo "y" | ufw enable
print_success "Firewall configured (ports 22, 3000)"

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

# Telegram Bot Token
TELEGRAM_BOT_TOKEN=${TELEGRAM_TOKEN}
EOF
print_success "Environment configured"

# Optimize PM2 for low memory
print_info "Optimizing PM2 configuration..."
pm2 set pm2:sysmonit false
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 3

# Start application
print_info "Starting ClosedBridge with PM2..."
pm2 start server.js --name closedbridge --max-memory-restart 800M
pm2 save
pm2 startup | tail -n 1 | bash
print_success "ClosedBridge started"

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
echo -e "   Main: ${GREEN}http://${VPS_IP}:3000${NC}"
echo -e "   Admin: ${GREEN}http://${VPS_IP}:3000/ad.html${NC}"
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
