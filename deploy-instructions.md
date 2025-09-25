# VPS Deployment Instructions for Outlook Automation

This guide will help you deploy your Outlook Automation system to a VPS using SSH (Putty).

## Prerequisites

- A VPS with Ubuntu 20.04+ or Debian 10+
- Domain name pointing to your VPS IP address
- SSH access to your VPS
- Basic command line knowledge

## Step 1: Connect to Your VPS via Putty

### For Windows Users (Putty):

1. **Download and Install Putty** from [putty.org](https://putty.org)

2. **Configure Putty Connection:**
   - Host Name: `your-vps-ip-address`
   - Port: `22`
   - Connection Type: `SSH`
   - Save session with a name (e.g., "My VPS")

3. **Connect:**
   - Click "Open"
   - Login with your username (usually `root` or `ubuntu`)
   - Enter your password or use SSH key authentication

### For Mac/Linux Users:

```bash
ssh username@your-vps-ip-address
```

## Step 2: Initial VPS Setup

### Create Non-Root User (if not exists):

```bash
# As root, create new user
adduser ubuntu
usermod -aG sudo ubuntu

# Switch to new user
su - ubuntu
```

### Update System:

```bash
sudo apt update && sudo apt upgrade -y
```

## Step 3: Deploy the Application

### Method 1: Automatic Deployment Script

1. **Download and run the deployment script:**

```bash
# Download the deployment script
curl -O https://raw.githubusercontent.com/x8080x2/L1n7k/main/vps-deploy.sh

# Make it executable
chmod +x vps-deploy.sh

# Run the deployment
./vps-deploy.sh
```

2. **Follow the prompts:**
   - Enter your domain name when asked
   - The script will install everything automatically
   - Choose whether to set up SSL when prompted

### Method 2: Manual Step-by-Step Deployment

If you prefer manual control, follow these steps:

#### 1. Install Node.js:

```bash
# Install Node.js LTS
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install -y nodejs
```

#### 2. Install PM2:

```bash
sudo npm install -g pm2@latest
```

#### 3. Install Nginx:

```bash
sudo apt install -y nginx
```

#### 4. Clone the Application:

```bash
# Create app directory
sudo mkdir -p /var/www/outlook-automation

# Clone repository
cd /tmp
git clone https://github.com/x8080x2/L1n7k.git
sudo cp -r L1n7k/* /var/www/outlook-automation/
sudo chown -R $USER:$USER /var/www/outlook-automation

# Install dependencies
cd /var/www/outlook-automation
npm install --production
```

#### 5. Configure Environment:

```bash
# Create environment file
nano .env
```

Add your configuration:

```bash
# Azure/Microsoft Graph API Configuration
AZURE_CLIENT_ID=your_azure_client_id_here
AZURE_CLIENT_SECRET=your_azure_client_secret_here
AZURE_TENANT_ID=your_azure_tenant_id_here
AZURE_REDIRECT_URI=https://yourdomain.com/api/auth-callback

# Optional: Telegram Bot Configuration
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here

# Production Settings
NODE_ENV=production
PORT=5000
```

#### 6. Start with PM2:

```bash
# Start application
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Setup PM2 startup
pm2 startup
```

#### 7. Configure Nginx:

```bash
# Create nginx configuration
sudo nano /etc/nginx/sites-available/yourdomain.com
```

Add this configuration:

```nginx
upstream nodejs_backend {
    server 127.0.0.1:5000;
    keepalive 64;
}

server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    location / {
        proxy_pass http://nodejs_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

#### 8. Enable Site:

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/yourdomain.com /etc/nginx/sites-enabled/

# Remove default site
sudo rm /etc/nginx/sites-enabled/default

# Test configuration
sudo nginx -t

# Reload nginx
sudo systemctl reload nginx
```

#### 9. Setup SSL:

```bash
# Install certbot
sudo apt install -y certbot python3-certbot-nginx

# Get SSL certificate
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

## Step 4: Configure Automated Deployments (Optional)

### Setup GitHub Actions:

1. **Add secrets to your GitHub repository:**
   - Go to your repo → Settings → Secrets and variables → Actions
   - Add these secrets:
     - `VPS_HOST`: Your VPS IP address
     - `VPS_USERNAME`: SSH username (e.g., `ubuntu`)
     - `VPS_SSH_KEY`: Your private SSH key content
     - `VPS_PORT`: SSH port (usually `22`)

2. **The GitHub Actions workflow will automatically deploy when you push to main branch**

### Setup SSH Key Authentication:

```bash
# On your VPS, create SSH directory
mkdir -p ~/.ssh
chmod 700 ~/.ssh

# Add your public key to authorized_keys
nano ~/.ssh/authorized_keys
# Paste your public key here

# Set permissions
chmod 600 ~/.ssh/authorized_keys
```

## Step 5: Verify Deployment

### Check Application Status:

```bash
# Check PM2 status
pm2 status

# Check logs
pm2 logs outlook-automation

# Check nginx status
sudo systemctl status nginx

# Test application
curl http://localhost:5000/api/health
```

### Access Your Application:

- Main interface: `https://yourdomain.com`
- Admin panel: `https://yourdomain.com/ad.html`
- API health: `https://yourdomain.com/api/health`

## Useful Commands

### PM2 Management:

```bash
# Check status
pm2 status

# Restart application
pm2 restart outlook-automation

# View logs
pm2 logs outlook-automation

# Monitor in real-time
pm2 monit

# Stop application
pm2 stop outlook-automation

# Delete application
pm2 delete outlook-automation
```

### Nginx Management:

```bash
# Test configuration
sudo nginx -t

# Reload configuration
sudo systemctl reload nginx

# Restart nginx
sudo systemctl restart nginx

# Check status
sudo systemctl status nginx
```

### SSL Certificate Management:

```bash
# Renew certificates (dry run)
sudo certbot renew --dry-run

# Force renew certificates
sudo certbot renew --force-renewal

# List certificates
sudo certbot certificates
```

## Troubleshooting

### Application Won't Start:

```bash
# Check logs
pm2 logs outlook-automation

# Check environment variables
pm2 show outlook-automation

# Restart with fresh logs
pm2 restart outlook-automation
pm2 flush
```

### Nginx Issues:

```bash
# Check nginx error logs
sudo tail -f /var/log/nginx/error.log

# Check access logs
sudo tail -f /var/log/nginx/access.log

# Test configuration
sudo nginx -t
```

### SSL Issues:

```bash
# Check SSL certificate status
sudo certbot certificates

# Check nginx SSL configuration
sudo nginx -t
```

### Firewall Issues:

```bash
# Check UFW status
sudo ufw status

# Allow nginx through firewall
sudo ufw allow 'Nginx Full'

# Allow SSH (important!)
sudo ufw allow OpenSSH
```

## Security Best Practices

1. **Never use root user** for running applications
2. **Keep system updated** regularly
3. **Use strong passwords** and SSH keys
4. **Configure fail2ban** to prevent brute force attacks
5. **Backup your .env file** securely
6. **Monitor logs** regularly
7. **Keep SSL certificates** up to date

## Support

If you encounter issues:

1. Check the logs first (`pm2 logs outlook-automation`)
2. Verify your `.env` file configuration
3. Ensure your domain DNS is pointing to the VPS
4. Check firewall settings
5. Test the application health endpoint

Your application should now be successfully deployed and running on your VPS!