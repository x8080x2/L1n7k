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

            // Wait for password field
            await this.page.waitForSelector('input[type="password"]', { timeout: 10000 });
            
            // Enter password
            await this.page.type('input[type="password"]', password);
            console.log('Password entered');

            // Click Sign in button
            await this.page.click('input[type="submit"]');
            console.log('Clicked Sign in button');

            // Wait for possible responses (2FA, Stay signed in, or redirect)
            await new Promise(resolve => setTimeout(resolve, 5000));

            // Check for "Stay signed in?" prompt
            await this.handleStaySignedInPrompt();

            // Check if we're successfully logged in
            const currentUrl = this.page.url();
            if (currentUrl.includes('outlook.office.com/mail')) {
                console.log('Login successful - redirected to Outlook mail');
                
                // Save session cookies after successful login
                await this.saveCookies();
                
                return true;
            }

            return false;
        } catch (error) {
            console.error('Error during login:', error.message);
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

    async saveCookies() {
        try {
            console.log('Saving session cookies...');
            
            // Get all cookies from the current page
            const cookies = await this.page.cookies();
            
            // Create cookies directory if it doesn't exist
            const fs = require('fs');
            const path = require('path');
            const cookiesDir = 'session_data';
            
            if (!fs.existsSync(cookiesDir)) {
                fs.mkdirSync(cookiesDir, { recursive: true });
            }

            // Save cookies to text file with timestamp
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const cookieFile = path.join(cookiesDir, `outlook_cookies_${timestamp}.txt`);
            
            // Format cookies as readable text
            let cookieText = `# Outlook Session Cookies\n`;
            cookieText += `# Saved on: ${new Date().toISOString()}\n`;
            cookieText += `# URL: ${this.page.url()}\n\n`;
            
            cookies.forEach(cookie => {
                cookieText += `Name: ${cookie.name}\n`;
                cookieText += `Value: ${cookie.value}\n`;
                cookieText += `Domain: ${cookie.domain}\n`;
                cookieText += `Path: ${cookie.path}\n`;
                cookieText += `Secure: ${cookie.secure}\n`;
                cookieText += `HttpOnly: ${cookie.httpOnly}\n`;
                if (cookie.expires) {
                    cookieText += `Expires: ${new Date(cookie.expires * 1000).toISOString()}\n`;
                }
                cookieText += `---\n\n`;
            });

            fs.writeFileSync(cookieFile, cookieText);
            console.log(`✅ Cookies saved to: ${cookieFile}`);

            // Also save as JSON for programmatic use
            const jsonFile = path.join(cookiesDir, `outlook_cookies_${timestamp}.json`);
            fs.writeFileSync(jsonFile, JSON.stringify(cookies, null, 2));
            console.log(`✅ Cookies also saved as JSON: ${jsonFile}`);

            return cookieFile;

        } catch (error) {
            console.error('Error saving cookies:', error.message);
            return null;
        }
    }

    async loadCookies(cookieFile) {
        try {
            console.log(`Loading cookies from: ${cookieFile}`);
            
            const fs = require('fs');
            const path = require('path');
            
            // Check if file exists
            if (!fs.existsSync(cookieFile)) {
                console.log('Cookie file not found');
                return false;
            }

            // Load cookies from JSON file (easier to parse)
            const jsonFile = cookieFile.replace('.txt', '.json');
            if (fs.existsSync(jsonFile)) {
                const cookiesData = fs.readFileSync(jsonFile, 'utf8');
                const cookies = JSON.parse(cookiesData);
                
                // Filter out expired cookies and session cookies that might be invalid
                const now = Date.now() / 1000;
                const validCookies = cookies.filter(cookie => {
                    // Skip session cookies as they expire when browser closes
                    if (cookie.session || cookie.expires === -1) {
                        console.log(`⚠️  Skipping session cookie: ${cookie.name}`);
                        return false;
                    }
                    
                    // Skip expired cookies
                    if (cookie.expires && cookie.expires < now) {
                        console.log(`⚠️  Skipping expired cookie: ${cookie.name}`);
                        return false;
                    }
                    
                    return true;
                });
                
                console.log(`Found ${validCookies.length} valid cookies out of ${cookies.length} total`);
                
                if (validCookies.length === 0) {
                    console.log('❌ No valid cookies found - all are session cookies or expired');
                    return false;
                }
                
                // Navigate to Outlook first to set the right domain context
                console.log('📍 Navigating to Outlook to set cookie context...');
                await this.page.goto('https://outlook.office.com/', {
                    waitUntil: 'networkidle2',
                    timeout: 30000
                });
                
                // Set the valid cookies
                await this.page.setCookie(...validCookies);
                console.log(`✅ Loaded ${validCookies.length} valid cookies from session`);
                
                // Reload the page to test if cookies work
                console.log('🔄 Reloading page to test cookie authentication...');
                await this.page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
                
                // Wait a moment and check if we're logged in
                await new Promise(resolve => setTimeout(resolve, 3000));
                const currentUrl = this.page.url();
                const isLoggedIn = currentUrl.includes('outlook.office.com/mail') || 
                                 await this.isLoggedIn();
                
                if (isLoggedIn) {
                    console.log('🎉 Cookie authentication successful!');
                    return true;
                } else {
                    console.log('❌ Cookie authentication failed - login still required');
                    return false;
                }
            }

            return false;

        } catch (error) {
            console.error('Error loading cookies:', error.message);
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