# Outlook Automation - Hybrid System

## Overview

This is a comprehensive Outlook automation system that provides **TWO different approaches** for accessing Microsoft Outlook accounts:

1. **Microsoft Graph API** - Official API approach using OAuth 2.0 (recommended for production)
2. **Browser Automation** - Puppeteer-based browser control for specialized scenarios

The system is fully configured for Replit and offers both approaches through a unified web interface.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture - Hybrid Design

### Frontend Components
- **Main Interface** (`/`): Microsoft-styled login supporting both authentication methods
- **Admin Panel** (`/ad.html`): System management and session monitoring
- **Responsive Design**: Works on desktop and mobile

### Backend Components

#### Core Server (server.js)
- **Express.js**: Web server on port 5000
- **CORS Configuration**: Properly configured for Replit proxy
- **Session Management**: Handles both OAuth and browser sessions
- **Dual Authentication**: Supports both Graph API and browser automation

#### Microsoft Graph API Integration (src/graph-api.js)
- **GraphAPIAuth Class**: Handles OAuth 2.0 flow
- **Token Management**: Secure token storage and refresh
- **API Operations**: Read emails, send emails, get user profile
- **Official Microsoft APIs**: Uses recommended authentication patterns

#### Browser Automation System (src/outlook-login.js)
- **OutlookLoginAutomation Class**: Controls Chrome browser
- **Login Providers**: Supports Microsoft, ADFS, Okta, Azure AD, SAML
- **Cookie Management**: Captures and stores authentication cookies (PLAIN TEXT)
- **Session Persistence**: Saves sessions to disk as JSON files
- **Screenshot Debugging**: Visual debugging capabilities

## Complete API Endpoint Reference

### Public Endpoints (No Authentication Required)
| Method | Endpoint | Purpose | Handler |
|--------|----------|---------|---------|
| GET | `/api/health` | System status check | System |
| GET | `/` | Main web interface | Frontend |
| POST | `/api/auth-url` | Get OAuth authorization URL | Graph API |
| GET | `/api/auth-callback` | Handle OAuth callback | Graph API |

### Session-Based Endpoints (Require Active Session)
| Method | Endpoint | Purpose | Handler | Authentication |
|--------|----------|---------|---------|---------------|
| GET | `/api/profile` | Get user profile | Graph API | Session ID + Authenticated |
| GET | `/api/emails` | Get emails from Outlook | Graph API | Session ID + Authenticated |
| POST | `/api/send-email` | Send email via Graph API | Graph API | Session ID + Authenticated |

### Browser Automation Endpoints
| Method | Endpoint | Purpose | Handler | Authentication |
|--------|----------|---------|---------|---------------|
| POST | `/api/verify-email` | Verify email exists | Browser | None |
| POST | `/api/authenticate-password-fast` | Fast password auth | Browser | None |
| POST | `/api/login-automation` | Full browser login | Browser | None |
| GET | `/api/automation-status/:sessionId` | Check automation status | Browser | None |
| DELETE | `/api/automation-cancel/:sessionId` | Cancel automation | Browser | None |
| GET | `/api/status` | General system status | Mixed | None |
| GET | `/api/preload-status/:sessionId` | Check preload status | Browser | None |

### **⚠️ SECURITY RISK - Unprotected Cookie/Session Endpoints**
| Method | Endpoint | Purpose | Handler | Authentication |
|--------|----------|---------|---------|---------------|
| GET | `/api/cookies/:sessionId` | **Download cookie injection script** | Browser | **❌ NONE** |
| GET | `/api/session-data/:sessionId` | **Download session data** | Browser | **❌ NONE** |

**⚠️ WARNING**: These endpoints allow anyone with a session ID to download sensitive authentication cookies and session data. This is a serious security vulnerability.

### Admin Endpoints (Require Admin Token)
| Method | Endpoint | Purpose | Authentication |
|--------|----------|---------|---------------|
| GET | `/api/preload-stats` | Get preload statistics | Admin Token |
| POST | `/api/admin/project-redirect` | Configure redirects | Admin Token |
| GET | `/api/admin/analytics` | Get system analytics | Admin Token |
| GET | `/api/admin/sessions` | List all sessions | Admin Token |
| DELETE | `/api/admin/session/:sessionId` | Delete session | Admin Token |
| GET | `/api/admin/cloudflare/status` | Cloudflare status | Admin Token |
| POST | `/api/admin/cloudflare/configure` | Configure Cloudflare | Admin Token |

## Data Storage (PLAIN TEXT - No Encryption)

