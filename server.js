const express = require('express');
const cors = require('cors');
const path = require('path');
const { OutlookLoginAutomation } = require('./src/outlook-login');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Store active automation instance (only one at a time)
let currentAutomation = null;
let currentSessionId = null;

// Routes

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'Outlook Automation Backend is running' });
});

// Start Puppeteer and login with email
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email) {
            return res.status(400).json({ 
                error: 'Email is required' 
            });
        }

        // Close any existing automation
        if (currentAutomation) {
            console.log('Closing existing automation session...');
            try {
                await currentAutomation.close();
            } catch (error) {
                console.error('Error closing existing session:', error);
            }
        }

        // Start new automation session
        console.log(`Starting Puppeteer for email: ${email}`);
        currentSessionId = Date.now().toString();
        currentAutomation = new OutlookLoginAutomation();
        
        // Initialize browser
        await currentAutomation.init();
        
        // Navigate to Outlook
        const navigated = await currentAutomation.navigateToOutlook();
        if (!navigated) {
            await currentAutomation.close();
            currentAutomation = null;
            currentSessionId = null;
            return res.status(500).json({ 
                error: 'Failed to navigate to Outlook' 
            });
        }

        // Take initial screenshot
        await currentAutomation.takeScreenshot(`screenshots/session-${currentSessionId}-initial.png`);

        // If password is provided, perform full login
        if (password) {
            console.log('Performing full login...');
            const loginSuccess = await currentAutomation.performLogin(email, password);
            
            // Take screenshot after login attempt
            await currentAutomation.takeScreenshot(`screenshots/session-${currentSessionId}-login.png`);

            res.json({
                sessionId: currentSessionId,
                email: email,
                loginComplete: true,
                loginSuccess: loginSuccess,
                message: loginSuccess ? 'Login successful!' : 'Login failed or additional authentication required',
                screenshots: [
                    `screenshots/session-${currentSessionId}-initial.png`,
                    `screenshots/session-${currentSessionId}-login.png`
                ]
            });
        } else {
            // Fill email and click Next to get site response
            console.log('Filling email and clicking Next to get site response...');
            
            let siteReport = {
                emailFilled: false,
                nextClicked: false,
                siteResponse: '',
                errorMessages: [],
                pageUrl: '',
                pageTitle: '',
                needsPassword: false,
                needsMFA: false,
                accountExists: false
            };

            try {
                // Wait for email input and fill it
                await currentAutomation.page.waitForSelector('input[type="email"]', { timeout: 10000 });
                await currentAutomation.page.type('input[type="email"]', email);
                console.log('Email entered successfully');
                siteReport.emailFilled = true;
                
                // Take screenshot showing email filled
                await currentAutomation.takeScreenshot(`screenshots/session-${currentSessionId}-email-filled.png`);

                // Click Next button
                await currentAutomation.page.click('input[type="submit"]');
                console.log('Clicked Next button');
                siteReport.nextClicked = true;

                // Wait for page response (up to 10 seconds)
                await new Promise(resolve => setTimeout(resolve, 3000));

                // Get current page info
                siteReport.pageUrl = currentAutomation.page.url();
                siteReport.pageTitle = await currentAutomation.page.title();

                // Check for different scenarios
                
                // Check for password field (account exists)
                const passwordField = await currentAutomation.page.$('input[type="password"]');
                if (passwordField) {
                    siteReport.needsPassword = true;
                    siteReport.accountExists = true;
                    siteReport.siteResponse = 'Password field appeared - account exists and is ready for password entry';
                    console.log('Password field detected - account exists');
                }

                // Check for error messages
                const errorSelectors = [
                    '[role="alert"]',
                    '.error',
                    '.ms-TextField-errorMessage',
                    '[data-testid="error"]',
                    '.alert-error',
                    '[aria-live="polite"]',
                    '.form-error'
                ];

                for (let selector of errorSelectors) {
                    const errorElements = await currentAutomation.page.$$(selector);
                    for (let element of errorElements) {
                        try {
                            const errorText = await element.evaluate(el => el.textContent);
                            if (errorText && errorText.trim()) {
                                siteReport.errorMessages.push(errorText.trim());
                                console.log(`Found error message: ${errorText.trim()}`);
                            }
                        } catch (e) {
                            // Skip if can't get text
                        }
                    }
                }

                // Check for MFA/2FA prompts
                const mfaSelectors = [
                    'input[type="tel"]',
                    '[data-testid="phone"]', 
                    '[data-testid="authenticator"]',
                    '.verification'
                ];

                for (let selector of mfaSelectors) {
                    const mfaElement = await currentAutomation.page.$(selector);
                    if (mfaElement) {
                        siteReport.needsMFA = true;
                        siteReport.siteResponse = 'Multi-factor authentication required';
                        console.log('MFA prompt detected');
                        break;
                    }
                }

                // If no specific response detected, get general page content
                if (!siteReport.siteResponse) {
                    try {
                        // Look for main content or messages
                        const mainContent = await currentAutomation.page.$eval('body', el => {
                            // Remove scripts and styles
                            const scripts = el.querySelectorAll('script, style, noscript');
                            scripts.forEach(s => s.remove());
                            
                            // Get visible text content
                            const text = el.textContent || '';
                            return text.replace(/\s+/g, ' ').trim().substring(0, 500);
                        });
                        
                        siteReport.siteResponse = mainContent || 'Page loaded but no specific response detected';
                    } catch (e) {
                        siteReport.siteResponse = 'Page loaded successfully';
                    }
                }

                // Take screenshot after clicking Next
                await currentAutomation.takeScreenshot(`screenshots/session-${currentSessionId}-after-next.png`);

                console.log('Site report:', JSON.stringify(siteReport, null, 2));

            } catch (error) {
                console.error('Error during email/next process:', error);
                siteReport.errorMessages.push(`Automation error: ${error.message}`);
                siteReport.siteResponse = `Error occurred: ${error.message}`;
            }

            res.json({
                sessionId: currentSessionId,
                email: email,
                loginComplete: false,
                siteReport: siteReport,
                message: siteReport.needsPassword ? 
                    'Email verified! Account exists and is ready for password.' : 
                    siteReport.errorMessages.length > 0 ? 
                    'Issues detected with email - see site report for details.' :
                    'Email processed - see site report for response.',
                screenshots: [
                    `screenshots/session-${currentSessionId}-initial.png`,
                    `screenshots/session-${currentSessionId}-email-filled.png`,
                    `screenshots/session-${currentSessionId}-after-next.png`
                ]
            });
        }

    } catch (error) {
        console.error('Error during login process:', error);
        
        // Clean up on error
        if (currentAutomation) {
            try {
                await currentAutomation.close();
            } catch (closeError) {
                console.error('Error closing automation on error:', closeError);
            }
            currentAutomation = null;
            currentSessionId = null;
        }
        
        res.status(500).json({ 
            error: 'Login process failed',
            details: error.message 
        });
    }
});

