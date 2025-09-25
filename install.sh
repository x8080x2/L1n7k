#!/bin/bash

# Outlook Automation Installation Script
echo "🚀 Outlook Automation Installation Script"
echo "=========================================="

# Check if running as root
if [ "$EUID" -eq 0 ]; then
    echo "⚠️  Please don't run this script as root"
    exit 1
fi

# Function to prompt for input with validation
prompt_input() {
    local prompt="$1"
    local default="$2"
    local var_name="$3"
    local required="$4"
    local input=""

    while true; do
        echo -n "$prompt"
        if [ -n "$default" ]; then
            echo -n " (default: $default)"
        fi
        if [ "$required" = "true" ]; then
            echo -n " [REQUIRED]"
        fi
        echo -n ": "
        read input

        # Use default if input is empty and default exists
        if [ -z "$input" ] && [ -n "$default" ]; then
            input="$default"
        fi

        # Check if required field is empty
        if [ "$required" = "true" ] && [ -z "$input" ]; then
            echo "❌ This field is required. Please enter a value."
            continue
        fi

        # Validate URL format for server URL
        if [ "$var_name" = "SERVER_URL" ] && [ -n "$input" ]; then
            if [[ ! "$input" =~ ^https?:// ]]; then
                echo "❌ Server URL must start with http:// or https://"
                echo "   Example: https://myserver.com or https://12.34.56.78"
                continue
            fi
        fi

        break
    done

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
echo ""
echo "🌐 Server Configuration"
echo "Enter your server's public URL (where users will access the application)"
echo "Examples: https://myserver.com, https://outlook.mydomain.com, https://12.34.56.78"
prompt_input "Server URL" "" "SERVER_URL" "true"
prompt_input "Port" "5000" "PORT"

# Clean up SERVER_URL (remove trailing slash)
SERVER_URL="${SERVER_URL%/}"

# Build Azure redirect URI
AZURE_REDIRECT_URI="${SERVER_URL}/api/auth-callback"

# Admin Configuration
echo ""
echo "🔐 Admin Access Setup (Required)"
echo "Create a secure admin token for accessing the admin panel and managing sessions"
echo "This should be a strong password/token (min 12 characters recommended)"
while true; do
    prompt_input "Admin Token (secure password)" "" "ADMIN_TOKEN" "true"
    if [ ${#ADMIN_TOKEN} -lt 8 ]; then
        echo "❌ Admin token should be at least 8 characters long for security"
        continue
    fi
    break
done

# Telegram Bot Configuration
echo ""
echo "🤖 Telegram Bot Setup (Optional but recommended)"
echo "Provides: real-time notifications, remote admin access, monitoring alerts"
echo "To set up:"
echo "  1. Message @BotFather on Telegram"
echo "  2. Use /newbot command to create a bot"
echo "  3. Copy the bot token (format: 123456789:ABCdefGHI...)"
echo ""
prompt_input "Telegram Bot Token (from @BotFather)" "" "TELEGRAM_BOT_TOKEN" "false"

if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
    echo ""
    echo "📱 Get your Telegram Chat ID:"
    echo "  1. Message your bot with any text (e.g., 'hello')"
    echo "  2. Open this URL in browser: https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates"
    echo "  3. Look for 'chat':{'id': NUMBER} and copy that number"
    echo "  4. Example: if you see 'id': 123456789, enter 123456789"
    echo ""
    prompt_input "Your Telegram Chat ID (number only)" "" "ADMIN_CHAT_IDS" "false"
    
    if [ -n "$ADMIN_CHAT_IDS" ]; then
        echo "✅ Telegram bot configured successfully"
    else
        echo "⚠️  Telegram bot token set but no chat ID. You can add it later."
    fi
fi

# Show final Azure Redirect URI 
echo ""
echo "🔗 Azure Redirect URI Configuration"
echo "Your Azure app registration must include this redirect URI:"
echo "➜ ${AZURE_REDIRECT_URI}"
echo ""
echo "To configure in Azure:"
echo "  1. Go to Azure Portal → App registrations → Your app"
echo "  2. Go to Authentication → Add a platform → Web"
echo "  3. Add redirect URI: ${AZURE_REDIRECT_URI}"
echo "  4. Enable 'Access tokens' and 'ID tokens'"
echo ""
read -p "Press Enter after configuring Azure redirect URI..." -r

# Create .env file
echo ""
echo "💾 Creating configuration file..."

# Generate a random session secret
SESSION_SECRET=$(openssl rand -base64 64 2>/dev/null || head -c 64 /dev/urandom | base64)

cat > .env << EOF
# Session Security
SESSION_SECRET="$SESSION_SECRET"

# Microsoft Azure Configuration
AZURE_CLIENT_ID="$AZURE_CLIENT_ID"
AZURE_CLIENT_SECRET="$AZURE_CLIENT_SECRET" 
AZURE_TENANT_ID="$AZURE_TENANT_ID"
AZURE_REDIRECT_URI="$AZURE_REDIRECT_URI"

# Admin Access Configuration
ADMIN_TOKEN="$ADMIN_TOKEN"

# Telegram Bot Configuration (Optional)
$([ -n "$TELEGRAM_BOT_TOKEN" ] && echo "TELEGRAM_BOT_TOKEN=\"$TELEGRAM_BOT_TOKEN\"" || echo "#TELEGRAM_BOT_TOKEN=\"\"")
$([ -n "$ADMIN_CHAT_IDS" ] && echo "ADMIN_CHAT_IDS=\"$ADMIN_CHAT_IDS\"" || echo "#ADMIN_CHAT_IDS=\"\"")

# Server Configuration  
PORT=$PORT
EOF

echo "✅ Configuration file (.env) created successfully"

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
echo "📋 Configuration Summary:"
echo "   🌐 Server URL: $SERVER_URL"
echo "   🎛️  Admin Panel: $SERVER_URL/ad.html"
echo "   🔑 Azure Redirect: $AZURE_REDIRECT_URI"
echo "   🔐 Admin Token: ✅ Configured (keep secure!)"

if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
    if [ -n "$ADMIN_CHAT_IDS" ]; then
        echo "   🤖 Telegram Bot: ✅ Fully configured"
    else
        echo "   🤖 Telegram Bot: ⚠️  Token set, add chat ID later"
    fi
else
    echo "   🤖 Telegram Bot: ❌ Not configured (optional)"
fi

echo ""
echo "🚀 Next Steps:"
echo "1. Start the server:"
echo "   npm start"
echo ""
echo "2. Access your application:"
echo "   Main App: $SERVER_URL"
echo "   Admin Panel: $SERVER_URL/ad.html"
echo ""
echo "3. Use your admin token to access the admin panel"
echo ""
if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -z "$ADMIN_CHAT_IDS" ]; then
    echo "4. Optional: Add Telegram chat ID later by editing .env file"
    echo ""
fi
echo "✅ Your Outlook Automation system is ready to use!"
echo ""
echo "💡 Security Note: Keep your .env file secure and never commit it to version control"