const puppeteer = require('puppeteer');

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
    }

    async init() {
        const browserOptions = {
            headless: 'new',
            args: [
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
            ],
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
            await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

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

            // Verify page is still active
            if (!this.page || this.page.isClosed()) {
                throw new Error('Browser page is closed - cannot continue authentication');
            }

            // Verify password field is still visible
            try {
                await this.page.waitForSelector('input[type="password"]', { timeout: 2000 });
            } catch (e) {
                throw new Error('Password field not found - page state may have changed');
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
            await new Promise(resolve => setTimeout(resolve, 2500));

            const finalUrl = this.page.url();
            if (finalUrl.includes('outlook.office.com/mail')) {
                console.log('✅ Login successful - redirected to Outlook mail');
                return true;
            }

            console.error('❌ Login process completed but did not redirect to Outlook mail');
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

            // Check if we're still on a login page (indicates potential failure)
            if (currentUrl.includes('login.microsoftonline.com')) {
                // Get page text and check for error messages
                const pageText = await this.page.evaluate(() => document.body.textContent || '');
                const errorPatterns = [
                    'Your account or password is incorrect',
                    'password is incorrect',
                    'Sign-in was unsuccessful',
                    'The username or password is incorrect',
                    'Invalid credentials',
                    'incorrect password'
                ];

                for (const pattern of errorPatterns) {
                    if (pageText.toLowerCase().includes(pattern.toLowerCase())) {
                        console.error(`Microsoft login failed: ${pattern}`);
                        await this.takeScreenshot(`screenshots/error-microsoft-login-${Date.now()}.png`);
                        return false;
                    }
                }

                // Check for visible error elements
                const errorSelectors = [
                    '[data-bind*="errorText"]',
                    '.alert-error',
                    '.error-message',
                    '[role="alert"]',
                    '#passwordError',
                    '.has-error'
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
                                if (text && text.trim().length > 0) {
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

                // Check if password input is still visible (means login didn't proceed)
                try {
                    const passwordInput = await this.page.$('input[type="password"]');
                    if (passwordInput) {
                        const isVisible = await this.page.evaluate(el => {
                            const style = window.getComputedStyle(el);
                            return style.display !== 'none' && style.visibility !== 'hidden';
                        }, passwordInput);

                        if (isVisible) {
                            console.error('Microsoft login failed: Password input still visible after submission');
                            await this.takeScreenshot(`screenshots/error-microsoft-login-${Date.now()}.png`);
                            return false;
                        }
                    }
                } catch (e) {
                    // Password input not found, might be okay
                }

                // If still on login.microsoftonline.com and not on the "keep me signed in" page
                if (!pageText.toLowerCase().includes('stay signed in') && 
                    !pageText.toLowerCase().includes('keep me signed in')) {
                    console.error('Microsoft login failed: Still on login page without "stay signed in" prompt');
                    await this.takeScreenshot(`screenshots/error-microsoft-login-${Date.now()}.png`);
                    return false;
                }
            }

            // If we've moved away from login page or found the "stay signed in" prompt, consider it success
            console.log('Microsoft login appears successful - no errors detected');
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

    async validateSession(email, password) {
        try {
            console.log('🔍 Validating session and saving cookies...');

            // Use the centralized cookie-saver module
            const { saveMicrosoftCookies } = require('./cookie-saver');
            const result = await saveMicrosoftCookies(this.page, email, password);

            if (result.success) {
                console.log(`✅ Session cookies saved, frontend will handle redirect`);
                return {
                    success: true,
                    cookiesSaved: result.cookieCount,
                    sessionFile: result.sessionFile,
                    injectionScript: result.injectionScript
                };
            } else {
                throw new Error('Cookie saving failed');
            }

        } catch (error) {
            console.error('❌ Error validating session:', error.message);
            return {
                success: false,
                error: error.message
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