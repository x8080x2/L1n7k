# Outlook Login Automation

## Overview

This project provides a robust web browser automation tool for Microsoft Outlook login processes using Puppeteer. It automates navigation, login, and extracts session cookies for authentication persistence. The system is optimized for cloud environments like Replit, focusing on legitimate use cases such as testing, development, and authorized account management, adhering strictly to Microsoft's Terms of Service.

## User Preferences

Preferred communication style: Simple, everyday language.

## Recent Changes

**September 12, 2025**
- Successfully imported from GitHub and configured for Replit environment
- All dependencies installed (Express.js, CORS, Puppeteer)
- Server configured to run on port 5000 with 0.0.0.0 binding for Replit compatibility
- CORS properly configured for Replit proxy environment
- Deployment configuration set for VM target (always-on for browser automation)
- Application successfully running and preloading Outlook sessions

## System Architecture

The application is built around the `OutlookLoginAutomation` class, which encapsulates all browser operations using Puppeteer. An Express.js server provides a RESTful API.

### UI/UX Decisions
- Simple web interface for manual testing and demonstration, directly integrating with backend API endpoints.

### Technical Implementations
- **Browser Automation Framework**: Utilizes Puppeteer for headless browser control.
    - `init()`: Initializes Chromium with optimized settings for cloud environments, including dynamic path detection and retry logic.
    - `navigateToOutlook()`: Navigates to Outlook's web interface.
    - `performLogin(email, password)`: Orchestrates the full login process, handling email entry, provider detection, password submission, and MFA support.
    - **Login Provider Detection**: `detectLoginProvider()` identifies authentication systems (Microsoft, ADFS, Okta, Azure AD, Generic SAML) via URL and page content analysis.
    - **Specialized Login Handlers**: Dedicated functions for `handleMicrosoftLogin()`, `handleADFSLogin()`, `handleOktaLogin()`, `handleAzureADLogin()`, `handleGenericSAMLLogin()`, and `handleGenericLogin()` manage diverse authentication flows.
    - `handleStaySignedInPrompt()`: Automatically handles "Stay signed in?" prompts.
    - `saveCookies()`: Extracts and saves authentication cookies from multiple Microsoft domains (e.g., login.microsoftonline.com, outlook.office.com) to enable session persistence, generating injection scripts for browser restoration.
    - `checkEmails()`: Extracts email subjects post-login for verification.
    - `takeScreenshot(filename)`: Captures JPEG screenshots for debugging.
    - `close()`: Safely closes browser instances.

### System Design Choices
- **Server Architecture**: Express.js provides a RESTful API.
    - `getOrCreateSession()`: Manages single active browser sessions with mutex protection.
    - `initBrowser()`: Initializes browser instances with comprehensive error handling.
    - **API Endpoints**:
        - `GET /api/health`: System status.
        - `POST /api/preload`: Pre-loads Outlook login page.
        - `POST /api/login`: Handles email verification and full login.
        - `POST /api/continue-login`: Completes login with a separately provided password.
        - `POST /api/screenshot`: Captures current browser state.
        - `GET /api/emails`: Retrieves recent email subjects.
        - `DELETE /api/session`: Terminates active browser sessions.
        - `POST /api/back`: Reloads Outlook page to reset state.
        - `GET /api/status`: Returns active session information.
        - `POST /api/extend-session`: Extends session timeout.
        - `GET /api/sessions`: Lists saved session files.
        - `GET /api/export-cookies`: Generates JavaScript injection scripts for cookie restoration.
- **Security**: Headless operation, disabled unnecessary browser features, secure cookie handling, and user agent spoofing.
- **Performance**: Single browser instance model, compressed screenshots, optimized wait times, and efficient cookie filtering.
- **Error Handling**: Comprehensive try-catch blocks, timeout protection, graceful degradation, retry logic, and mutex protection.
- **Data Management**:
    - `session_data/`: Stores JSON session files with complete authentication data and JavaScript injection scripts.
    - `screenshots/`: Stores timestamped JPEG screenshots for visual debugging.
    - `public/`: Contains the simple web interface.

## External Dependencies

- **Puppeteer (^24.19.0)**: Core browser automation.
- **Express.js (^5.1.0)**: Web server framework for API.
- **CORS (^2.8.5)**: Cross-origin resource sharing, configured permissively for Replit compatibility.
- **Microsoft Outlook Web Interface (https://outlook.office.com/mail/)**: The target for automation.
- **Chromium Browser**: The browser engine, dynamically detected from the Nix store or bundled by Puppeteer.