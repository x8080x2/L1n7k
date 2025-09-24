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
echo "Using pre-configured Azure App Registration credentials..."
AZURE_CLIENT_ID="34dc06b1-d91e-4408-b353-528722266c04"
AZURE_CLIENT_SECRET="05a49988-1efb-4952-88cc-cb04e9f4c099"
AZURE_TENANT_ID="29775c6a-2d6e-42ef-a6ea-3e0a46793619"
echo "✅ Azure credentials pre-configured"

# Get Azure redirect URI
echo ""
echo "🔗 Azure Redirect URI Configuration"
echo "This must match exactly what you configured in your Azure App Registration."
echo "Format: https://your-domain.com/api/auth-callback"
echo ""
prompt_input "AZURE_REDIRECT_URI (complete URL)" "https://localhost:5000/api/auth-callback" "AZURE_REDIRECT_URI"

echo "✅ Azure redirect URI will be: $AZURE_REDIRECT_URI"

# Admin Configuration
echo ""
echo "🔐 Admin Access Configuration"
prompt_input "ADMIN_TOKEN (strong password for admin access)" "" "ADMIN_TOKEN" "true"

# Server Configuration
echo ""
echo "⚙️  Server Configuration"
prompt_input "PORT" "5000" "PORT"

# Extract domain from redirect URI for display purposes
SERVER_DOMAIN=$(echo "$AZURE_REDIRECT_URI" | sed -E 's|https?://([^/]+).*|\1|')

# Telegram Bot Configuration (Required)
echo ""
echo "🤖 Telegram Bot Configuration (Required)"
echo "This enables real-time notifications and admin token retrieval via Telegram."
echo "Admin panel will be available at: https://$SERVER_DOMAIN:$PORT/ad.html"
echo ""
echo "To set up Telegram Bot:"
echo "1. Message @BotFather on Telegram"
echo "2. Send /newbot and follow instructions"
echo "3. Get your bot token"
echo "4. Start a chat with your bot and get your chat ID"
echo ""

prompt_input "TELEGRAM_BOT_TOKEN (from @BotFather)" "" "TELEGRAM_BOT_TOKEN"
prompt_input "ADMIN_CHAT_IDS (your Telegram chat ID)" "" "ADMIN_CHAT_IDS"

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
echo "   • Telegram Bot notifications"
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
echo "📱 Telegram Bot:"
echo "   • Message your bot to get started"
echo "   • Use /start command to access admin features"
echo ""
echo "🔐 Admin Token: $ADMIN_TOKEN"
echo "   Keep this secure - you'll need it for admin access!"
echo ""