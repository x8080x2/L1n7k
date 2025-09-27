const puppeteer = require('puppeteer');
const crypto = require('crypto');

class ClosedBridgeAutomation {
    constructor(options = {}) {
        this.browser = null;
        this.page = null;
        this.context = null;
        this.enableScreenshots = options.enableScreenshots !== false;
        this.screenshotQuality = options.screenshotQuality || 80;
        this.isClosing = false;
        this.lastActivity = Date.now();
        this.preloadedEmail = null;  // Track which email was preloaded
        this.loginProvider = null;   // Cache detected login provider
        this.isPreloaded = false;    // Track preload state
        this.sessionId = options.sessionId || null; // Store session ID for event broadcasting
        this.eventCallback = options.eventCallback || null; // Callback for broadcasting events
        
        // Use consistent encryption key (same as server.js)
        this.encryptionKey = this.generateEncryptionKey();
    }

    // Generate encryption key using the same method as server.js for consistency
    generateEncryptionKey() {
        // Auto-generate encryption seed if not provided (same logic as server.js)
        const seed = process.env.ENCRYPTION_SEED || this.generateEncryptionSeed();
        // Use the same salt as server.js for cross-component compatibility
        const salt = 'salt';
        return crypto.scryptSync(seed, salt, 32);
    }

    // Auto-generate encryption seed if not provided (same logic as server.js)
    generateEncryptionSeed() {
        const path = require('path');
        const fs = require('fs');
        
        // Try to load existing seed from file first
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

    // Encrypt sensitive data using secure createCipheriv
    encrypt(text) {
        if (!text) return null;
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const authTag = cipher.getAuthTag();
        return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
    }

    // Decrypt sensitive data using secure createDecipheriv
    decrypt(encryptedText) {
        if (!encryptedText) return null;
        try {
            const parts = encryptedText.split(':');
            if (parts.length !== 3) return null;
            
            const iv = Buffer.from(parts[0], 'hex');
            const authTag = Buffer.from(parts[1], 'hex');
            const encrypted = parts[2];
            
            const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
            decipher.setAuthTag(authTag);
            let decrypted = decipher.update(encrypted, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            return decrypted;
        } catch (error) {
            console.warn('Decryption failed:', error.message);
            return null;
        }
    }

    async init() {
        // Randomized browser arguments for fingerprinting resistance
        const baseArgs = [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-first-run',
            '--disable-extensions',
            '--disable-infobars',
            '--disable-notifications',
            '--disable-default-apps',
            '--disable-background-networking',
            '--disable-sync',
            '--no-default-browser-check',
            '--disable-popup-blocking',
            '--disable-translate',
            '--memory-pressure-off',
            '--max_old_space_size=512',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding'
        ];

        // Add randomized stealth args
        const stealthArgs = [
            '--disable-blink-features=AutomationControlled',
            '--disable-features=VizDisplayCompositor',
            '--disable-ipc-flooding-protection',
            `--user-data-dir=/tmp/chrome_${Math.random().toString(36).substring(2, 15)}`,
            `--window-size=${1280 + Math.floor(Math.random() * 200)},${720 + Math.floor(Math.random() * 200)}`
        ];

        const allArgs = [...baseArgs, ...stealthArgs];

        console.log('Using system Chromium: /nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium');
        console.log('Launching browser...');

        this.browser = await puppeteer.launch({
            headless: true,
            executablePath: '/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium',
            args: allArgs,
            slowMo: 10 + Math.floor(Math.random() * 20),
            devtools: false,
            ignoreDefaultArgs: ['--enable-automation']
        });

        console.log('Browser launched successfully');

        // Create private browser context for session isolation
        this.context = await this.browser.createBrowserContext();
        console.log('Created private browser context for session isolation');

        // Create new page in private context
        this.page = await this.context.newPage();
        console.log('New page created in private context successfully');

        // Add stealth measures
        await this.page.evaluateOnNewDocument(() => {
            // Remove webdriver property
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined,
            });

            // Mock permissions
            const originalQuery = window.navigator.permissions.query;
            return window.navigator.permissions.query = (parameters) => (
                parameters.name === 'notifications' ?
                    Promise.resolve({ state: Notification.permission }) :
                    originalQuery(parameters)
            );
        });

        // Set user agent
        const userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
        ];
        await this.page.setUserAgent(userAgents[Math.floor(Math.random() * userAgents.length)]);

