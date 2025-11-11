#!/bin/bash

# ClosedBridge VPS Quick Install Script
# Usage: curl -sSL https://raw.githubusercontent.com/yourusername/ClosedBridge/main/quick-install.sh | bash

set -e

echo "🚀 ClosedBridge VPS Quick Install"
echo "=================================="

# Check if running as root
if [ "$EUID" -eq 0 ]; then 
    echo "❌ Please don't run as root. Use a regular user with sudo access."
    exit 1
fi

# Update system
echo "📦 Updating system packages..."
sudo apt update && sudo apt upgrade -y

# Install Node.js 20.x
echo "📦 Installing Node.js..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 globally
echo "📦 Installing PM2..."
sudo npm install -g pm2

# Install Nginx and Certbot for SSL
echo "📦 Installing Nginx and Certbot..."
sudo apt install -y nginx certbot python3-certbot-nginx

# Install Git if not present
echo "📦 Installing Git..."
sudo apt install -y git

# Create application directory
APP_DIR="/var/www/closedbridge"
echo "📁 Creating application directory: $APP_DIR"
sudo mkdir -p $APP_DIR
sudo chown $USER:$USER $APP_DIR

# Clone repository
echo "📥 Cloning ClosedBridge repository..."
cd $APP_DIR
git clone https://github.com/yourusername/ClosedBridge.git .

# Install dependencies
echo "📦 Installing Node.js dependencies..."
npm install

# Create environment file
echo "📝 Creating environment configuration..."
cat > .env << EOL
# Microsoft Graph API Configuration (REQUIRED)
AZURE_CLIENT_ID=your_azure_client_id_here
AZURE_CLIENT_SECRET=your_azure_client_secret_here
AZURE_TENANT_ID=your_azure_tenant_id_here
AZURE_REDIRECT_URI=https://yourdomain.com/api/auth-callback

# Admin Access (REQUIRED - Change this!)
ADMIN_TOKEN=admin-$(openssl rand -hex 12)

# Optional: Telegram Bot
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here

# Optional: Cloudflare Management
CLOUDFLARE_API_TOKEN=your_cloudflare_api_token_here
CLOUDFLARE_ZONE_ID=your_cloudflare_zone_id_here
EOL

# Create Nginx configuration
echo "🌐 Configuring Nginx..."
sudo tee /etc/nginx/sites-available/closedbridge > /dev/null << EOL
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        
        # Security headers
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-Server \$host;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Security headers
    add_header X-Content-Type-Options nosniff;
    add_header X-Frame-Options DENY;
    add_header X-XSS-Protection "1; mode=block";
}
EOL

# Enable Nginx site
sudo ln -sf /etc/nginx/sites-available/closedbridge /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Test Nginx configuration
sudo nginx -t

# Start and configure PM2
echo "🚀 Starting ClosedBridge with PM2..."
pm2 start npm --name "closedbridge" -- start
pm2 save
pm2 startup systemd

# Configure firewall
echo "🔥 Configuring firewall..."
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable

# Configure SSL with Let's Encrypt
echo ""
echo "🔒 SSL Certificate Setup"
echo "========================"
read -p "Enter your domain name (e.g., example.com) or press Enter to skip: " DOMAIN_NAME

if [ ! -z "$DOMAIN_NAME" ]; then
    # Update Nginx config with actual domain
    sudo sed -i "s/yourdomain.com/$DOMAIN_NAME/g" /etc/nginx/sites-available/closedbridge
    
    # Restart Nginx
    sudo systemctl restart nginx
    
    # Obtain SSL certificate
    echo "📜 Obtaining SSL certificate from Let's Encrypt..."
    sudo certbot --nginx -d $DOMAIN_NAME -d www.$DOMAIN_NAME --non-interactive --agree-tos --email admin@$DOMAIN_NAME --redirect
    
    # Update .env with HTTPS URL
    cd $APP_DIR
    sed -i "s|http://yourdomain.com|https://$DOMAIN_NAME|g" .env
    sed -i "s|DOMAIN=http://|DOMAIN=https://|g" .env
    
    echo "✅ SSL certificate installed successfully!"
    echo "🌐 Your site is now secured with HTTPS at: https://$DOMAIN_NAME"
else
    echo "⚠️ SSL setup skipped - you can add it later with:"
    echo "   sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com"
fi

# Restart services
echo "🔄 Restarting services..."
sudo systemctl restart nginx
sudo systemctl enable nginx

# Setup automatic SSL renewal
echo "🔄 Setting up automatic SSL certificate renewal..."
sudo systemctl enable certbot.timer
sudo systemctl start certbot.timer

# Create update script
echo "📝 Creating update script..."
cat > update.sh << EOL
#!/bin/bash
echo "🔄 Updating ClosedBridge..."
cd $APP_DIR
git pull origin main
npm install
pm2 restart closedbridge
echo "✅ Update complete!"
EOL
chmod +x update.sh

echo ""
echo "✅ Installation Complete!"
echo "========================"
echo ""
if [ ! -z "$DOMAIN_NAME" ]; then
    echo "🌐 Your app is available at: https://$DOMAIN_NAME"
    echo "🛠️  Admin panel: https://$DOMAIN_NAME/ad.html"
    echo "🔒 SSL: Enabled with automatic renewal"
else
    echo "🌐 Your app is available at: http://yourdomain.com"
    echo "🛠️  Admin panel: http://yourdomain.com/ad.html"
    echo "⚠️  SSL: Not configured (run certbot to add HTTPS)"
fi
echo ""
echo "📝 IMPORTANT: Update your configuration:"
echo "   nano $APP_DIR/.env"
echo ""
echo "📊 Check status:"
echo "   pm2 status"
echo "   sudo systemctl status nginx"
echo "   sudo certbot certificates  # Check SSL status"
echo ""
echo "📈 View logs:"
echo "   pm2 logs closedbridge"
echo ""
echo "🔄 To update later:"
echo "   cd $APP_DIR && ./update.sh"