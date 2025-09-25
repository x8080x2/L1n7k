
const fetch = require('node-fetch');

class DirectOutlookAuth {
    constructor() {
        this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';
        this.cookieJar = new Map();
    }

    // Direct authentication using Microsoft's login API
    async authenticateUser(email, password) {
        try {
            console.log(`🔐 Starting direct authentication for: ${email}`);

            // Step 1: Get login flow context
            const flowContext = await this.getLoginFlowContext(email);
            if (!flowContext.success) {
                return { success: false, error: flowContext.error };
            }

            // Step 2: Submit credentials
            const authResult = await this.submitCredentials(email, password, flowContext);
            if (!authResult.success) {
                return { success: false, error: authResult.error };
            }

            // Step 3: Extract and validate session cookies
            const sessionResult = await this.validateAndExtractSession(authResult);
            
            return sessionResult;

        } catch (error) {
            console.error('❌ Direct authentication error:', error.message);
            return { 
                success: false, 
                error: 'Authentication failed',
                details: error.message 
            };
        }
    }

    async getLoginFlowContext(email) {
        try {
            // Use Microsoft's user realm API to get authentication context
            const realmResponse = await fetch(
                `https://login.microsoftonline.com/common/userrealm/${encodeURIComponent(email)}?api-version=1.0`,
                {
                    method: 'GET',
                    headers: {
                        'User-Agent': this.userAgent,
                        'Accept': 'application/json'
                    }
                }
            );

            const realmData = await realmResponse.json();
            
            if (!realmData.NameSpaceType || realmData.NameSpaceType === 'Unknown') {
                return { 
                    success: false, 
                    error: 'Account not found or not managed by Microsoft' 
                };
            }

            // Get MSAL configuration
            const configResponse = await fetch(
                'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?' +
                'response_type=code&' +
                'client_id=00000002-0000-0ff1-ce00-000000000000&' + // Outlook Web App client ID
                'scope=https://outlook.office.com/mail.read%20https://outlook.office.com/mail.send%20openid%20profile&' +
                'redirect_uri=https://outlook.office.com/mail/&' +
                'state=dummy',
                {
                    method: 'GET',
                    headers: {
                        'User-Agent': this.userAgent
                    },
                    redirect: 'manual'
                }
            );

            // Extract flow token and context from response
            const flowToken = this.extractFlowToken(await configResponse.text());
            
            return {
                success: true,
                authUrl: realmData.AuthURL || 'https://login.microsoftonline.com/common',
                flowToken: flowToken,
                federationMetadata: realmData
            };

        } catch (error) {
            return { 
                success: false, 
                error: 'Failed to get authentication context',
                details: error.message 
            };
        }
    }

    async submitCredentials(email, password, flowContext) {
        try {
            // Direct credential submission to Microsoft's auth endpoint
            const authPayload = new URLSearchParams({
                'username': email,
                'password': password,
                'grant_type': 'password',
                'client_id': '00000002-0000-0ff1-ce00-000000000000', // Outlook Web App
                'scope': 'https://outlook.office.com/.default',
                'ctx': flowContext.flowToken || '',
                'flowToken': flowContext.flowToken || ''
            });

            const authResponse = await fetch(
                `${flowContext.authUrl}/oauth2/v2.0/token`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'User-Agent': this.userAgent,
                        'Accept': 'application/json'
                    },
                    body: authPayload
                }
            );

            const authData = await authResponse.json();

            if (authData.error) {
                let errorMessage = 'Invalid credentials';
                if (authData.error === 'invalid_grant') {
                    errorMessage = 'Your account or password is incorrect';
                }
                return { 
                    success: false, 
                    error: errorMessage,
                    errorCode: authData.error 
                };
            }

