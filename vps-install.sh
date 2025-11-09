#!/bin/bash

###############################################
# ClosedBridge VPS Auto-Installer
# Ubuntu 22.04/24.04/25.04 Compatible
# One-command installation script
###############################################

set -e

echo "======================================"
echo "ClosedBridge VPS Auto-Installer"
echo "======================================"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored messages
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

print_info "Starting installation..."

# Update system
print_info "Updating system packages..."
apt update -y
apt upgrade -y
print_success "System updated"

# Install Node.js (v20)
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

# Install Chromium and dependencies
print_info "Installing Chromium browser..."
apt install -y chromium-browser
print_success "Chromium installed"

# Install Chromium dependencies (Ubuntu 25.04 compatible)
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

# Configure firewall
print_info "Configuring firewall..."
ufw allow 22
ufw allow 3000
echo "y" | ufw enable
print_success "Firewall configured (ports 22, 3000 open)"

# Clone ClosedBridge repository
print_info "Cloning ClosedBridge repository..."
cd /root
if [ -d "closedbridge" ]; then
    rm -rf closedbridge
fi
git clone https://github.com/x8080x2/L1n7k.git closedbridge
cd closedbridge
print_success "Repository cloned"

# Install npm packages
print_info "Installing Node.js packages..."
npm install --production
print_success "Packages installed"

# Configure .env file
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

# Start application with PM2
print_info "Starting ClosedBridge with PM2..."
pm2 delete closedbridge 2>/dev/null || true
pm2 start server.js --name closedbridge
pm2 save
pm2 startup | tail -n 1 | bash
print_success "ClosedBridge started and configured to auto-start on reboot"

# Display final information
echo ""
echo "======================================"
echo -e "${GREEN}Installation Complete!${NC}"
echo "======================================"
echo ""
echo "🌐 Your ClosedBridge is running at:"
echo -e "   Main: ${GREEN}http://${VPS_IP}:3000${NC}"
echo -e "   Admin: ${GREEN}http://${VPS_IP}:3000/ad.html${NC}"
echo ""
echo "🤖 Telegram Bot:"
if [ -z "$TELEGRAM_TOKEN" ]; then
    echo -e "   ${YELLOW}Not configured - add token to /root/closedbridge/.env${NC}"
else
    echo -e "   ${GREEN}Configured - send /start to your bot${NC}"
fi
echo ""
echo "📊 Useful Commands:"
echo "   pm2 status          - Check application status"
echo "   pm2 logs closedbridge - View logs"
echo "   pm2 restart closedbridge - Restart application"
echo "   pm2 stop closedbridge - Stop application"
echo ""
echo "📁 Installation Directory: /root/closedbridge"
echo ""
print_success "Setup complete!"
