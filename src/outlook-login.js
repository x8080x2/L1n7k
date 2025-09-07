const puppeteer = require('puppeteer');

class OutlookLoginAutomation {
    constructor() {
        this.browser = null;
        this.page = null;
    }

    async init() {
        // Launch browser with options for Replit environment
        this.browser = await puppeteer.launch({
            headless: 'new',
            executablePath: '/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu',
                '--disable-extensions',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding'
            ]
        });

        this.page = await this.browser.newPage();

        // Set viewport and user agent
        await this.page.setViewport({ width: 1280, height: 720 });
        await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

        console.log('Browser initialized successfully');
    }

    async navigateToOutlook() {
        try {
            console.log('Navigating to Outlook...');
            await this.page.goto('https://outlook.office.com/mail/', {
                waitUntil: 'networkidle2',
                timeout: 30000
            });

            console.log('Successfully navigated to Outlook');

            // Wait for the page to load
            await new Promise(resolve => setTimeout(resolve, 3000));

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
            await this.page.waitForSelector('input[type="email"]', { timeout: 10000 });

            // Enter email
            await this.page.type('input[type="email"]', email);
            console.log('Email entered');

            // Click Next button
            await this.page.click('input[type="submit"]');
            console.log('Clicked Next button');

            // Wait for page to respond and detect any redirects
            await new Promise(resolve => setTimeout(resolve, 3000));

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

            if (loginSuccess) {
                // Wait for possible "Stay signed in?" prompt
                await this.handleStaySignedInPrompt();

                // Final redirect check - wait for Outlook to load
                await new Promise(resolve => setTimeout(resolve, 5000));

                const finalUrl = this.page.url();
                if (finalUrl.includes('outlook.office.com/mail')) {
                    console.log('Login successful - redirected to Outlook mail');

                    // Save session cookies after successful login
                    await this.saveCookies();

                    return true;
                }
            }

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
            await this.page.waitForSelector('input[type="password"]', { timeout: 10000 });

            // Enter password
            await this.page.type('input[type="password"]', password);
            console.log('Password entered for Microsoft login');

            // Click Sign in button
            await this.page.click('input[type="submit"]');
            console.log('Clicked Sign in button for Microsoft login');

            // Wait for possible responses
            await new Promise(resolve => setTimeout(resolve, 5000));

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
                    await this.page.waitForSelector(selector, { timeout: 3000 });
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

            await new Promise(resolve => setTimeout(resolve, 5000));
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
                    await this.page.waitForSelector(selector, { timeout: 3000 });
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

            await new Promise(resolve => setTimeout(resolve, 5000));
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
                    await this.page.waitForSelector(selector, { timeout: 3000 });
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

            await new Promise(resolve => setTimeout(resolve, 5000));
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
                    await this.page.waitForSelector(selector, { timeout: 3000 });
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

            await new Promise(resolve => setTimeout(resolve, 5000));
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

            await new Promise(resolve => setTimeout(resolve, 5000));
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

            for (const cookie of allCookies) {
                const key = `${cookie.name}|${cookie.domain}|${cookie.path}`;

                // Only include essential cookies or dynamic context cookies
                const isEssential = essentialCookieNames.includes(cookie.name) || 
                                  cookie.name.startsWith('esctx-');

                if (!seen.has(key) && isEssential) {
                    seen.add(key);

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
            }

            console.log(`📦 Optimized to ${uniqueCookies.length} essential authentication cookies (removed ${allCookies.length - uniqueCookies.length} unnecessary cookies)`);

            // Create session data directory
            const fs = require('fs');
            const path = require('path');
            const sessionDir = 'session_data';

            if (!fs.existsSync(sessionDir)) {
                fs.mkdirSync(sessionDir, { recursive: true });
            }

            // Use email for filename, fallback to timestamp if no email
            const emailSafe = email ? email.replace(/[^a-zA-Z0-9]/g, '_') : 'unknown';
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

            // Save enhanced session file (overwrites existing for same email)
            const sessionFile = path.join(sessionDir, `outlook_session_${emailSafe}.json`);

            const sessionPackage = {
                timestamp: new Date().toISOString(),
                email: email,
                password: password ? Buffer.from(password).toString('base64') : null, // Basic encoding for storage
                cookies: uniqueCookies,
                domains: domains,
                userAgent: await this.page.evaluate(() => navigator.userAgent),
                browserFingerprint: {
                    viewport: await this.page.viewport(),
                    timezone: await this.page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone),
                    language: await this.page.evaluate(() => navigator.language)
                }
            };

            fs.writeFileSync(sessionFile, JSON.stringify(sessionPackage, null, 2));
            console.log(`💾 Session saved: ${sessionFile} (overwrites any existing session for this email)`);

            // Clean up old timestamp-based files for this email
            try {
                const files = fs.readdirSync(sessionDir);
                const oldFiles = files.filter(file => 
                    file.startsWith(`outlook_session_${emailSafe}_`) || 
                    file.startsWith(`outlook_cookies_${emailSafe}_`) ||
                    file.startsWith(`inject_${emailSafe}_`)
                );
                
                oldFiles.forEach(file => {
                    const filePath = path.join(sessionDir, file);
                    fs.unlinkSync(filePath);
                    console.log(`🗑️ Cleaned up old file: ${file}`);
                });
                
                if (oldFiles.length > 0) {
                    console.log(`✅ Cleaned up ${oldFiles.length} old session files for this email`);
                }
            } catch (cleanupError) {
                console.log('⚠️ Could not clean up old files:', cleanupError.message);
            }

            // Legacy cookie format for compatibility
            const cookieFile = path.join(sessionDir, `outlook_cookies_${emailSafe}.txt`);
            let cookieText = `# Microsoft Outlook Enhanced Persistent Session\n`;
            cookieText += `# Saved: ${new Date().toISOString()}\n`;
            cookieText += `# Email: ${email || 'N/A'}\n`;
            cookieText += `# Total cookies: ${uniqueCookies.length}\n`;
            cookieText += `# Expiry: 5 years (maximum persistence)\n`;
            cookieText += `# Cross-computer compatible: YES\n\n`;

            uniqueCookies.forEach(cookie => {
                cookieText += `Name: ${cookie.name}\n`;
                cookieText += `Value: ${cookie.value}\n`;
                cookieText += `Domain: ${cookie.domain}\n`;
                cookieText += `Path: ${cookie.path}\n`;
                cookieText += `Secure: ${cookie.secure}\n`;
                cookieText += `HttpOnly: ${cookie.httpOnly}\n`;
                cookieText += `SameSite: ${cookie.sameSite}\n`;
                cookieText += `Expires: ${new Date(cookie.expires * 1000).toISOString()}\n`;
                cookieText += `Session: false\n`;
                cookieText += `---\n\n`;
            });

            fs.writeFileSync(cookieFile, cookieText);

            // Create browser-injectable script
            const injectScript = path.join(sessionDir, `inject_${emailSafe}.js`);
            const scriptContent = `
// Enhanced Microsoft Authentication Cookie Injector
// Auto-generated on ${new Date().toISOString()}
// Email: ${email || 'N/A'}

(function() {
    console.log('🚀 Injecting ${uniqueCookies.length} persistent Microsoft auth cookies...');

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
        if (confirm('Injected ' + injected + ' auth cookies! Open Outlook now?')) {
            window.open('https://outlook.office.com/mail/', '_blank');
        }
    }, 1000);
})();`;

            fs.writeFileSync(injectScript, scriptContent);
            console.log(`🔧 Browser injection script: ${injectScript}`);

            console.log(`✅ Enhanced persistent session saved with ${uniqueCookies.length} cookies`);
            if (email) console.log(`📧 Email captured: ${email}`);
            if (password) console.log(`🔑 Password captured and encoded for future use`);

            // Redirect to office.com after successful cookie save
            console.log('🔄 Redirecting to office.com...');
            await this.page.goto('https://office.com', {
                waitUntil: 'networkidle2',
                timeout: 30000
            });
            console.log('✅ Redirected to office.com successfully');

            return sessionFile;

        } catch (error) {
            console.error('❌ Error saving enhanced session:', error.message);
            return null;
        }
    }

    async loadCookies(sessionFile) {
        try {
            console.log(`🔄 Loading enhanced session from: ${sessionFile}`);

            const fs = require('fs');
            const path = require('path');

            if (!fs.existsSync(sessionFile)) {
                console.log('❌ Session file not found');
                return false;
            }

            // Load complete session package
            let sessionData;
            try {
                const sessionContent = fs.readFileSync(sessionFile, 'utf8');
                sessionData = JSON.parse(sessionContent);
                console.log(`📦 Loaded session package from ${sessionData.timestamp}`);
                if (sessionData.email) console.log(`📧 Session email: ${sessionData.email}`);
            } catch (e) {
                // Fallback to old cookie format
                const cookies = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
                sessionData = { cookies: cookies };
                console.log(`📦 Loaded ${cookies.length} legacy cookies`);
            }

            const cookies = sessionData.cookies;
            if (!cookies || cookies.length === 0) {
                console.log('❌ No cookies found in session');
                return false;
            }

            // Apply browser fingerprint if available
            if (sessionData.browserFingerprint) {
                try {
                    if (sessionData.browserFingerprint.viewport) {
                        await this.page.setViewport(sessionData.browserFingerprint.viewport);
                    }
                    if (sessionData.browserFingerprint.userAgent) {
                        await this.page.setUserAgent(sessionData.userAgent);
                    }
                    console.log('🎭 Applied browser fingerprint for consistency');
                } catch (e) {
                    console.log('⚠️ Could not apply browser fingerprint');
                }
            }

            // Enhanced domain list for cookie injection
            const domains = sessionData.domains || [
                'login.microsoftonline.com',
                'login.live.com',
                'outlook.office.com',
                'outlook.office365.com',
                'www.office.com',
                'account.microsoft.com'
            ];

            console.log(`🍪 Injecting ${cookies.length} persistent cookies across domains...`);

            // Group cookies by domain
            const cookiesByDomain = {};
            cookies.forEach(cookie => {
                const domain = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
                if (!cookiesByDomain[domain]) {
                    cookiesByDomain[domain] = [];
                }
                cookiesByDomain[domain].push(cookie);
            });

            // Inject cookies domain by domain
            for (const [domain, domainCookies] of Object.entries(cookiesByDomain)) {
                try {
                    const targetUrl = `https://${domain}`;
                    console.log(`🌐 Setting ${domainCookies.length} cookies for ${domain}`);

                    await this.page.goto(targetUrl, {
                        waitUntil: 'domcontentloaded',
                        timeout: 10000
                    });

                    for (const cookie of domainCookies) {
                        try {
                            const cookieToSet = {
                                name: cookie.name,
                                value: cookie.value,
                                domain: cookie.domain,
                                path: cookie.path || '/',
                                secure: cookie.secure || true,
                                httpOnly: cookie.httpOnly || false,
                                sameSite: cookie.sameSite || 'None'
                            };

                            if (cookie.expires && cookie.expires !== -1) {
                                cookieToSet.expires = cookie.expires;
                            }

                            await this.page.setCookie(cookieToSet);

                        } catch (cookieError) {
                            console.log(`⚠️ Cookie injection failed for ${cookie.name}: ${cookieError.message}`);
                        }
                    }

                } catch (domainError) {
                    console.log(`⚠️ Could not access ${domain}: ${domainError.message}`);
                }
            }

            console.log('✅ Cookie injection complete - testing authentication...');

            // Test authentication by navigating to Outlook
            await this.page.goto('https://outlook.office.com/mail/', {
                waitUntil: 'networkidle2',
                timeout: 30000
            });

            // Extended wait and verification
            await new Promise(resolve => setTimeout(resolve, 10000));

            const currentUrl = this.page.url();
            console.log(`🔍 Current URL: ${currentUrl}`);

            // Multiple authentication checks
            const authChecks = [
                currentUrl.includes('outlook.office.com/mail'),
                !currentUrl.includes('login.microsoftonline.com'),
                !currentUrl.includes('login.live.com')
            ];

            // Check for Outlook interface elements
            let outlookElements = false;
            try {
                await this.page.waitForSelector([
                    '[data-testid="message-subject"]',
                    '[role="listbox"]', 
                    'button[aria-label*="New mail"]',
                    '[aria-label*="Inbox"]',
                    '.ms-FocusZone'
                ].join(','), { timeout: 8000 });
                outlookElements = true;
                console.log('✅ Outlook interface detected');
            } catch (e) {
                console.log('❌ No Outlook interface found');
            }

            const authSuccess = authChecks.every(check => check) && outlookElements;

            if (authSuccess) {
                console.log('🎉 Persistent session authentication successful!');
                console.log('🔑 No manual login required - cookies are working perfectly');

                // If we have credentials, verify we don't need them
                if (sessionData.email && sessionData.password) {
                    console.log('💾 Credentials available but not needed - pure cookie authentication');
                }

                return true;
            } else {
                console.log('❌ Cookie authentication failed');

                // If we have stored credentials, attempt automatic login
                if (sessionData.email && sessionData.password) {
                    console.log('🔑 Attempting automatic login with stored credentials...');
                    try {
                        const decodedPassword = Buffer.from(sessionData.password, 'base64').toString();
                        const loginSuccess = await this.performLogin(sessionData.email, decodedPassword);

                        if (loginSuccess) {
                            console.log('✅ Automatic credential login successful!');
                            // Save new session after successful auto-login
                            await this.saveCookies(sessionData.email, decodedPassword);
                            return true;
                        }
                    } catch (credError) {
                        console.log('❌ Automatic credential login failed:', credError.message);
                    }
                }

                return false;
            }

        } catch (error) {
            console.error('❌ Error loading enhanced session:', error.message);
            return false;
        }
    }

    async isLoggedIn() {
        try {
            // Check if we're on the login page (bad sign)
            const currentUrl = this.page.url();
            if (currentUrl.includes('login.microsoftonline.com') || 
                currentUrl.includes('login.live.com')) {
                return false;
            }

            // Check for login indicators on Outlook
            const loginIndicators = [
                'input[type="email"]',  // Email input field
                'input[type="password"]',  // Password input field
                'input[value="Sign in"]',  // Sign in button
                '[data-testid="i0116"]'   // Microsoft login email field
            ];

            for (const selector of loginIndicators) {
                const element = await this.page.$(selector);
                if (element) {
                    return false; // Found login element, not logged in
                }
            }

            // Check for Outlook-specific logged-in indicators
            const loggedInIndicators = [
                '[role="listbox"]',  // Email list
                '[data-testid="message-subject"]',  // Email subjects
                'button[aria-label*="New mail"]',  // New mail button
                'div[aria-label*="Inbox"]'  // Inbox label
            ];

            for (const selector of loggedInIndicators) {
                const element = await this.page.$(selector);
                if (element) {
                    return true; // Found Outlook element, logged in
                }
            }

            // If on outlook.office.com and no login fields, probably logged in
            if (currentUrl.includes('outlook.office.com')) {
                return true;
            }

            return false;

        } catch (error) {
            console.error('Error checking login status:', error.message);
            return false;
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
        try {
            await this.page.screenshot({ 
                path: filename,
                fullPage: true 
            });
            console.log(`Screenshot saved as ${filename}`);
        } catch (error) {
            console.error('Error taking screenshot:', error.message);
        }
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
            console.log('Browser closed');
        }
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

        // Note: For actual login, you would need to provide email and password
        // This is just a demonstration of the navigation
        console.log('\nREADY FOR LOGIN:');
        console.log('The browser is now at Outlook login page.');
        console.log('To perform actual login, you would call:');
        console.log('await automation.performLogin("your-email@company.com", "your-password");');
        console.log('');
        console.log('For security reasons, credentials should be provided via environment variables.');

        // Keep browser open for manual testing
        console.log('Browser will remain open for 60 seconds for manual inspection...');
        await new Promise(resolve => setTimeout(resolve, 60000));

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