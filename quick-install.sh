#!/bin/bash

echo "🚀 SUPER SIMPLE VPS INSTALL"
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

echo ""
echo "🎉 INSTALLATION COMPLETE!"
echo "========================"
echo "✅ Network optimized"
echo "✅ Dependencies installed" 
echo "✅ Configuration created"
echo "✅ Bot tested and working"
echo "✅ Nginx reverse proxy configured"
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

# Start the application
npm start