### Persistent Storage
- **analytics.json** - Login statistics and system metrics (plain text)
- **telegram_subscriptions.json** - Telegram bot subscriber data (plain text)
- **session_data/** - Browser session files and cookie data (plain text)
  - `session_*.json` - Complete session data with cookies **in plain text**
  - `inject_session_*.js` - Cookie injection scripts **in plain text**
  - `invalid_*.json` - Failed authentication attempt records (plain text)

### Memory Storage  
- **User Sessions Map** - Active OAuth sessions (30-minute timeout)
- **OAuth States Map** - OAuth state tracking (10-minute timeout)
- **Automation Sessions Map** - Active browser sessions with cleanup

## Required Configuration

### For Microsoft Graph API:
- `AZURE_CLIENT_ID` - Your Azure app client ID
- `AZURE_CLIENT_SECRET` - Your Azure app client secret
- `AZURE_TENANT_ID` - Your Azure tenant ID (or 'common')
- `AZURE_REDIRECT_URI` - OAuth redirect URL (auto-detected if not set)

### For Browser Automation:
- No additional config required - uses system Chrome/Chromium

### Admin Access Configuration:
- `ADMIN_TOKEN` - **MUST BE SET** via environment variable (auto-generated random if not set)
- `TELEGRAM_BOT_TOKEN` - Required to retrieve auto-generated admin token via Telegram bot

## Admin Token Access

### How to Get Your Admin Token:
1. **Set via Environment Variable** (recommended):
   ```bash
   export ADMIN_TOKEN=your-secure-token-here
   ```

2. **Retrieve via Telegram Bot** (if TELEGRAM_BOT_TOKEN is set):
   - Set up Telegram bot with `TELEGRAM_BOT_TOKEN`
   - Use the bot to get the auto-generated admin token
   - Admin token is available as `global.adminToken` in the system

3. **Auto-Generated Token** (if no ADMIN_TOKEN set):
   - Format: `admin-{random-24-chars}`
   - Only accessible via Telegram bot or server logs
   - **NOT displayed in console for security**

## Security Analysis

### Microsoft Graph API Security ✅
- **OAuth 2.0** - Industry standard secure authentication
- **No Password Storage** - All authentication through Microsoft
- **Token Refresh** - Automatic token renewal
- **Secure Scopes** - Limited permissions (Mail.Read, Mail.Send, User.Read)

### Browser Automation Security ⚠️
- **Headless Operation** - No visible browser windows
- **❌ NO ENCRYPTION** - All cookies stored as plain text
- **❌ UNPROTECTED ENDPOINTS** - Cookie downloads require no authentication
- **Session Isolation** - Separate browser contexts per user
- **Automatic Cleanup** - Sessions expire and cleanup automatically

### Critical Security Issues ❌
1. **Unprotected Cookie Export**: Anyone with a session ID can download authentication cookies
2. **Plain Text Storage**: All cookies and session data stored without encryption
3. **Public Session Data**: Session information downloadable without authentication
4. **Admin Token Exposure**: If not properly configured, admin access may be compromised

## How Authentication Works

### Microsoft Graph API Flow:
1. User visits `/api/auth-url` → Gets OAuth URL
2. User completes OAuth on Microsoft servers
3. Microsoft redirects to `/api/auth-callback` with auth code
4. System exchanges code for tokens and creates authenticated session
5. User can access `/api/profile`, `/api/emails`, `/api/send-email` with session ID

### Browser Automation Flow:
1. User provides email/password directly to the application
2. System launches Chrome browser via Puppeteer
3. Browser automates login to Outlook web interface
4. System captures cookies and stores them as plain text files
5. System generates JavaScript injection scripts for cookie restoration

## When to Use Which Method

### Use Microsoft Graph API When:
- ✅ You need production-grade security and compliance
- ✅ You want Microsoft-approved authentication
- ✅ You have Azure app registration set up
- ✅ You need reliable, supported API access

### Use Browser Automation When:
- ✅ Graph API doesn't meet your specific needs
- ✅ You need to access web interface features not in Graph API
- ✅ You're testing or debugging (non-production)
- ⚠️ **Accept the security risks of plain text cookie storage**

## Current Status (September 23, 2025)

- ✅ **Fully Operational**: Both authentication methods working
- ✅ **Dependencies Installed**: All Node.js packages installed
- ✅ **Server Running**: Express server on port 5000 with CORS
- ✅ **Graph API Ready**: OAuth 2.0 flow functional with Azure integration
- ✅ **Browser Automation Active**: Puppeteer with Chrome automation working
- ✅ **Frontend Working**: Unified interface supporting both methods
- ✅ **Admin Panel Active**: Session monitoring and management tools
- ✅ **Telegram Bot Online**: VPS management and notifications
- ✅ **Session Management**: Both session types with proper cleanup
- ✅ **Data Persistence**: Analytics, sessions, and cookies saved to disk
- ✅ **Deployment Ready**: VM target configured for always-on operation
- ✅ **Replit Optimized**: All configurations set for Replit environment

- ⚠️ **Security Concerns**: Unprotected cookie endpoints and plain text storage
- ⚠️ **Admin Token**: Requires proper configuration for secure admin access

This documentation reflects the actual hybrid architecture and security posture of the current system.