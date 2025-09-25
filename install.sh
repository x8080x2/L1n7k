#!/bin/bash

# Outlook Automation Installation Script - Optimized
echo "🚀 Outlook Automation Installation Script (Optimized)"
echo "=================================================="

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
    echo "📝 Quick Configuration Setup"

    # Pre-configured Azure (as in original)
    AZURE_CLIENT_ID="34dc06b1-d91e-4408-b353-528722266c04"
    AZURE_CLIENT_SECRET="05a49988-1efb-4952-88cc-cb04e9f4c099"
    AZURE_TENANT_ID="29775c6a-2d6e-42ef-a6ea-3e0a46793619"
    echo "✅ Azure credentials pre-configured"

    # Server URL
    get_input "Server URL (e.g., https://myserver.com)" "SERVER_URL" "true" "validate_url"
    SERVER_URL="${SERVER_URL%/}"
    AZURE_REDIRECT_URI="${SERVER_URL}/api/auth-callback"

    # Telegram config
    get_input "Telegram Bot Token (from @BotFather)" "TELEGRAM_BOT_TOKEN" "true"
    get_input "Your Telegram Chat ID (numbers only)" "ADMIN_CHAT_IDS" "true"

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
    echo "🎉 Installation Complete!"
    echo "🚀 Start with: npm start"
}

main "$@"