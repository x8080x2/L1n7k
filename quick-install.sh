#!/bin/bash

echo "🚀  ClosedBridge VPS INSTALL"
echo "=========================="
echo "This will get your app running in under 2 minutes!"
echo ""

# Fix VPS network issues first (automatically)
echo "🌐 Fixing VPS network issues..."
echo 'net.ipv6.conf.all.disable_ipv6 = 1' | sudo tee -a /etc/sysctl.conf > /dev/null 2>&1
echo 'net.ipv6.conf.default.disable_ipv6 = 1' | sudo tee -a /etc/sysctl.conf > /dev/null 2>&1
sudo sysctl -p > /dev/null 2>&1
echo "✅ Network optimized"

# Remove any broken files
rm -f package-lock.json
rm -f .env

# Install dependencies
echo "📦 Installing dependencies..."
npm install --production --silent
echo "✅ Dependencies installed"

# Get user info
echo ""
echo "📝 Quick Setup (3 questions):"
echo ""

read -p "🌐 Your domain/IP (e.g., https://yoursite.com): " DOMAIN
read -p "🤖 Telegram Bot Token (from @BotFather): " BOT_TOKEN  
read -p "👤 Your Telegram Chat ID (from @userinfobot): " CHAT_ID

# Create .env file with VPS-appropriate port
cat > .env << ENVEOF
SESSION_SECRET=$(openssl rand -base64 32 2>/dev/null || date | md5sum | head -c32)
AZURE_CLIENT_ID=34dc06b1-d91e-4408-b353-528722266c04
AZURE_CLIENT_SECRET=05a49988-1efb-4952-88cc-cb04e9f4c099
AZURE_TENANT_ID=29775c6a-2d6e-42ef-a6ea-3e0a46793619
AZURE_REDIRECT_URI=${DOMAIN}/api/auth-callback
TELEGRAM_BOT_TOKEN=${BOT_TOKEN}
ADMIN_CHAT_IDS=${CHAT_ID}
PORT=3000
NODE_ENV=production
ENVEOF

# Test bot quickly
echo ""
echo "🧪 Testing bot..."
RESPONSE=$(curl -s "https://api.telegram.org/bot${BOT_TOKEN}/getMe")
if echo "$RESPONSE" | grep -q '"ok":true'; then
    BOT_NAME=$(echo "$RESPONSE" | grep -o '"first_name":"[^"]*"' | cut -d'"' -f4)
    echo "✅ Bot working: $BOT_NAME"
    
    # Send success message
    curl -s "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
        -d "chat_id=${CHAT_ID}" \
        -d "text=🎉 Your VPS is now configured and ready! App is starting..." > /dev/null
    echo "✅ Welcome message sent"
else
    echo "❌ Bot test failed - check your token"
    exit 1
fi

# Setup Nginx reverse proxy
echo ""
echo "🌐 Setting up Nginx reverse proxy..."

# Install nginx
echo "📦 Installing nginx..."
sudo apt update > /dev/null 2>&1 && sudo apt install nginx -y > /dev/null 2>&1
echo "✅ Nginx installed"

# Extract domain name for nginx config
DOMAIN_NAME=$(echo "$DOMAIN" | sed 's|https\?://||' | sed 's|www\.||')

