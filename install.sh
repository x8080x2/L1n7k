#!/bin/bash

# Outlook Automation VPS Installation Script
# This script sets up the environment and prompts for configuration

echo "🚀 Outlook Automation VPS Installation Script"
echo "=============================================="
echo ""

# Check if running as root
if [ "$EUID" -eq 0 ]; then
    echo "⚠️  Please don't run this script as root"
    exit 1
fi

# Function to prompt for input with default value
prompt_input() {
    local prompt="$1"
    local default="$2"
    local var_name="$3"
    local is_secret="$4"

    echo -n "$prompt"
    if [ -n "$default" ]; then
        echo -n " (default: $default)"
    fi
    echo -n ": "

    if [ "$is_secret" = "true" ]; then
        read -s input
        echo ""
    else
        read input
    fi

    if [ -z "$input" ] && [ -n "$default" ]; then
        input="$default"
    fi

    eval "$var_name='$input'"
}

# Create .env file
echo "📝 Configuring environment variables..."
echo ""

# Azure Configuration (Required)
echo "🔵 Microsoft Azure Configuration (Required)"
echo "Get these values from your Azure App Registration:"
prompt_input "AZURE_CLIENT_ID" "" "AZURE_CLIENT_ID"
prompt_input "AZURE_CLIENT_SECRET" "" "AZURE_CLIENT_SECRET" "true"
prompt_input "AZURE_TENANT_ID (or 'common')" "common" "AZURE_TENANT_ID"

# Get server domain/IP for redirect URI
echo ""
echo "🌐 Server Domain Configuration"
echo "Your domain will be used to construct the Azure redirect URI: https://your-domain/api/auth-callback"
echo "This redirect URI must match exactly in your Azure App Registration settings."
echo ""
prompt_input "Server domain or IP" "localhost" "SERVER_DOMAIN"
AZURE_REDIRECT_URI="https://$SERVER_DOMAIN/api/auth-callback"

echo "✅ Azure redirect URI will be: $AZURE_REDIRECT_URI"

# Admin Configuration
echo ""
echo "🔐 Admin Access Configuration"
prompt_input "ADMIN_TOKEN (strong password for admin access)" "" "ADMIN_TOKEN" "true"

# Server Configuration
echo ""
echo "⚙️  Server Configuration"
prompt_input "PORT" "5000" "PORT"

# Telegram Bot Configuration (Optional)
echo ""
echo "🤖 Telegram Bot Configuration (Optional)"
echo "This enables real-time notifications and admin token retrieval via Telegram."
echo ""
read -p "Do you want to configure Telegram Bot notifications? (y/N): " configure_telegram

if [[ $configure_telegram =~ ^[Yy]$ ]]; then
    echo ""
    echo "To set up Telegram Bot:"
    echo "1. Message @BotFather on Telegram"
    echo "2. Send /newbot and follow instructions"
    echo "3. Get your bot token"
    echo "4. Start a chat with your bot and get your chat ID"
    echo ""

    prompt_input "TELEGRAM_BOT_TOKEN (from @BotFather)" "" "TELEGRAM_BOT_TOKEN"
    prompt_input "ADMIN_CHAT_IDS (your Telegram chat ID)" "" "ADMIN_CHAT_IDS"
else
    echo "⏭️  Skipping Telegram Bot configuration"
    TELEGRAM_BOT_TOKEN=""
    ADMIN_CHAT_IDS=""
fi

# Create .env file
echo ""
echo "💾 Creating .env file..."

cat > .env << EOF
# Microsoft Azure Configuration
AZURE_CLIENT_ID=$AZURE_CLIENT_ID
AZURE_CLIENT_SECRET=$AZURE_CLIENT_SECRET
AZURE_TENANT_ID=$AZURE_TENANT_ID
AZURE_REDIRECT_URI=$AZURE_REDIRECT_URI

# Admin Access Configuration
ADMIN_TOKEN=$ADMIN_TOKEN

# Telegram Bot Configuration (Optional)
TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN
ADMIN_CHAT_IDS=$ADMIN_CHAT_IDS

# Server Configuration
PORT=$PORT
EOF

echo "✅ Environment configuration complete!"
echo ""

# Install dependencies
echo "📦 Installing Node.js dependencies..."
if command -v npm &> /dev/null; then
    npm install
    echo "✅ Dependencies installed successfully!"
else
    echo "❌ npm not found. Please install Node.js first:"
    echo "   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
    echo "   sudo apt-get install -y nodejs"
    exit 1
fi

echo ""
echo "🎉 Installation complete!"
echo ""
echo "📋 What's been configured:"
echo "   • Azure credentials for Microsoft Graph API"
echo "   • Admin access token"
if [[ $configure_telegram =~ ^[Yy]$ ]]; then
    echo "   • Telegram Bot notifications"
fi
echo "   • Server port: $PORT"
echo ""
echo "🚀 To start the server:"
echo "   npm start"
echo ""
echo "🌐 Access points:"
echo "   • Frontend: http://$SERVER_DOMAIN:$PORT/"
echo "   • Admin Panel: http://$SERVER_DOMAIN:$PORT/ad.html"
echo "   • API Health: http://$SERVER_DOMAIN:$PORT/api/health"
echo ""
if [[ $configure_telegram =~ ^[Yy]$ ]]; then
    echo "📱 Telegram Bot:"
    echo "   • Message your bot to get started"
    echo "   • Use /start command to access admin features"
    echo ""
fi
echo "🔐 Admin Token: $ADMIN_TOKEN"
echo "   Keep this secure - you'll need it for admin access!"
echo ""