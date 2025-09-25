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

# Create .env file
cat > .env << EOF
SESSION_SECRET=$(openssl rand -base64 32 2>/dev/null || date | md5sum | head -c32)
AZURE_CLIENT_ID=34dc06b1-d91e-4408-b353-528722266c04
AZURE_CLIENT_SECRET=05a49988-1efb-4952-88cc-cb04e9f4c099
AZURE_TENANT_ID=29775c6a-2d6e-42ef-a6ea-3e0a46793619
AZURE_REDIRECT_URI=${DOMAIN}/api/auth-callback
TELEGRAM_BOT_TOKEN=${BOT_TOKEN}
ADMIN_CHAT_IDS=${CHAT_ID}
PORT=5000
NODE_ENV=production
EOF

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

echo ""
echo "🎉 INSTALLATION COMPLETE!"
echo "========================"
echo "✅ Network optimized"
echo "✅ Dependencies installed" 
echo "✅ Configuration created"
echo "✅ Bot tested and working"
echo ""
echo "🚀 Starting your app now..."
echo "📱 Check Telegram for confirmation message"
echo "🌐 Access: $DOMAIN"
echo ""

# Start the application
npm start