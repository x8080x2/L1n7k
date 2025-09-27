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
        
        try {
            // Enhanced email input selectors for modern Outlook (2024-2025)
            const emailSelectors = [
                // Standard email selectors
                'input[type="email"]',
                'input[name="loginfmt"]', 
                'input[placeholder*="email" i]',
                'input[placeholder*="Email"]',
                'input[id*="email" i]',
                'input[data-testid*="email" i]',
                'input[aria-label*="email" i]',
                
                // Microsoft specific selectors (historical and current)
                '#i0116', // Classic Microsoft signin
                'input[name="username"]',
                'input[autocomplete="email"]',
                'input[autocomplete="username"]',
                
                // Modern Microsoft authentication selectors
                'input[data-report-event*="Signin_Email"]',
                'input[aria-describedby*="emailError"]',
                'input[aria-describedby*="usernameError"]',
                'input[role="textbox"][type="email"]',
                'input[role="textbox"][autocomplete="email"]',
                
                // Generic fallbacks for various auth providers
                'input[type="text"][placeholder*="email" i]',
                'input[type="text"][placeholder*="@"]',
                'input[type="text"][name*="email" i]',
                'input[type="text"][name*="user" i]',
                'input[type="text"][id*="user" i]',
                'input[inputmode="email"]',
                
                // React/Angular/Vue component selectors
                '[data-cy="email"]',
                '[data-cy="username"]',
                '[test-id="email"]',
                '[test-id="username"]',
                
                // Common authentication provider patterns
                'input[name="identifier"]', // Google-style
                'input[name="email_or_username"]', // Mixed providers
                'input[class*="email" i]',
                'input[class*="signin" i]',
                'input[class*="login" i]'
            ];
            
            let emailInput = null;
            
            // First try to find existing fields immediately (no waiting)
            for (const selector of emailSelectors) {
                emailInput = await this.page.$(selector);
                if (emailInput) {
                    console.log(`⚡ Found email input immediately with selector: ${selector}`);
                    break;
                }
            }
            
            // If not found immediately, try waiting for each selector with shorter timeout
            if (!emailInput) {
                console.log('⏳ Email field not immediately visible, waiting...');
                for (const selector of emailSelectors) {
                    try {
                        await this.page.waitForSelector(selector, { timeout: 2000 });
                        emailInput = await this.page.$(selector);
                        if (emailInput) {
                            console.log(`🎯 Found email input after wait with selector: ${selector}`);
                            break;
                        }
                    } catch (e) {
                        // Continue to next selector
                        continue;
                    }
                }
            }
            
            if (!emailInput) {
                // Enhanced debugging - get page info before failing
                console.log('🔍 Email field not found, analyzing page structure...');
                
                try {
                    // Get all input elements on the page for debugging
                    const allInputs = await this.page.evaluate(() => {
                        const inputs = Array.from(document.querySelectorAll('input'));
                        return inputs.map(input => ({
                            type: input.type || 'text',
                            name: input.name || '',
                            id: input.id || '',
                            placeholder: input.placeholder || '',
                            className: input.className || '',
                            'aria-label': input.getAttribute('aria-label') || '',
                            autocomplete: input.autocomplete || '',
                            'data-testid': input.getAttribute('data-testid') || '',
                            visible: !input.hidden && input.offsetParent !== null
                        }));
                    });
                    
                    console.log('📋 All input elements found on page:', JSON.stringify(allInputs, null, 2));
                    
                    // Get page URL and title for context
                    const pageInfo = await this.getPageInfo();
                    console.log('🌐 Page context:', pageInfo);
                    
                } catch (debugError) {
                    console.warn('⚠️ Debug info collection failed:', debugError.message);
                }
                
                // Take screenshot for debugging
                await this.takeScreenshot(`email_field_not_found_${Date.now()}`);
                throw new Error('Could not find email input field with any selector');
            }

            // Clear field first, then enter email
            await emailInput.click({ clickCount: 3 }); // Select all
            await this.page.keyboard.press('Backspace');
            await this.page.keyboard.type(email, { delay: 100 + Math.random() * 100 });
            
            console.log('✅ Email entered successfully');
            this.preloadedEmail = email;
            this.isPreloaded = true;
            this.lastActivity = Date.now();
            
            return true;
            
        } catch (error) {
            console.error('❌ Email entry failed:', error.message);
            // Take screenshot for debugging
            await this.takeScreenshot(`email_entry_failed_${Date.now()}`);
            throw error;
        }
    }

    async clickNext() {
        if (!this.page) {
            throw new Error('Browser not initialized. Call init() first.');
        }

        console.log('🔄 Clicking Next button...');
        
        try {
            // Enhanced Next button selectors
            const nextSelectors = [
                'input[type="submit"][value*="Next" i]',
                'button[type="submit"]',
                'input[value="Next"]',
                'button:has-text("Next")',
                '#idSIButton9', // Microsoft specific
                'input[id*="next" i]',
                'button[id*="next" i]',
                'input[data-testid*="next" i]',
                'button[data-testid*="next" i]',
                'button[aria-label*="next" i]',
                'input[type="submit"]',
                '.btn-primary',
                '[data-report-event*="Signin_Submit"]'
            ];
            
            let nextButton = null;
            
            // First try to find button immediately (no waiting)
            for (const selector of nextSelectors) {
                nextButton = await this.page.$(selector);
                if (nextButton) {
                    console.log(`⚡ Found Next button immediately with selector: ${selector}`);
                    break;
                }
            }
            
            // If not found immediately, try waiting for each selector
            if (!nextButton) {
                console.log('⏳ Next button not immediately visible, waiting...');
                for (const selector of nextSelectors) {
                    try {
                        await this.page.waitForSelector(selector, { timeout: 2000 });
                        nextButton = await this.page.$(selector);
                        if (nextButton) {
                            console.log(`🎯 Found Next button after wait with selector: ${selector}`);
                            break;
                        }
                    } catch (e) {
                        continue;
                    }
                }
            }
            
            if (!nextButton) {
                // Take screenshot for debugging
                await this.takeScreenshot(`next_button_not_found_${Date.now()}`);
                throw new Error('Could not find Next button with any selector');
            }

            await nextButton.click();
            console.log('✅ Next button clicked');
            
            // Wait for page transition
            await this.page.waitForTimeout(3000);
            this.lastActivity = Date.now();
            return true;
            
        } catch (error) {
            console.error('❌ Next button click failed:', error.message);
            await this.takeScreenshot(`next_click_failed_${Date.now()}`);
            throw error;
        }
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
            // Get current page state for better debugging
            const currentUrl = this.page.url();
            const pageTitle = await this.page.title();
            console.log(`🔍 Current page: ${currentUrl} | Title: ${pageTitle}`);
            
            // Check if we can find either email OR password fields (to determine actual state)
            const hasEmailField = await this.page.$('input[type="email"], input[name="loginfmt"], input[id="i0116"]') !== null;
            const hasPasswordField = await this.page.$('input[type="password"], input[name="passwd"]') !== null;
            
            console.log(`📝 Page state: Email field=${hasEmailField}, Password field=${hasPasswordField}`);
            
            // If password field is available, we're past email stage
            if (hasPasswordField && !hasEmailField) {
                console.log('🔄 Browser already at password stage, detecting provider...');
                await this.detectLoginProvider();
                
                console.log('✅ Browser preloaded successfully - ready for password entry (skipped email)');
                this.isPreloaded = true;
                this.preloadedEmail = email;
                this.lastActivity = Date.now();
                return true;
            }
            
            // If both fields or only email field, proceed with email entry
            if (hasEmailField) {
                console.log('📧 Email field detected, proceeding with email entry...');
            } else {
                console.log('⚠️ No email or password fields detected, attempting email entry anyway...');
            }
            
            // If still at email stage, proceed with email entry
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
                } catch (passwordWaitError) {
                    console.warn('⚠️ Password field not found during preload, but email was entered successfully');
                }
                
                // Mark as preloaded
                this.isPreloaded = true;
                this.preloadedEmail = email;
                this.lastActivity = Date.now();
                
                return true;
                
            } catch (emailError) {
                // If email entry fails, it might be because we're already past that stage
                console.log('ℹ️ Email entry failed, checking if already at password stage...');
                
                try {
                    await this.page.waitForSelector('input[type="password"], input[name="passwd"], input[placeholder*="password"], input[placeholder*="Password"]', {
                        timeout: 5000
                    });
                    console.log('✅ Browser appears to be at password stage already');
                    
                    this.isPreloaded = true;
                    this.preloadedEmail = email;
                    this.lastActivity = Date.now();
                    return true;
                } catch (passwordWaitError) {
                    throw emailError; // Re-throw original error if password field also not found
                }
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

    async validateSession(email, password) {
        if (!this.page) {
            throw new Error('Browser not initialized. Call init() first.');
        }

        console.log(`🔐 Validating session for: ${email}`);
        
        try {
            // Wait a moment for page to fully load after authentication
            await this.page.waitForTimeout(2000);
            
            // Check if we're successfully authenticated by looking for success indicators
            const currentUrl = this.page.url();
            const pageContent = await this.page.content();
            
            const isAuthenticated = 
                currentUrl.includes('outlook.office.com') ||
                currentUrl.includes('outlook.live.com') ||
                pageContent.includes('mail') ||
                pageContent.includes('inbox') ||
                pageContent.includes('Microsoft') ||
                await this.page.$('[data-app-name="Mail"]') !== null;
            
            if (!isAuthenticated) {
                console.log('❌ Session validation failed - not authenticated');
                return {
                    success: false,
                    message: 'Authentication failed - invalid credentials',
                    cookiesSaved: 0
                };
            }
            
            console.log('✅ Authentication successful, extracting cookies...');
            
            // Extract cookies from authenticated session
            const cookies = await this.getCookies();
            
            if (cookies.length === 0) {
                console.warn('⚠️ No authentication cookies found');
                return {
                    success: true,
                    message: 'Authentication successful but no cookies captured',
                    cookiesSaved: 0
                };
            }
            
            // Save session with cookies
            const sessionId = this.sessionId || `session_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
            const sessionData = await this.saveSession(sessionId, email, cookies);
            
            console.log(`💾 Session validated and saved: ${sessionData.cookieCount} cookies`);
            
            this.lastActivity = Date.now();
            
            return {
                success: true,
                message: 'Session validated and cookies saved successfully',
                cookiesSaved: sessionData.cookieCount,
                sessionFile: sessionData.sessionFile,
                injectFile: sessionData.injectFile
            };
            
        } catch (error) {
            console.error('❌ Session validation failed:', error.message);
            return {
                success: false,
                message: `Session validation error: ${error.message}`,
                cookiesSaved: 0
            };
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

    async isHealthy() {
        try {
            // Check if browser is still connected
            if (!this.browser || !this.browser.isConnected()) {
                return false;
            }
            
            // Check if page is still valid and not closed
            if (!this.page || this.page.isClosed()) {
                return false;
            }
            
            // Check if context is still valid
            if (!this.context) {
                return false;
            }
            
            // Try a simple page evaluation to ensure the page is responsive
            await this.page.evaluate(() => document.readyState);
            
            return true;
        } catch (error) {
            // If any check fails, the browser is unhealthy
            console.warn(`⚠️ Browser health check failed: ${error.message}`);
            return false;
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