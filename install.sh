#!/bin/bash

# Outlook Automation Installation Script
echo "🚀 Outlook Automation Installation Script"
echo "=========================================="

# Check if running as root
if [ "$EUID" -eq 0 ]; then
    echo "⚠️  Please don't run this script as root"
    exit 1
fi

# Function to prompt for input
prompt_input() {
    local prompt="$1"
    local default="$2"
    local var_name="$3"

    echo -n "$prompt"
    if [ -n "$default" ]; then
        echo -n " (default: $default)"
    fi
    echo -n ": "
    read input

    if [ -z "$input" ] && [ -n "$default" ]; then
        input="$default"
    fi

    eval "$var_name='$input'"
}

echo ""
echo "📝 Configuration Setup"

# Azure Configuration (Pre-configured)
AZURE_CLIENT_ID="34dc06b1-d91e-4408-b353-528722266c04"
AZURE_CLIENT_SECRET="05a49988-1efb-4952-88cc-cb04e9f4c099"
AZURE_TENANT_ID="29775c6a-2d6e-42ef-a6ea-3e0a46793619"
echo "✅ Azure credentials pre-configured"

# Server Configuration
prompt_input "Domain/Server URL" "https://your-domain.com" "SERVER_URL"
prompt_input "Port" "5000" "PORT"

# Build Azure redirect URI
AZURE_REDIRECT_URI="${SERVER_URL}/api/auth-callback"

# Admin Configuration
echo ""
echo "🔐 Admin Access Setup (Required)"
echo "Admin token provides access to admin panel and session management"
prompt_input "Admin Token (secure password)" "" "ADMIN_TOKEN"

# Telegram Bot Configuration
echo ""
echo "🤖 Telegram Bot Setup (Required for notifications)"
echo "Provides: notifications, admin token access, remote management"
echo "Get bot token from @BotFather on Telegram"
prompt_input "Telegram Bot Token (from @BotFather)" "" "TELEGRAM_BOT_TOKEN"

if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
    echo ""
    echo "Get your Chat ID:"
    echo "1. Message your bot"
    echo "2. Visit: https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates"
    echo "3. Copy your chat ID from the response"
    prompt_input "Your Telegram Chat ID" "" "ADMIN_CHAT_IDS"
fi

# Azure Redirect URI Configuration
echo ""
echo "🔗 Azure Redirect URI Setup (Required)"
echo "This should match your Azure app registration redirect URI"
prompt_input "Azure Redirect URI" "${SERVER_URL}/api/auth-callback" "AZURE_REDIRECT_URI"

# Create .env file
echo ""
echo "💾 Creating configuration..."
cat > .env << EOF
# Microsoft Azure Configuration
AZURE_CLIENT_ID=$AZURE_CLIENT_ID
AZURE_CLIENT_SECRET=$AZURE_CLIENT_SECRET
AZURE_TENANT_ID=$AZURE_TENANT_ID
AZURE_REDIRECT_URI=$AZURE_REDIRECT_URI

# Admin Access Configuration
ADMIN_TOKEN=$ADMIN_TOKEN

# Telegram Bot Configuration
TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN
ADMIN_CHAT_IDS=$ADMIN_CHAT_IDS

# Server Configuration  
PORT=$PORT
SERVER_URL=$SERVER_URL
EOF

# Install dependencies
echo "📦 Installing dependencies..."
if command -v npm &> /dev/null; then
    npm install
    echo "✅ Dependencies installed!"
else
    echo "❌ npm not found. Please install Node.js first."
    exit 1
fi

echo ""
echo "🎉 Installation Complete!"
echo ""
echo "📋 Summary:"
echo "   Server: $SERVER_URL"
echo "   Admin Panel: $SERVER_URL/ad.html"
echo "   Azure Redirect: $AZURE_REDIRECT_URI"

if [ -n "$ADMIN_TOKEN" ]; then
    echo "   Admin Token: ✅ Configured"
else
    echo "   Admin Token: ❌ Not configured (will auto-generate)"
fi

if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
    if [ -n "$ADMIN_CHAT_IDS" ]; then
        echo "   Telegram: ✅ Configured"
    else
        echo "   Telegram: ⚠️  Bot configured, no chat ID"
    fi
else
    echo "   Telegram: ❌ Not configured"
fi

echo ""
echo "🔧 Next Steps:"
echo "1. Update Azure app with redirect URI: $AZURE_REDIRECT_URI"
echo "2. Start server: npm start"
if [ -n "$ADMIN_TOKEN" ]; then
    echo "3. Access admin panel with your configured admin token"
    if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$ADMIN_CHAT_IDS" ]; then
        echo "4. Use Telegram bot for notifications and remote access"
    fi
else
    if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$ADMIN_CHAT_IDS" ]; then
        echo "3. Get auto-generated admin token via Telegram bot"
    else
        echo "3. Check server logs for auto-generated admin token"
    fi
fi