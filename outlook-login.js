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

            // Wait for possible 2FA or redirect
            await new Promise(resolve => setTimeout(resolve, 5000));

            // Check if we're successfully logged in
            const currentUrl = this.page.url();
            if (currentUrl.includes('outlook.office.com/mail')) {
                console.log('Login successful - redirected to Outlook mail');
                return true;
            }

            return false;
        } catch (error) {
            console.error('Error during login:', error.message);
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

    async takeScreenshot(filename = 'outlook-screenshot.png') {
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