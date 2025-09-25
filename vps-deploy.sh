#!/bin/bash
set -e

# Outlook Automation VPS Deployment Script (Production Ready)
echo "🚀 Outlook Automation VPS Deployment Script"
echo "============================================="
echo "This script will set up your VPS for production deployment"
echo ""

# Configuration
APP_NAME="outlook-automation"
APP_DIR="/var/www/$APP_NAME"
REPO_URL="https://github.com/x8080x2/L1n7k.git"
NODE_PORT="5000"
DOMAIN="your-domain.com"  # Update this
USER="ubuntu"  # Update this if different

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Utility functions
log_info() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_warn() {
    echo -e "${YELLOW}⚠️ $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Check if running as root
if [[ $EUID -eq 0 ]]; then
   log_error "This script should not be run as root for security reasons"
   log_info "Please run as a non-root user with sudo privileges"
   exit 1
fi

# Check system requirements
check_requirements() {
    log_info "Checking system requirements..."
    
    # Check OS
    if [[ ! -f /etc/lsb-release ]] && [[ ! -f /etc/debian_version ]]; then
        log_error "This script is designed for Ubuntu/Debian systems"
        exit 1
    fi
    
    # Check sudo access
    if ! sudo -n true 2>/dev/null; then
        log_error "This user needs sudo privileges"
        exit 1
    fi
    
    log_info "System requirements met"
}

# Update system packages
update_system() {
    log_info "Updating system packages..."
    sudo apt update
    sudo apt upgrade -y
    log_info "System updated"
}

# Install essential packages
install_packages() {
    log_info "Installing essential packages..."
    sudo apt install -y \
        curl \
        wget \
        git \
        build-essential \
        ufw \
        nginx \
        certbot \
        python3-certbot-nginx \
        fail2ban \
        htop \
        unzip
    log_info "Essential packages installed"
}

# Install Node.js
install_nodejs() {
    log_info "Installing Node.js (Latest LTS)..."
    
    # Remove old Node.js if exists
    sudo apt remove -y nodejs npm
    
    # Install NodeSource repository
    curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
    sudo apt install -y nodejs
    
    # Verify installation
    node_version=$(node --version)
    npm_version=$(npm --version)
    log_info "Node.js $node_version and npm $npm_version installed"
}

# Install PM2
install_pm2() {
    log_info "Installing PM2 process manager..."
    sudo npm install -g pm2@latest
    
    # Setup PM2 startup script
    pm2 startup systemd -u $USER --hp /home/$USER
    sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u $USER --hp /home/$USER
    
    log_info "PM2 installed and startup configured"
}

# Configure firewall
setup_firewall() {
    log_info "Configuring UFW firewall..."
    
    # Reset firewall to defaults
    sudo ufw --force reset
    
    # Default policies
    sudo ufw default deny incoming
    sudo ufw default allow outgoing
    
    # Allow SSH (important!)
    sudo ufw allow OpenSSH
    
    # Allow HTTP and HTTPS
    sudo ufw allow 'Nginx Full'
    
    # Enable firewall
    sudo ufw --force enable
    
    log_info "Firewall configured and enabled"
}

# Setup Fail2Ban
setup_fail2ban() {
    log_info "Configuring Fail2Ban..."
    
    # Copy default configuration
    sudo cp /etc/fail2ban/jail.conf /etc/fail2ban/jail.local
    
    # Create custom jail for nginx
    sudo tee /etc/fail2ban/jail.d/nginx.conf > /dev/null << EOF
[nginx-http-auth]
enabled = true
filter = nginx-http-auth
action = iptables-multiport[name=NoAuthFailures, port="http,https"]
logpath = /var/log/nginx*/*error*.log
bantime = 600
findtime = 600
maxretry = 5

[nginx-dos]
enabled = true
filter = nginx-dos
action = iptables-multiport[name=NoScript, port="http,https"]
logpath = /var/log/nginx/access.log
bantime = 600
findtime = 600
maxretry = 10
EOF

    # Restart fail2ban
    sudo systemctl restart fail2ban
    sudo systemctl enable fail2ban
    
    log_info "Fail2Ban configured"
}

# Clone application
clone_application() {
    log_info "Cloning application from GitHub..."
    
    # Create app directory
    sudo mkdir -p $APP_DIR
    
    # Clone repository
    cd /tmp
    git clone $REPO_URL outlook-automation-temp
    
    # Move files to app directory
    sudo cp -r outlook-automation-temp/* $APP_DIR/
    sudo chown -R $USER:$USER $APP_DIR
    
    # Cleanup
    rm -rf outlook-automation-temp
    
    cd $APP_DIR
    log_info "Application cloned to $APP_DIR"
}

# Install application dependencies
install_app_dependencies() {
    log_info "Installing application dependencies..."
    
    cd $APP_DIR
    
    # Install production dependencies
    npm ci --only=production
    
    # Create logs directory
    mkdir -p logs
    mkdir -p session_data
    
    log_info "Application dependencies installed"
}

# Create PM2 ecosystem file
create_pm2_config() {
    log_info "Creating PM2 ecosystem configuration..."
    
    cat > $APP_DIR/ecosystem.config.js << EOF
module.exports = {
  apps: [{
    name: '$APP_NAME',
    script: './server.js',
    instances: 'max',
    exec_mode: 'cluster',
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: $NODE_PORT
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true,
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s'
  }]
};
EOF

    log_info "PM2 ecosystem configuration created"
}

# Setup environment variables
setup_environment() {
    log_info "Setting up environment variables..."
    
    # Create .env template if not exists
    if [[ ! -f $APP_DIR/.env ]]; then
        cat > $APP_DIR/.env << EOF
# Azure/Microsoft Graph API Configuration
# IMPORTANT: Replace these with your actual Azure App Registration values
AZURE_CLIENT_ID=your_azure_client_id_here
AZURE_CLIENT_SECRET=your_azure_client_secret_here
AZURE_TENANT_ID=your_azure_tenant_id_here
AZURE_REDIRECT_URI=https://$DOMAIN/api/auth-callback

# Optional: Telegram Bot Configuration
# TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here

# Admin Token (auto-generated if not set)
# ADMIN_TOKEN=your_secure_admin_token_here

# Production Settings
NODE_ENV=production
PORT=$NODE_PORT
EOF
        
        log_warn "Created .env template at $APP_DIR/.env"
        log_warn "IMPORTANT: Update the Azure credentials in the .env file!"
    fi
}

# Configure Nginx
setup_nginx() {
    log_info "Configuring Nginx reverse proxy..."
    
    # Create Nginx configuration
    sudo tee /etc/nginx/sites-available/$DOMAIN > /dev/null << EOF
upstream nodejs_backend {
    server 127.0.0.1:$NODE_PORT;
    keepalive 64;
}

server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;
    return 301 https://\$server_name\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name $DOMAIN www.$DOMAIN;

    # SSL Configuration (will be updated by certbot)
    ssl_certificate /etc/ssl/certs/ssl-cert-snakeoil.pem;
    ssl_certificate_key /etc/ssl/private/ssl-cert-snakeoil.key;
    ssl_session_timeout 1d;
    ssl_session_cache shared:MozTLS:10m;
    ssl_session_tickets off;

    # Security headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    add_header Strict-Transport-Security "max-age=63072000" always;

    # Gzip compression
    gzip on;
    gzip_types text/plain application/json application/javascript text/css application/xml text/xml;

    location / {
        proxy_pass http://nodejs_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 86400;
    }

    # Static assets caching
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)\$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
EOF

    # Enable site
    sudo ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/
    
    # Remove default site
    sudo rm -f /etc/nginx/sites-enabled/default
    
    # Test configuration
    sudo nginx -t
    
    # Reload nginx
    sudo systemctl reload nginx
    
    log_info "Nginx configured for $DOMAIN"
}

# Setup SSL with Let's Encrypt
setup_ssl() {
    log_info "Setting up SSL certificate with Let's Encrypt..."
    log_warn "Make sure your domain $DOMAIN points to this server's IP address"
    
    read -p "Press Enter to continue with SSL setup, or Ctrl+C to skip..."
    
    # Get SSL certificate
    sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN --non-interactive --agree-tos --email admin@$DOMAIN --redirect
    
    # Setup auto-renewal
    sudo systemctl enable certbot.timer
    
    log_info "SSL certificate installed and auto-renewal configured"
}

# Start application
start_application() {
    log_info "Starting application with PM2..."
    
    cd $APP_DIR
    
    # Start application
    pm2 start ecosystem.config.js
    
    # Save PM2 configuration
    pm2 save
    
    log_info "Application started successfully"
}

# Setup log rotation
setup_log_rotation() {
    log_info "Setting up log rotation..."
    
    # Install PM2 log rotate module
    pm2 install pm2-logrotate
    
    # Configure log rotation
    pm2 set pm2-logrotate:max_size 10M
    pm2 set pm2-logrotate:retain 7
    pm2 set pm2-logrotate:compress true
    
    # Create nginx log rotation
    sudo tee /etc/logrotate.d/nginx-$APP_NAME > /dev/null << EOF
/var/log/nginx/*.log {
    daily
    missingok
    rotate 7
    compress
    delaycompress
    notifempty
    create 644 nginx adm
    postrotate
        if [ -f /var/run/nginx.pid ]; then
            kill -USR1 \`cat /var/run/nginx.pid\`
        fi
    endscript
}
EOF

    log_info "Log rotation configured"
}

# Display final information
show_final_info() {
    echo ""
    echo "=========================================="
    log_info "VPS Deployment Completed Successfully!"
    echo "=========================================="
    echo ""
    echo "📋 Next Steps:"
    echo "   1. Update $APP_DIR/.env with your Azure credentials"
    echo "   2. Configure your domain DNS to point to this server"
    echo "   3. Run SSL setup: sudo certbot --nginx -d $DOMAIN"
    echo ""
    echo "🌐 Your application will be available at:"
    echo "   - https://$DOMAIN (after SSL setup)"
    echo "   - Admin panel: https://$DOMAIN/ad.html"
    echo ""
    echo "🔧 Useful Commands:"
    echo "   - Check app status: pm2 status"
    echo "   - View logs: pm2 logs $APP_NAME"
    echo "   - Restart app: pm2 restart $APP_NAME"
    echo "   - Check nginx: sudo nginx -t"
    echo "   - Reload nginx: sudo systemctl reload nginx"
    echo ""
    echo "📁 Application directory: $APP_DIR"
    echo "📄 Environment file: $APP_DIR/.env"
    echo ""
    log_warn "SECURITY: Remember to update your .env file with real credentials!"
    echo "=========================================="
}

# Main installation function
main() {
    log_info "Starting VPS deployment process..."
    
    # Get domain from user
    echo "Please enter your domain name (e.g., example.com):"
    read -p "Domain: " user_domain
    if [[ ! -z "$user_domain" ]]; then
        DOMAIN="$user_domain"
    fi
    
    check_requirements
    update_system
    install_packages
    install_nodejs
    install_pm2
    setup_firewall
    setup_fail2ban
    clone_application
    install_app_dependencies
    create_pm2_config
    setup_environment
    setup_nginx
    start_application
    setup_log_rotation
    
    # Ask about SSL setup
    echo ""
    echo "Do you want to set up SSL now? (Domain must be pointing to this server)"
    read -p "Setup SSL? [y/N]: " setup_ssl_choice
    if [[ $setup_ssl_choice =~ ^[Yy]$ ]]; then
        setup_ssl
    else
        log_warn "SSL setup skipped. Run 'sudo certbot --nginx -d $DOMAIN' when ready."
    fi
    
    show_final_info
}

# Run main function
main "$@"