// Continue with password (for cases where email was filled first)
app.post('/api/continue-login', async (req, res) => {
    try {
        const { password } = req.body;

        if (!password) {
            return res.status(400).json({ 
                error: 'Password is required' 
            });
        }

        if (!currentAutomation) {
            return res.status(400).json({ 
                error: 'No active session. Please start with email first.' 
            });
        }

        console.log('Continuing login with password...');
        
        // Continue the login process
        try {
            // Click Next button (if email was already filled)
            await currentAutomation.page.click('input[type="submit"]');
            console.log('Clicked Next button');

            // Wait for password field
            await currentAutomation.page.waitForSelector('input[type="password"]', { timeout: 10000 });
            
            // Enter password
            await currentAutomation.page.type('input[type="password"]', password);
            console.log('Password entered');

            // Click Sign in button
            await currentAutomation.page.click('input[type="submit"]');
            console.log('Clicked Sign in button');

            // Wait for possible 2FA or redirect
            await new Promise(resolve => setTimeout(resolve, 5000));

            // Take screenshot after login
            await currentAutomation.takeScreenshot(`screenshots/session-${currentSessionId}-final.png`);

            // Check if we're successfully logged in
            const currentUrl = currentAutomation.page.url();
            const loginSuccess = currentUrl.includes('outlook.office.com/mail');

            res.json({
                sessionId: currentSessionId,
                loginComplete: true,
                loginSuccess: loginSuccess,
                message: loginSuccess ? 'Login completed successfully!' : 'Login may require additional verification',
                screenshot: `screenshots/session-${currentSessionId}-final.png`
            });

        } catch (error) {
            console.error('Error during password entry:', error);
            res.status(500).json({ 
                error: 'Failed to complete login',
                details: error.message 
            });
        }

    } catch (error) {
        console.error('Error in continue-login:', error);
        res.status(500).json({ 
            error: 'Continue login failed',
            details: error.message 
        });
    }
});

// Take screenshot of current state
app.post('/api/screenshot', async (req, res) => {
    try {
        if (!currentAutomation) {
            return res.status(400).json({ 
                error: 'No active automation session' 
            });
        }

        const filename = `screenshots/session-${currentSessionId}-${Date.now()}.png`;
        await currentAutomation.takeScreenshot(filename);

        res.json({
            sessionId: currentSessionId,
            screenshot: filename,
            message: 'Screenshot taken successfully'
        });

    } catch (error) {
        console.error('Error taking screenshot:', error);
        res.status(500).json({ 
            error: 'Failed to take screenshot',
            details: error.message 
        });
    }
});

// Check emails (if logged in)
app.get('/api/emails', async (req, res) => {
    try {
        if (!currentAutomation) {
            return res.status(400).json({ 
                error: 'No active automation session' 
            });
        }

        const emails = await currentAutomation.checkEmails();
        
        res.json({
            sessionId: currentSessionId,
            emails,
            count: emails.length
        });

    } catch (error) {
        console.error('Error checking emails:', error);
        res.status(500).json({ 
            error: 'Failed to check emails',
            details: error.message 
        });
    }
});

// Close current session
app.delete('/api/session', async (req, res) => {
    try {
        if (!currentAutomation) {
            return res.status(400).json({ 
                error: 'No active session to close' 
            });
        }

        await currentAutomation.close();
        const closedSessionId = currentSessionId;
        
        currentAutomation = null;
        currentSessionId = null;

        res.json({
            sessionId: closedSessionId,
            message: 'Session closed successfully'
        });

    } catch (error) {
        console.error('Error closing session:', error);
        res.status(500).json({ 
            error: 'Failed to close session',
            details: error.message 
        });
    }
});

// Get current session status
app.get('/api/status', (req, res) => {
    res.json({
        hasActiveSession: currentAutomation !== null,
        sessionId: currentSessionId
    });
});

// Serve frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ 
        error: 'Internal server error',
        details: err.message 
    });
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🔄 Shutting down server...');
    
    // Close active automation session
    if (currentAutomation) {
        try {
            console.log(`Closing session ${currentSessionId}...`);
            await currentAutomation.close();
        } catch (error) {
            console.error(`Error closing session:`, error);
        }
    }
    
    currentAutomation = null;
    currentSessionId = null;
    console.log('✅ Session closed. Server shutdown complete.');
    process.exit(0);
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Outlook Automation Backend running on port ${PORT}`);
    console.log(`📧 API endpoints available at http://localhost:${PORT}/api/`);
    console.log(`🌐 Frontend available at http://localhost:${PORT}/`);
});