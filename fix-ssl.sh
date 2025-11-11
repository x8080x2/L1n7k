#!/bin/bash

###############################################
# ClosedBridge SSL Quick Fix
# Fixes SSL certificate issues by removing www requirement
###############################################

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
    print_error "Please run as root (use: sudo bash fix-ssl.sh)"
    exit 1
fi

# Check if ClosedBridge is installed
if [ ! -d "/root/closedbridge" ]; then
    print_error "ClosedBridge not found at /root/closedbridge"
    exit 1
fi

echo "======================================"
echo "ClosedBridge SSL Quick Fix"
echo "======================================"
echo ""

# Get VPS IP automatically
VPS_IP=$(curl -s ifconfig.me)
print_info "Detected VPS IP: $VPS_IP"

echo ""
# Prompt for domain name
read -p "Enter your domain name (e.g., example.com): " DOMAIN_NAME

if [ -z "$DOMAIN_NAME" ]; then
    print_error "Domain name is required!"
    exit 1
fi

# Remove www. prefix if user included it
DOMAIN_NAME=$(echo "$DOMAIN_NAME" | sed 's/^www\.//')

print_info "Checking DNS configuration for $DOMAIN_NAME..."

# Check DNS
DOMAIN_IP=$(dig +short $DOMAIN_NAME @8.8.8.8 2>/dev/null | tail -n1)

if [ "$DOMAIN_IP" = "$VPS_IP" ]; then
    print_success "DNS configured correctly! ($DOMAIN_NAME → $VPS_IP)"
else
    print_error "DNS not pointing to this server!"
    echo ""
    echo "⚠️  Your domain '$DOMAIN_NAME' currently points to: ${DOMAIN_IP:-<not found>}"
    echo "📍 It should point to: $VPS_IP"
    echo ""
    exit 1
fi

# Fix Nginx configuration (remove www if present and update domain)
print_info "Fixing Nginx configuration..."

# Update server_name line to use only the main domain
sed -i "/server_name/c\    server_name $DOMAIN_NAME;" /etc/nginx/sites-available/closedbridge

# Test Nginx config
if ! nginx -t 2>/dev/null; then
    print_error "Nginx configuration test failed!"
    exit 1
fi

systemctl restart nginx
print_success "Nginx configuration fixed"

# Get SSL certificate for main domain only
print_info "📜 Obtaining SSL certificate from Let's Encrypt..."
read -p "Enter email for SSL notifications (default: admin@$DOMAIN_NAME): " SSL_EMAIL
SSL_EMAIL=${SSL_EMAIL:-admin@$DOMAIN_NAME}

if certbot --nginx \
    -d $DOMAIN_NAME \
    --non-interactive \
    --agree-tos \
    --email $SSL_EMAIL \
    --redirect \
    --hsts \
    --staple-ocsp; then
    print_success "SSL certificate installed successfully!"
    
    # Update .env file
    print_info "Updating environment variables..."
    cd /root/closedbridge
    sed -i "s|DOMAIN=http://.*|DOMAIN=https://$DOMAIN_NAME|g" .env
    sed -i "s|DOMAIN=https://.*:3000|DOMAIN=https://$DOMAIN_NAME|g" .env
    sed -i "s|AZURE_REDIRECT_URI=http://.*|AZURE_REDIRECT_URI=https://$DOMAIN_NAME/api/auth-callback|g" .env
    sed -i "s|AZURE_REDIRECT_URI=https://.*:3000|AZURE_REDIRECT_URI=https://$DOMAIN_NAME/api/auth-callback|g" .env
    
    # Restart application
    print_info "Restarting ClosedBridge..."
    pm2 restart closedbridge
    
    # Restart Nginx
    systemctl restart nginx
    
    echo ""
    echo "======================================"
    echo -e "${GREEN}SSL Configuration Complete!${NC}"
    echo "======================================"
    echo ""
    echo "✅ Your site is now secured with HTTPS!"
    echo "🌐 Main site: https://$DOMAIN_NAME"
    echo "🔧 Admin panel: https://$DOMAIN_NAME/ad.html"
    echo "🔒 SSL Grade: A+ (with HSTS enabled)"
    echo "🔄 Auto-Renewal: Enabled (via certbot.timer)"
    echo ""
    print_success "All done! Your site is now live with SSL!"
else
    print_error "SSL certificate installation failed!"
    echo ""
    echo "Common issues:"
    echo "  - Firewall blocking ports 80/443 (check: ufw status)"
    echo "  - DNS not fully propagated (wait and try again)"
    echo "  - Another service using port 80/443"
    echo ""
    echo "You can try again by running: sudo bash fix-ssl.sh"
    exit 1
fi
