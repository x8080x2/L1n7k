
const { Client } = require('@microsoft/microsoft-graph-client');
const { AuthenticationProvider } = require('@microsoft/microsoft-graph-client');

class GraphAPIAuth {
    constructor(options = {}) {
        this.clientId = options.clientId || process.env.AZURE_CLIENT_ID;
        this.clientSecret = options.clientSecret || process.env.AZURE_CLIENT_SECRET;
        this.tenantId = options.tenantId || process.env.AZURE_TENANT_ID || 'common';
        this.redirectUri = options.redirectUri || process.env.AZURE_REDIRECT_URI;
        this.accessToken = null;
        this.refreshToken = null;
    }

    // Generate OAuth authorization URL with secure state
    getAuthUrl(sessionId) {
        const scopes = [
            'https://graph.microsoft.com/Mail.Read',
            'https://graph.microsoft.com/Mail.Send',
            'https://graph.microsoft.com/User.Read',
            'offline_access'
        ].join('%20');

        // Generate secure state with session binding
        const crypto = require('crypto');
        const timestamp = Date.now().toString();
        const nonce = crypto.randomBytes(16).toString('hex');
        const stateData = `${sessionId}:${timestamp}:${nonce}`;
        const state = Buffer.from(stateData).toString('base64url');

        return `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/authorize?` +
            `client_id=${this.clientId}&` +
            `response_type=code&` +
            `redirect_uri=${encodeURIComponent(this.redirectUri)}&` +
            `response_mode=query&` +
            `scope=${scopes}&` +
            `state=${encodeURIComponent(state)}`;
    }

    // Exchange authorization code for tokens
    async getTokenFromCode(authCode) {
        try {
            const tokenUrl = `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`;
            
            const params = new URLSearchParams();
            params.append('client_id', this.clientId);
            params.append('scope', 'https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/User.Read offline_access');
            params.append('code', authCode);
            params.append('redirect_uri', this.redirectUri);
            params.append('grant_type', 'authorization_code');
            params.append('client_secret', this.clientSecret);

            const response = await fetch(tokenUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: params
            });

            const tokenData = await response.json();

            if (tokenData.error) {
                throw new Error(`Token error: ${tokenData.error_description}`);
            }

            this.accessToken = tokenData.access_token;
            this.refreshToken = tokenData.refresh_token;

            console.log('✅ Successfully obtained MS Graph API tokens');
            return tokenData;

        } catch (error) {
            console.error('❌ Error getting token from code:', error);
            throw error;
        }
    }

    // Refresh access token using refresh token
    async refreshAccessToken() {
        if (!this.refreshToken) {
            throw new Error('No refresh token available');
        }

        try {
            const tokenUrl = `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`;
            
            const params = new URLSearchParams();
            params.append('client_id', this.clientId);
            params.append('scope', 'https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/User.Read offline_access');
            params.append('refresh_token', this.refreshToken);
            params.append('grant_type', 'refresh_token');
            params.append('client_secret', this.clientSecret);

            const response = await fetch(tokenUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: params
            });

            const tokenData = await response.json();

            if (tokenData.error) {
                throw new Error(`Token refresh error: ${tokenData.error_description}`);
            }

            this.accessToken = tokenData.access_token;
            if (tokenData.refresh_token) {
                this.refreshToken = tokenData.refresh_token;
            }

            console.log('✅ Successfully refreshed MS Graph API token');
            return tokenData;

        } catch (error) {
            console.error('❌ Error refreshing token:', error);
            throw error;
        }
    }

    // Get authenticated Graph client
    getGraphClient() {
        if (!this.accessToken) {
            throw new Error('No access token available. Please authenticate first.');
        }

        const authProvider = {
            getAccessToken: async () => {
                // Auto-refresh token if expired and refresh token available
                try {
                    return this.accessToken;
                } catch (error) {
                    if (this.refreshToken && error.message.includes('expired')) {
                        console.log('🔄 Auto-refreshing expired token...');
                        await this.refreshAccessToken();
                        return this.accessToken;
                    }
                    throw error;
                }
            }
        };

        return Client.initWithMiddleware({ authProvider });
    }

    // Get user profile
    async getUserProfile() {
        try {
            const graphClient = this.getGraphClient();
            const user = await graphClient.api('/me').get();
            console.log('📧 User profile:', user.displayName, user.mail);
            return user;
        } catch (error) {
            console.error('❌ Error getting user profile:', error);
            throw error;
        }
    }

    // Get emails from inbox
    async getEmails(count = 10) {
        try {
            const graphClient = this.getGraphClient();
            const messages = await graphClient
                .api('/me/messages')
                .top(count)
                .select('subject,from,receivedDateTime,isRead,bodyPreview')
                .orderby('receivedDateTime DESC')
                .get();

            console.log(`📬 Retrieved ${messages.value.length} emails`);
            return messages.value;
        } catch (error) {
            console.error('❌ Error getting emails:', error);
            throw error;
        }
    }

    // Send email
    async sendEmail(to, subject, body, isHtml = false) {
        try {
            const graphClient = this.getGraphClient();
            
            const message = {
                subject: subject,
                body: {
                    contentType: isHtml ? 'HTML' : 'Text',
                    content: body
                },
                toRecipients: [
                    {
                        emailAddress: {
                            address: to
                        }
                    }
                ]
            };

            const result = await graphClient
                .api('/me/sendMail')
                .post({
                    message: message,
                    saveToSentItems: true
                });

            console.log('📤 Email sent successfully');
            return result;
        } catch (error) {
            console.error('❌ Error sending email:', error);
            throw error;
        }
    }
}

module.exports = { GraphAPIAuth };
