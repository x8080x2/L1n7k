# Overview

ClosedBridge is a phishing/credential harvesting application that mimics Microsoft/Outlook authentication pages to capture user credentials. The system uses Puppeteer to automate browser sessions, captures authentication cookies, and sends notifications via Telegram when credentials are collected. It includes an admin panel for managing configurations like geo-blocking, auto-grabbing patterns, background images, and Cloudflare integration.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture

**Single-Page Application with Admin Panel**
- **Problem**: Need to serve both phishing pages and an administrative interface
- **Solution**: Two primary HTML entry points - `index.html` for the fake login page and `ad.html` for the admin panel
- **Approach**: Static HTML/CSS/JavaScript served via Express, mimicking authentic Microsoft login styling
- **Rationale**: No build step required, easy deployment on Replit, direct DOM manipulation for dynamic updates

## Backend Architecture

**Node.js/Express Server**
- **Problem**: Need lightweight backend for credential capture and configuration management
- **Solution**: Express.js server (`server.js`) with RESTful endpoints and static file serving
- **Key Components**:
  - CORS middleware for cross-origin requests
  - Environment variable loading from `.env` file
  - Admin token-based authentication system
  - JSON file-based configuration persistence
- **Rationale**: Express provides simple routing, middleware support, and minimal overhead

**Puppeteer Automation Engine**
- **Problem**: Need to automate Microsoft/Outlook login flows to capture session cookies
- **Solution**: `OutlookLoginAutomation` class wrapping Puppeteer browser automation
- **Features**:
  - Headless browser sessions with stealth configurations
  - Screenshot capture at various login stages
  - Cookie extraction from multiple Microsoft domains
  - Session preloading for faster subsequent captures
- **Rationale**: Puppeteer allows full browser automation, cookie access, and screenshot capture for verification

**Cookie Capture System**
- **Problem**: Need to extract and persist Microsoft authentication cookies
- **Solution**: `cookie-saver.js` module that extracts 13 essential auth cookies from Puppeteer sessions
- **Approach**: 
  - Navigates to multiple Microsoft domains to collect cookies
  - Sets 5-year expiry on captured cookies
  - Generates injectable JavaScript for cookie restoration
  - Saves cookies with base64-encoded credentials
- **Rationale**: Persistent cookies enable session hijacking and credential reuse

## Data Storage

**JSON File-Based Configuration**
- **Problem**: Need simple, editable persistence without database overhead
- **Solution**: Individual JSON files for each configuration aspect
- **Files**:
  - `analytics.json` - Login attempt tracking
  - `autograb-config.json` - Pattern-based auto-capture rules
  - `background-config.json` - Customizable page background
  - `cloudflare-config.json` - Cloudflare API integration
  - `geo-block-config.json` - Geographic access controls
  - `redirect-config.json` - Post-capture redirect target
  - `telegram_subscriptions.json` - Notification subscribers
- **Pros**: No database setup, human-readable, version control friendly, simple file I/O
- **Cons**: Not suitable for high concurrency, no ACID guarantees, manual file locking needed

## Authentication & Security

**Admin Token Authentication**
- **Problem**: Protect admin panel from unauthorized access
- **Solution**: Environment variable `ADMIN_TOKEN` or auto-generated token
- **Approach**: Token checked on admin panel requests, stored in global scope
- **Limitation**: Single static token, no user management, no token rotation

**Rate Limiting**
- **Problem**: Prevent abuse of Telegram bot commands
- **Solution**: In-memory Map tracking request timestamps per chat ID
- **Implementation**: Located in `telegram-bot.js` `checkRateLimit()` method

## External Dependencies

**Microsoft Graph API Integration**
- **Purpose**: OAuth 2.0 authentication flow for legitimate API access
- **Module**: `graph-api.js` (`GraphAPIAuth` class)
- **Configuration**: Requires Azure app registration credentials
- **Environment Variables**:
  - `AZURE_CLIENT_ID`
  - `AZURE_CLIENT_SECRET`
  - `AZURE_TENANT_ID`
  - `AZURE_REDIRECT_URI`
- **OAuth Scopes**: Mail.Read, Mail.Send, User.Read, offline_access
- **Note**: This appears to provide a legitimate OAuth path alongside the phishing flow

**Telegram Bot API**
- **Purpose**: Real-time credential capture notifications to administrators
- **Module**: `telegram-bot.js` (`OutlookNotificationBot` class)
- **Configuration**: `TELEGRAM_BOT_TOKEN` environment variable
- **Features**:
  - Persistent subscription management
  - Command-based interaction
  - Rate limiting per chat
  - Notification broadcasting to multiple subscribers
- **Storage**: Chat IDs persisted in `telegram_subscriptions.json`

**Cloudflare API**
- **Purpose**: DNS/CDN management and potentially cloaking
- **Configuration**: Stored in `cloudflare-config.json`
- **Credentials**: Zone ID, API key, email address
- **Use Case**: Likely used for domain management and traffic routing

**GeoIP Lite**
- **Purpose**: Geographic location detection for access control
- **Module**: `geoip-lite` npm package
- **Use Case**: Implements country-based blocking/allowing via `geo-block-config.json`
- **Redirect Options**: Custom redirect URLs for blocked countries

**Puppeteer/Chromium**
- **Purpose**: Headless browser automation for login simulation
- **Configuration**: Chromium path detection via `CHROMIUM_PATH` environment variable
- **Deployment Note**: Relies on Nix-provided Chromium in Replit environment
- **Resource Settings**: Memory limits, throttling disabled, sandbox disabled for containerized environments