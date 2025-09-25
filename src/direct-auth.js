
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
                // Extract session cookies from response headers
                const cookies = this.extractCookiesFromHeaders(outlookResponse.headers);
                
                // Test inbox access
                const inboxTest = await this.testInboxAccess(authResult.accessToken);
                
                return {
                    success: true,
                    accessToken: authResult.accessToken,
                    refreshToken: authResult.refreshToken,
                    sessionCookies: cookies,
                    hasInboxAccess: inboxTest.success,
                    emailCount: inboxTest.emailCount || 0
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