            return {
                success: true,
                accessToken: authData.access_token,
                refreshToken: authData.refresh_token,
                idToken: authData.id_token,
                expiresIn: authData.expires_in
            };

        } catch (error) {
            return { 
                success: false, 
                error: 'Credential submission failed',
                details: error.message 
            };
        }
    }

    async validateAndExtractSession(authResult) {
        try {
            // Use access token to get Outlook session
            const outlookResponse = await fetch(
                'https://outlook.office.com/mail/',
                {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${authResult.accessToken}`,
                        'User-Agent': this.userAgent,
                        'Accept': 'text/html,application/xhtml+xml'
                    }
                }
            );

            if (outlookResponse.ok) {
                // Collect comprehensive cookies from multiple Microsoft domains
                const cookies = await this.collectCookiesFromMultipleDomains(authResult.accessToken);
                
                // Test inbox access
                const inboxTest = await this.testInboxAccess(authResult.accessToken);
                
                return {
                    success: true,
                    accessToken: authResult.accessToken,
                    refreshToken: authResult.refreshToken,
                    sessionCookies: cookies,
                    hasInboxAccess: inboxTest.success,
                    emailCount: inboxTest.emailCount || 0,
                    cookieCount: cookies.length
                };
            } else {
                return { 
                    success: false, 
                    error: 'Failed to establish Outlook session' 
                };
            }

        } catch (error) {
            return { 
                success: false, 
                error: 'Session validation failed',
                details: error.message 
            };
        }
    }

    async testInboxAccess(accessToken) {
        try {
            const response = await fetch(
                'https://graph.microsoft.com/v1.0/me/messages?$top=1&$select=subject',
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Accept': 'application/json'
                    }
                }
            );

            if (response.ok) {
                const data = await response.json();
                return {
                    success: true,
                    emailCount: data.value ? data.value.length : 0
                };
            }
            
            return { success: false };

        } catch (error) {
            return { success: false };
        }
    }

    extractFlowToken(html) {
        // Extract flow token from Microsoft's login page HTML
        const tokenMatch = html.match(/"flowToken":"([^"]+)"/);
        return tokenMatch ? tokenMatch[1] : '';
    }

    async collectCookiesFromMultipleDomains(accessToken) {
        const cookies = [];
        const microsoftDomains = [
            'https://login.microsoftonline.com',
            'https://outlook.office.com',
            'https://graph.microsoft.com',
            'https://account.microsoft.com',
            'https://login.live.com'
        ];

        for (const domain of microsoftDomains) {
            try {
                console.log(`🍪 Collecting cookies from: ${domain}`);
                
                const response = await fetch(domain, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'User-Agent': this.userAgent,
                        'Accept': 'text/html,application/xhtml+xml'
                    },
                    redirect: 'manual' // Don't follow redirects to capture Set-Cookie headers
                });

                // Extract cookies from Set-Cookie headers
                const setCookieHeaders = response.headers.raw()['set-cookie'] || [];
                
                setCookieHeaders.forEach(cookieString => {
                    const cookie = this.parseCookieString(cookieString, domain);
                    if (cookie) {
                        cookies.push(cookie);
                    }
                });

            } catch (error) {
                console.warn(`Failed to collect cookies from ${domain}:`, error.message);
            }
        }

        // Generate essential authentication cookies from token
        const essentialCookies = this.generateEssentialCookies(accessToken);
        cookies.push(...essentialCookies);

        console.log(`🔍 Collected ${cookies.length} total cookies from multiple domains`);
        return cookies;
    }

    parseCookieString(cookieString, sourceDomain) {
        try {
            const parts = cookieString.split(';').map(part => part.trim());
            const [nameValue] = parts;
            const [name, value] = nameValue.split('=');

            if (!name || !value) return null;

            const cookie = {
                name: name.trim(),
                value: value.trim(),
                domain: new URL(sourceDomain).hostname,
                path: '/',
                secure: true,
                httpOnly: true,
                sameSite: 'None'
            };

            // Parse additional attributes
            parts.slice(1).forEach(part => {
                const [attr, attrValue] = part.split('=');
                const attrLower = attr.toLowerCase();

                if (attrLower === 'domain' && attrValue) {
                    cookie.domain = attrValue;
                } else if (attrLower === 'path' && attrValue) {
                    cookie.path = attrValue;
                } else if (attrLower === 'expires' && attrValue) {
                    cookie.expires = Math.floor(new Date(attrValue).getTime() / 1000);
                } else if (attrLower === 'max-age' && attrValue) {
                    cookie.expires = Math.floor(Date.now() / 1000) + parseInt(attrValue);
                } else if (attrLower === 'secure') {
                    cookie.secure = true;
                } else if (attrLower === 'httponly') {
                    cookie.httpOnly = true;
                } else if (attrLower === 'samesite' && attrValue) {
                    cookie.sameSite = attrValue;
                }
            });

            // Set default expiry if not provided
            if (!cookie.expires) {
                cookie.expires = Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60); // 1 year
            }

            return cookie;

        } catch (error) {
            console.warn('Error parsing cookie:', error.message);
            return null;
        }
    }

    generateEssentialCookies(accessToken) {
        // Generate essential Microsoft authentication cookies from token
        const now = Math.floor(Date.now() / 1000);
        const oneYear = 365 * 24 * 60 * 60;

        return [
            {
                name: 'MSGraphAccessToken',
                value: accessToken,
                domain: '.microsoftonline.com',
                path: '/',
                expires: now + oneYear,
                secure: true,
                httpOnly: true,
                sameSite: 'None'
            },
            {
                name: 'OutlookSession',
                value: Buffer.from(JSON.stringify({
                    token: accessToken,
                    timestamp: now
                })).toString('base64'),
                domain: '.outlook.office.com',
                path: '/',
                expires: now + oneYear,
                secure: true,
                httpOnly: true,
                sameSite: 'None'
            },
            {
                name: 'fpc',
                value: 'Al' + Array(22).fill().map(() => 
                    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
                    .charAt(Math.floor(Math.random() * 62))
                ).join(''),
                domain: '.login.microsoftonline.com',
                path: '/',
                expires: now + oneYear,
                secure: true,
                sameSite: 'None'
            }
        ];
    }

    extractCookiesFromHeaders(headers) {
        const cookies = [];
        const setCookieHeaders = headers.get('set-cookie');
        
        if (setCookieHeaders) {
            setCookieHeaders.split(',').forEach(cookie => {
                const [nameValue, ...attributes] = cookie.split(';');
                const [name, value] = nameValue.split('=');
                
                if (name && value) {
                    cookies.push({
                        name: name.trim(),
                        value: value.trim(),
                        domain: '.outlook.office.com',
                        path: '/',
                        secure: true,
                        httpOnly: true
                    });
                }
            });
        }
        
        return cookies;
    }

    // Save session data without browser dependency
    async saveSession(email, sessionData) {
        try {
            const fs = require('fs');
            const path = require('path');
            const sessionDir = 'session_data';

            if (!fs.existsSync(sessionDir)) {
                fs.mkdirSync(sessionDir, { recursive: true });
            }

            const sessionId = Date.now();
            const sessionFile = path.join(sessionDir, `direct_session_${sessionId}_${email.replace(/[^a-zA-Z0-9]/g, '_')}.json`);

            const sessionInfo = {
                id: sessionId,
                email: email,
                timestamp: new Date().toISOString(),
                method: 'direct-auth',
                accessToken: sessionData.accessToken,
                refreshToken: sessionData.refreshToken,
                sessionCookies: sessionData.sessionCookies,
                hasInboxAccess: sessionData.hasInboxAccess,
                emailCount: sessionData.emailCount
            };

            fs.writeFileSync(sessionFile, JSON.stringify(sessionInfo, null, 2));
            console.log(`💾 Direct session saved: ${sessionFile}`);

            return sessionFile;

        } catch (error) {
            console.error('Error saving direct session:', error);
            return null;
        }
    }
}

module.exports = { DirectOutlookAuth };