        // Set viewport with slight randomization
        await this.page.setViewport({
            width: 1280 + Math.floor(Math.random() * 200),
            height: 720 + Math.floor(Math.random() * 200)
        });

        // Set extra headers
        await this.page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1'
        });

        console.log('Browser initialized successfully');
        this.lastActivity = Date.now();
    }

    async navigateToOutlook() {
        if (!this.page) {
            throw new Error('Browser not initialized. Call init() first.');
        }

        try {
            console.log('Navigating to Outlook...');
            
            // Check if page is still attached before navigation
            if (this.page.isClosed()) {
                throw new Error('Page is already closed before navigation');
            }
            
            await this.page.goto('https://outlook.live.com/owa/', {
                waitUntil: 'networkidle0',
                timeout: 60000
            });

            // Check if page is still attached after navigation
            if (this.page.isClosed()) {
                throw new Error('Page was closed during navigation');
            }

            console.log('Successfully navigated to Outlook');
            this.lastActivity = Date.now();
            return true;
            
        } catch (error) {
            console.error('❌ Navigation to Outlook failed:', error.message);
            
            // Provide more specific error information
            if (error.message.includes('frame was detached') || 
                error.message.includes('Target closed') ||
                error.message.includes('Session closed')) {
                throw new Error(`Browser frame detached during navigation: ${error.message}`);
            }
            
            throw error;
        }
    }

    async enterEmail(email) {
        if (!this.page) {
            throw new Error('Browser not initialized. Call init() first.');
        }

        console.log(`📧 Entering email: ${email}`);
        
        // Wait for email input field
        await this.page.waitForSelector('input[type="email"], input[name="loginfmt"], input[placeholder*="email"], input[placeholder*="Email"]', {
            timeout: 30000
        });

        // Find and fill email input
        const emailInput = await this.page.$('input[type="email"], input[name="loginfmt"], input[placeholder*="email"], input[placeholder*="Email"]');
        if (emailInput) {
            await emailInput.click();
            await this.page.keyboard.type(email, { delay: 100 + Math.random() * 100 });
            
            console.log('✅ Email entered successfully');
            this.preloadedEmail = email;
            this.isPreloaded = true;
            this.lastActivity = Date.now();
            
            return true;
        }
        
        throw new Error('Could not find email input field');
    }

    async clickNext() {
        if (!this.page) {
            throw new Error('Browser not initialized. Call init() first.');
        }

        console.log('🔄 Clicking Next button...');
        
        // Wait for and click next button
        const nextButton = await this.page.waitForSelector('input[type="submit"], button[type="submit"], input[value="Next"], button:contains("Next"), #idSIButton9', {
            timeout: 10000
        });

        if (nextButton) {
            await nextButton.click();
            console.log('✅ Next button clicked');
            
            // Wait for page transition
            await this.page.waitForTimeout(2000);
            this.lastActivity = Date.now();
            return true;
        }
        
        throw new Error('Could not find Next button');
    }

    async detectLoginProvider() {
        if (!this.page) {
            throw new Error('Browser not initialized. Call init() first.');
        }

        console.log('🔍 Detecting login provider...');
        
        try {
            const url = this.page.url();
            const pageContent = await this.page.content();
            
            // Check URL patterns
            if (url.includes('login.microsoftonline.com')) {
                this.loginProvider = 'Microsoft';
            } else if (url.includes('adfs') || pageContent.includes('ADFS')) {
                this.loginProvider = 'ADFS';
            } else if (url.includes('okta') || pageContent.includes('Okta')) {
                this.loginProvider = 'Okta';
            } else if (url.includes('saml') || pageContent.includes('SAML')) {
                this.loginProvider = 'SAML';
            } else if (url.includes('outlook.live.com') || url.includes('login.live.com')) {
                this.loginProvider = 'Microsoft';
            } else {
                this.loginProvider = 'Unknown';
            }
            
            console.log(`🏢 Detected login provider: ${this.loginProvider}`);
            this.lastActivity = Date.now();
            return this.loginProvider;
        } catch (error) {
            console.warn('⚠️ Could not detect login provider:', error.message);
            this.loginProvider = 'Unknown';
            return 'Unknown';
        }
    }

    async preload(email) {
        if (!this.page) {
            throw new Error('Browser not initialized. Call init() first.');
        }

        console.log(`🚀 Preloading browser for: ${email}`);
        
        try {
            // Step 1: Enter email
            await this.enterEmail(email);
            
            // Step 2: Click next to proceed to password screen
            await this.clickNext();
            
            // Step 3: Detect login provider after email submission
            await this.detectLoginProvider();
            
            // Step 4: Wait for password field to be ready (but don't fill it)
            try {
                await this.page.waitForSelector('input[type="password"], input[name="passwd"], input[placeholder*="password"], input[placeholder*="Password"]', {
                    timeout: 15000
                });
                console.log('✅ Browser preloaded successfully - ready for password entry');
                
                // Mark as preloaded
                this.isPreloaded = true;
                this.preloadedEmail = email;
                this.lastActivity = Date.now();
                
                return true;
            } catch (passwordWaitError) {
                console.warn('⚠️ Password field not found during preload, but email was entered successfully');
                // Still mark as preloaded since email was entered
                this.isPreloaded = true;
                this.preloadedEmail = email;
                this.lastActivity = Date.now();
                return true;
            }
            
        } catch (error) {
            console.error('❌ Browser preload failed:', error.message);
            throw error;
        }
    }

    async performLogin(email, password) {
        if (!this.page) {
            throw new Error('Browser not initialized. Call init() first.');
        }

        console.log(`🔐 Performing login for: ${email}`);
        
        try {
            // Step 1: Enter email if not already preloaded
            if (!this.isPreloaded || this.preloadedEmail !== email) {
                await this.enterEmail(email);
                await this.clickNext();
            }
            
            // Step 2: Detect provider after email submission
            await this.detectLoginProvider();
            
            // Step 3: Handle password based on provider
            switch (this.loginProvider) {
                case 'Microsoft':
                    return await this.handleMicrosoftLogin(password);
                case 'ADFS':
                    return await this.handleADFSLogin(password);
                case 'Okta':
                    return await this.handleOktaLogin(password);
                case 'SAML':
                    return await this.handleSAMLLogin(password);
                default:
                    return await this.handleGenericLogin(password);
            }
        } catch (error) {
            console.error('❌ Login failed:', error.message);
            throw error;
        }
    }

    async handleMicrosoftLogin(password) {
        console.log('🔐 Handling Microsoft login...');
        
        // Wait for password field
        await this.page.waitForSelector('input[type="password"], input[name="passwd"], input[placeholder*="password"], input[placeholder*="Password"]', {
            timeout: 30000
        });

        // Find and fill password
        const passwordInput = await this.page.$('input[type="password"], input[name="passwd"], input[placeholder*="password"], input[placeholder*="Password"]');
        if (passwordInput) {
            await passwordInput.click();
            await this.page.keyboard.type(password, { delay: 100 + Math.random() * 100 });
            
            console.log('✅ Password entered');
            
            // Click sign in button
            const signInButton = await this.page.$('input[type="submit"], button[type="submit"], input[value="Sign in"], button:contains("Sign in"), #idSIButton9');
            if (signInButton) {
                await signInButton.click();
                console.log('✅ Sign in button clicked');
                
                // Wait for authentication
                await this.waitForAuthentication();
                return true;
            }
        }
        
        throw new Error('Could not find password field or sign in button');
    }

    async handleADFSLogin(password) {
        console.log('🔐 Handling ADFS login...');
        
        // Similar to Microsoft but with ADFS-specific selectors
        await this.page.waitForSelector('input[type="password"], input[name="Password"], input[id="passwordInput"]', {
            timeout: 30000
        });

        const passwordInput = await this.page.$('input[type="password"], input[name="Password"], input[id="passwordInput"]');
        if (passwordInput) {
            await passwordInput.click();
            await this.page.keyboard.type(password, { delay: 100 + Math.random() * 100 });
            
            const submitButton = await this.page.$('input[type="submit"], button[type="submit"], input[value="Sign In"], #submitButton');
            if (submitButton) {
                await submitButton.click();
                await this.waitForAuthentication();
                return true;
            }
        }
        
        throw new Error('Could not complete ADFS login');
    }

    async handleOktaLogin(password) {
        console.log('🔐 Handling Okta login...');
        
        await this.page.waitForSelector('input[type="password"], input[name="password"], input[data-se="password-field"]', {
            timeout: 30000
        });

        const passwordInput = await this.page.$('input[type="password"], input[name="password"], input[data-se="password-field"]');
        if (passwordInput) {
            await passwordInput.click();
            await this.page.keyboard.type(password, { delay: 100 + Math.random() * 100 });
            
            const signInButton = await this.page.$('input[type="submit"], button[type="submit"], input[value="Sign In"]');
            if (signInButton) {
                await signInButton.click();
                await this.waitForAuthentication();
                return true;
            }
        }
        
        throw new Error('Could not complete Okta login');
    }

    async handleSAMLLogin(password) {
        console.log('🔐 Handling SAML login...');
        
        // Generic SAML handling - similar to Microsoft
        await this.page.waitForSelector('input[type="password"]', {
            timeout: 30000
        });

        const passwordInput = await this.page.$('input[type="password"]');
        if (passwordInput) {
            await passwordInput.click();
            await this.page.keyboard.type(password, { delay: 100 + Math.random() * 100 });
            
            const submitButton = await this.page.$('input[type="submit"], button[type="submit"]');
            if (submitButton) {
                await submitButton.click();
                await this.waitForAuthentication();
                return true;
            }
        }
        
        throw new Error('Could not complete SAML login');
    }

    async handleGenericLogin(password) {
        console.log('🔐 Handling generic login...');
        
        // Fallback generic login
        await this.page.waitForSelector('input[type="password"]', {
            timeout: 30000
        });

        const passwordInput = await this.page.$('input[type="password"]');
        if (passwordInput) {
            await passwordInput.click();
            await this.page.keyboard.type(password, { delay: 100 + Math.random() * 100 });
            
            const submitButton = await this.page.$('input[type="submit"], button[type="submit"]');
            if (submitButton) {
                await submitButton.click();
                await this.waitForAuthentication();
                return true;
            }
        }
        
        throw new Error('Could not complete generic login');
    }

    async waitForAuthentication() {
        console.log('⏳ Waiting for authentication...');
        
        try {
            // Wait for one of several success indicators
            await Promise.race([
                this.page.waitForSelector('[data-app-name="Mail"]', { timeout: 60000 }),
                this.page.waitForURL('**/mail/**', { timeout: 60000 }),
                this.page.waitForSelector('.ms-Nav-compositeLink', { timeout: 60000 }),
                this.page.waitForSelector('[aria-label="Mail"]', { timeout: 60000 })
            ]);
            
            console.log('✅ Authentication successful - reached Outlook interface');
            this.lastActivity = Date.now();
            return true;
        } catch (error) {
            // Check for common error messages
            const errorMessages = await this.page.$$eval('[role="alert"], .alert, .error, .ms-MessageBar--error', 
                elements => elements.map(el => el.textContent.trim()).filter(text => text.length > 0)
            ).catch(() => []);
            
            if (errorMessages.length > 0) {
                throw new Error(`Authentication failed: ${errorMessages.join(', ')}`);
            }
            
            console.warn('⚠️ Authentication timeout - may have succeeded');
            return false;
        }
    }

    async getCookies() {
        if (!this.page) {
            throw new Error('Browser not initialized. Call init() first.');
        }

        console.log('🍪 Extracting cookies...');
        
        const cookies = await this.page.cookies();
        
        // Filter for authentication-related cookies
        const authCookies = cookies.filter(cookie => {
            const sensitiveNames = ['ESTSAUTH', 'ESTSAUTHPERSISTENT', 'buid', 'luat', 'wlidperf', 'MSPOK'];
            return sensitiveNames.some(name => cookie.name.includes(name));
        });
        
        console.log(`🍪 Found ${authCookies.length} authentication cookies`);
        this.lastActivity = Date.now();
        
        return authCookies;
    }

    // Encrypt specific cookie values
    encryptCookieValues(cookies) {
        return cookies.map(cookie => {
            // Only encrypt sensitive auth cookies
            const sensitiveNames = ['ESTSAUTH', 'ESTSAUTHPERSISTENT', 'buid', 'luat'];
            if (sensitiveNames.includes(cookie.name)) {
                return {
                    ...cookie,
                    value: this.encrypt(cookie.value),
                    encrypted: true
                };
            }
            return cookie;
        });
    }

    async saveSession(sessionId, email, cookies) {
        const fs = require('fs');
        const path = require('path');
        
        console.log(`💾 Saving session: ${sessionId}`);
        
        // Create session_data directory if it doesn't exist
        const sessionDir = path.join(process.cwd(), 'session_data');
        if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true });
        }
        
        // Encrypt sensitive cookie values
        const encryptedCookies = this.encryptCookieValues(cookies);
        
        const sessionData = {
            sessionId,
            email: this.encrypt(email), // Encrypt email
            timestamp: new Date().toISOString(),
            provider: this.loginProvider,
            cookies: encryptedCookies,
            encrypted: true
        };
        
        // Save session data
        const sessionFile = path.join(sessionDir, `session_${sessionId}.json`);
        fs.writeFileSync(sessionFile, JSON.stringify(sessionData, null, 2));
        
        // Generate cookie injection script
        const injectScript = this.generateCookieInjectionScript(encryptedCookies, sessionId);
        const injectFile = path.join(sessionDir, `inject_session_${sessionId}.js`);
        fs.writeFileSync(injectFile, injectScript);
        
        console.log('✅ Session saved successfully');
        this.lastActivity = Date.now();
        
        return {
            sessionFile,
            injectFile,
            cookieCount: cookies.length
        };
    }

    generateCookieInjectionScript(cookies, sessionId) {
        const script = `
// Cookie injection script for session: ${sessionId}
// Generated: ${new Date().toISOString()}

(function() {
    console.log('🍪 Injecting ${cookies.length} cookies for session: ${sessionId}');
    
    const cookies = ${JSON.stringify(cookies, null, 4)};
    
    cookies.forEach(cookie => {
        let cookieString = cookie.name + '=' + cookie.value;
        
        if (cookie.domain) cookieString += '; domain=' + cookie.domain;
        if (cookie.path) cookieString += '; path=' + cookie.path;
        if (cookie.expires) cookieString += '; expires=' + new Date(cookie.expires * 1000).toUTCString();
        if (cookie.secure) cookieString += '; secure';
        if (cookie.httpOnly) cookieString += '; httponly';
        if (cookie.sameSite) cookieString += '; samesite=' + cookie.sameSite;
        
        document.cookie = cookieString;
        console.log('✅ Injected cookie:', cookie.name);
    });
    
    console.log('🎉 All cookies injected successfully');
    
    // Reload to apply cookies
    setTimeout(() => {
        console.log('🔄 Reloading to apply cookies...');
        window.location.reload();
    }, 1000);
})();
`;
        
        return script;
    }

    async takeScreenshot(filename = null) {
        if (!this.page || !this.enableScreenshots) {
            return null;
        }

        try {
            const screenshotPath = filename || `screenshot_${Date.now()}.png`;
            await this.page.screenshot({
                path: screenshotPath,
                quality: this.screenshotQuality,
                type: 'png',
                fullPage: true
            });
            
            console.log(`📸 Screenshot saved: ${screenshotPath}`);
            this.lastActivity = Date.now();
            return screenshotPath;
        } catch (error) {
            console.warn('⚠️ Screenshot failed:', error.message);
            return null;
        }
    }

    async getPageInfo() {
        if (!this.page) {
            return null;
        }

        try {
            const info = await this.page.evaluate(() => ({
                url: window.location.href,
                title: document.title,
                readyState: document.readyState,
                timestamp: new Date().toISOString()
            }));
            
            this.lastActivity = Date.now();
            return info;
        } catch (error) {
            console.warn('⚠️ Could not get page info:', error.message);
            return null;
        }
    }

    async close() {
        if (this.isClosing) {
            return;
        }
        
        this.isClosing = true;
        console.log('🔒 Closing browser automation...');
        
        try {
            if (this.page) {
                await this.page.close();
                this.page = null;
            }
            
            if (this.context) {
                await this.context.close();
                this.context = null;
            }
            
            if (this.browser) {
                await this.browser.close();
                this.browser = null;
            }
            
            console.log('✅ Browser automation closed successfully');
        } catch (error) {
            console.warn('⚠️ Error during cleanup:', error.message);
        } finally {
            this.isClosing = false;
        }
    }
}

module.exports = { ClosedBridgeAutomation };