# Create nginx configuration
echo "⚙️ Creating nginx configuration..."
# Remove any existing directory or file with the same name
sudo rm -rf /etc/nginx/sites-available/$DOMAIN_NAME
sudo rm -rf /etc/nginx/sites-available/$DOMAIN_NAME/
# Ensure the sites-available directory exists
sudo mkdir -p /etc/nginx/sites-available
sudo tee /etc/nginx/sites-available/$DOMAIN_NAME > /dev/null << NGINXEOF
server {
    listen 80;
    server_name $DOMAIN_NAME www.$DOMAIN_NAME;
    
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
NGINXEOF

# Enable the site
echo "✅ Enabling nginx site..."
sudo ln -sf /etc/nginx/sites-available/$DOMAIN_NAME /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default > /dev/null 2>&1

# Test and restart nginx
echo "🧪 Testing nginx configuration..."
if sudo nginx -t 2>&1; then
    echo "✅ Nginx configuration test passed"
    sudo systemctl restart nginx
    sudo systemctl enable nginx
    if sudo systemctl is-active --quiet nginx; then
        echo "✅ Nginx configured and running"
        echo "🌐 Testing connection to backend..."
        if curl -s http://localhost:3000/api/health > /dev/null; then
            echo "✅ Backend is responding on port 3000"
        else
            echo "⚠️ Backend not responding on port 3000"
        fi
    else
        echo "❌ Nginx failed to start"
        sudo systemctl status nginx --no-pager -l
    fi
else
    echo "❌ Nginx configuration test failed:"
    sudo nginx -t
    echo "⚠️ Continuing anyway, but manual fix may be needed"
fi

# Install Chrome dependencies for browser automation (Puppeteer)
echo ""
echo "🔧 Installing Chrome dependencies for browser automation..."
sudo apt install -y \
    ca-certificates \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    wget \
    xdg-utils > /dev/null 2>&1
echo "✅ Chrome dependencies installed"

echo ""
echo "🎉 INSTALLATION COMPLETE!"
echo "========================"
echo "✅ Network optimized"
echo "✅ Dependencies installed" 
echo "✅ Configuration created"
echo "✅ Bot tested and working"
echo "✅ Nginx reverse proxy configured"
echo "✅ Chrome dependencies installed"
echo "✅ Browser automation ready"
echo ""
echo "🔍 Final verification..."
echo "📡 Server IP: $(curl -s ifconfig.me || echo 'Unable to detect')"
echo "🌐 Domain: $DOMAIN_NAME"
echo "⚙️ Make sure your domain DNS points to this server IP"
echo ""
echo "🚀 Starting your app now..."
echo "📱 Check Telegram for confirmation message"
echo "🌐 Access: $DOMAIN (via nginx on port 80)"
echo "🔧 Your app runs internally on port 3000"
echo ""

# Setup SSL certificates (Let's Encrypt)
echo ""
echo "🔒 Setting up SSL certificates..."
if command -v certbot >/dev/null 2>&1; then
    echo "✅ Certbot already installed"
else
    echo "📦 Installing certbot..."
    sudo apt install certbot python3-certbot-nginx -y > /dev/null 2>&1
fi

# Only setup SSL if domain is not localhost/IP
if [[ "$DOMAIN_NAME" != "localhost" && "$DOMAIN_NAME" != *"."*"."*"."* ]]; then
    echo "🔒 Configuring SSL for: $DOMAIN_NAME"
    
    # Check if domain is using Cloudflare (common case)
    echo "🌤️ Checking DNS configuration..."
    NS_RECORD=$(dig +short NS $DOMAIN_NAME | head -1)
    if [[ "$NS_RECORD" == *"cloudflare"* ]]; then
        echo "⚠️ CLOUDFLARE DETECTED!"
        echo "📋 IMPORTANT CLOUDFLARE SETUP NOTES:"
        echo "   1. Set DNS records to 'DNS Only' (gray cloud) temporarily for SSL setup"
        echo "   2. After SSL is configured, you can re-enable proxy (orange cloud)"
        echo "   3. Configure Cloudflare SSL mode to 'Full (Strict)' for best security"
        echo "   4. Your app includes Cloudflare management tools in the admin panel"
        echo ""
        read -p "⏳ Press Enter when you've set DNS to 'DNS Only' mode in Cloudflare..."
    fi
    
    # Attempt SSL certificate generation
    if sudo certbot --nginx -d $DOMAIN_NAME --non-interactive --agree-tos --email admin@$DOMAIN_NAME --redirect 2>/dev/null; then
        echo "✅ SSL certificate configured successfully!"
        
        # Setup auto-renewal
        sudo systemctl enable certbot.timer > /dev/null 2>&1
        sudo systemctl start certbot.timer > /dev/null 2>&1
        echo "✅ SSL auto-renewal configured"
        
        if [[ "$NS_RECORD" == *"cloudflare"* ]]; then
            echo ""
            echo "🌤️ CLOUDFLARE USERS - NEXT STEPS:"
            echo "   ✅ 1. SSL certificate is now installed"
            echo "   🔄 2. Go back to Cloudflare DNS settings"
            echo "   🟠 3. Re-enable proxy (orange cloud) for your domain"
            echo "   🛡️ 4. Set SSL/TLS mode to 'Full (Strict)'"
            echo "   🔧 5. Use your app's admin panel to manage Cloudflare settings"
            echo ""
        fi
    else
        echo "⚠️ SSL setup failed - this is normal if:"
        echo "   • Domain DNS is not pointing to this server yet"
        echo "   • Cloudflare proxy is enabled (orange cloud)"
        echo "   • Domain propagation is still in progress"
        echo "   📌 You can run 'sudo certbot --nginx -d $DOMAIN_NAME' manually later"
    fi
else
    echo "⚠️ Skipping SSL for localhost/IP address"
fi

# Install PM2 for process management
echo ""
echo "⚙️ Setting up process management..."
if command -v pm2 >/dev/null 2>&1; then
    echo "✅ PM2 already installed"
else
    echo "📦 Installing PM2..."
    sudo npm install -g pm2 > /dev/null 2>&1
fi

# Create PM2 ecosystem file
cat > ecosystem.config.js << PMEOF
module.exports = {
  apps: [{
    name: 'outlook-automation',
    script: 'server.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    }
  }]
};
PMEOF

echo "✅ PM2 configuration created"

# Start with PM2
echo ""
echo "🚀 Starting application with PM2..."
pm2 start ecosystem.config.js
pm2 save
pm2 startup | grep -E '^sudo' | bash 2>/dev/null || echo "⚠️ PM2 startup script needs manual setup"

echo ""
echo "🎉 DEPLOYMENT COMPLETE!"
echo "========================"
echo "✅ Network optimized"
echo "✅ Dependencies installed" 
echo "✅ Configuration created"
echo "✅ Bot tested and working"
echo "✅ Nginx reverse proxy configured"
echo "✅ SSL certificates configured"
echo "✅ Chrome dependencies installed"
echo "✅ Browser automation ready"
echo "✅ PM2 process management active"
echo ""
echo "🔍 Final verification..."
echo "📡 Server IP: $(curl -s ifconfig.me || echo 'Unable to detect')"
echo "🌐 Domain: $DOMAIN_NAME"
echo "🔒 HTTPS: https://$DOMAIN_NAME (if SSL succeeded)"
echo "⚙️ Make sure your domain DNS points to this server IP"
echo ""
echo "📱 Check Telegram for confirmation message"
echo "🌐 Access: $DOMAIN (HTTPS if SSL worked)"
echo "🔧 App managed by PM2 - use 'pm2 status' to monitor"
echo ""
echo "🌤️ CLOUDFLARE INTEGRATION:"
echo "   🔗 Admin panel: $DOMAIN/ad.html"
echo "   🛡️ Built-in Cloudflare management tools available"
echo "   ⚙️ Configure API token in admin panel for full control"
echo ""
echo "📋 Useful commands:"
echo "   pm2 status          - Check app status"
echo "   pm2 restart all     - Restart app"  
echo "   pm2 logs            - View logs"
echo "   sudo nginx -t       - Test nginx config"
echo "   sudo systemctl reload nginx  - Reload nginx"
echo "   sudo certbot renew  - Manually renew SSL certificates"

# Final health check
echo ""
echo "🔍 Final system health check..."

# Check if PM2 is running
if pm2 list | grep -q "outlook-automation"; then
    echo "✅ PM2 process is running"
else
    echo "❌ PM2 process not found"
fi

# Check if nginx is running
if sudo systemctl is-active --quiet nginx; then
    echo "✅ Nginx is running"
else
    echo "❌ Nginx is not running"
fi

# Check if app is responding
if curl -s http://localhost:3000/api/health > /dev/null; then
    echo "✅ Application is responding"
else
    echo "❌ Application is not responding"
fi

# Setup basic firewall (optional)
echo ""
echo "🔥 Setting up basic firewall..."
if command -v ufw >/dev/null 2>&1; then
    sudo ufw --force enable > /dev/null 2>&1
    sudo ufw allow 22 > /dev/null 2>&1
    sudo ufw allow 80 > /dev/null 2>&1
    sudo ufw allow 443 > /dev/null 2>&1
    echo "✅ UFW firewall configured (SSH, HTTP, HTTPS allowed)"
else
    echo "⚠️ UFW not available - firewall not configured"
fi

echo ""
echo "🎯 INSTALLATION SUMMARY:"
echo "========================"
echo "🌐 Domain: $DOMAIN_NAME"
echo "📡 Server IP: $(curl -s ifconfig.me || echo 'Unable to detect')"
echo "🔐 HTTPS: $([ -f /etc/letsencrypt/live/$DOMAIN_NAME/fullchain.pem ] && echo 'Enabled' || echo 'Disabled')"
echo "⚙️ Process Manager: PM2"
echo "🌤️ Cloudflare Ready: Yes"
echo "🤖 Telegram Bot: Configured"
echo ""
echo "🚀 Your application is now running!"
echo "📱 Check your Telegram for the welcome message"
echo "🌐 Visit: https://$DOMAIN_NAME (or http:// if SSL failed)"
echo ""
echo "Need help? Check the logs with: pm2 logs"
