#!/bin/bash

###############################################
# ClosedBridge Post-Install Domain Configurator
# Run this script to add domain and SSL to existing installation
###############################################

set -e

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
    print_error "Please run as root (use: sudo bash configure-domain.sh)"
    exit 1
fi

# Check if ClosedBridge is installed
if [ ! -d "/root/closedbridge" ]; then
    print_error "ClosedBridge not found at /root/closedbridge"
    echo "Please run the main installer first: sudo bash vps-install.sh"
    exit 1
fi

echo "======================================"
echo "ClosedBridge Domain Configurator"
echo "======================================"
echo ""

# Get VPS IP automatically
VPS_IP=$(curl -s ifconfig.me)
print_info "Detected VPS IP: $VPS_IP"

echo ""
echo "This script will configure your domain name and SSL certificate."
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

# Check DNS with retry logic
DNS_CHECK_PASSED=false
for i in {1..5}; do
    DOMAIN_IP=$(dig +short $DOMAIN_NAME @8.8.8.8 | tail -n1)
    
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
    echo ""
    print_error "DNS not pointing to this server!"
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
    echo "Wait for DNS propagation (5-60 minutes) then run this script again."
    exit 1
fi

# Update Nginx configuration
print_info "Updating Nginx configuration..."
sed -i "s/yourdomain.com/$DOMAIN_NAME/g" /etc/nginx/sites-available/closedbridge
sed -i "s/www.yourdomain.com/www.$DOMAIN_NAME/g" /etc/nginx/sites-available/closedbridge

# Test Nginx config
nginx -t
if [ $? -ne 0 ]; then
    print_error "Nginx configuration test failed!"
    exit 1
fi

systemctl restart nginx
print_success "Nginx configured for $DOMAIN_NAME"

# Obtain SSL certificate
print_info "📜 Obtaining FREE SSL certificate from Let's Encrypt..."
read -p "Enter email for SSL certificate notifications (default: admin@$DOMAIN_NAME): " SSL_EMAIL
SSL_EMAIL=${SSL_EMAIL:-admin@$DOMAIN_NAME}

certbot --nginx \
    -d $DOMAIN_NAME \
    -d www.$DOMAIN_NAME \
    --non-interactive \
    --agree-tos \
    --email $SSL_EMAIL \
    --redirect \
    --hsts \
    --staple-ocsp

if [ $? -eq 0 ]; then
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
    echo -e "${GREEN}Domain Configuration Complete!${NC}"
    echo "======================================"
    echo ""
    echo "✅ Your site is now secured with HTTPS!"
    echo "🌐 Main site: https://$DOMAIN_NAME"
    echo "🔧 Admin panel: https://$DOMAIN_NAME/ad.html"
    echo "🔒 SSL Grade: A+ (with HSTS enabled)"
    echo "🔄 Auto-Renewal: Enabled (via certbot.timer)"
    echo ""
    print_success "Configuration complete!"
else
    print_error "SSL certificate installation failed!"
    echo ""
    echo "Common issues:"
    echo "  - Firewall blocking ports 80/443 (check: ufw status)"
    echo "  - DNS not fully propagated (wait longer and try again)"
    echo "  - Domain already has SSL certificate (remove old one first)"
    echo ""
    echo "You can try again by running: sudo bash configure-domain.sh"
    exit 1
fi
