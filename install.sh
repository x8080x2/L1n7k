#!/bin/bash

# Outlook Automation VPS Installation Script
echo "🚀 Outlook Automation VPS Installation Script"
echo "=============================================="

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

echo "📝 Configuring environment variables..."

# Azure Configuration (Required)
echo "🔵 Microsoft Azure Configuration"
AZURE_CLIENT_ID="34dc06b1-d91e-4408-b353-528722266c04"
AZURE_CLIENT_SECRET="05a49988-1efb-4952-88cc-cb04e9f4c099"
AZURE_TENANT_ID="29775c6a-2d6e-42ef-a6ea-3e0a46793619"
echo "✅ Azure credentials pre-configured"

# Server Configuration
echo "🌐 Server Configuration"
prompt_input "SERVER_URL" "https://localhost:5000" "SERVER_URL"
prompt_input "PORT" "5000" "PORT"

# Build Azure redirect URI
AZURE_REDIRECT_URI="${SERVER_URL}/api/auth-callback"

# Telegram Bot Configuration
echo "🤖 Telegram Bot Configuration (Required for admin access)"
echo "Admin token will be auto-generated and accessible via Telegram bot."
prompt_input "TELEGRAM_BOT_TOKEN (from @BotFather)" "" "TELEGRAM_BOT_TOKEN"

if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
    prompt_input "ADMIN_CHAT_IDS (your Telegram chat ID)" "" "ADMIN_CHAT_IDS"
    if [ -z "$ADMIN_CHAT_IDS" ]; then
        echo "⚠️  Warning: Bot token provided but no chat ID. Admin access will not work."
    fi
else
    echo "⚠️  No Telegram bot configured. Admin token will only be in server logs."
    ADMIN_CHAT_IDS=""
fi

# Create .env file
echo "💾 Creating .env file..."
cat > .env << EOF
# Microsoft Azure Configuration
AZURE_CLIENT_ID=$AZURE_CLIENT_ID
AZURE_CLIENT_SECRET=$AZURE_CLIENT_SECRET
AZURE_TENANT_ID=$AZURE_TENANT_ID
AZURE_REDIRECT_URI=$AZURE_REDIRECT_URI

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

echo "🎉 Installation complete!"
echo ""
echo "📋 Configuration Summary:"
echo "   • Server URL: $SERVER_URL"
echo "   • Server Port: $PORT"
if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
echo "   • Telegram Bot: ✅ Configured"
echo "   • Admin token will be auto-generated and accessible via Telegram"
else
echo "   • Telegram Bot: ⚠️ Not configured"
echo "   • Admin token will be in server logs only"
fi
echo ""
echo "🚀 To start: npm start"
echo "🌐 Access: $SERVER_URL/"
echo "🔧 Admin Panel: $SERVER_URL/ad.html"
if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
echo "📱 Get admin token via your Telegram bot"
fi