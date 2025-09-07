# Outlook Login Automation

## Overview

This project is a web browser automation tool specifically designed for Microsoft Outlook login processes. It leverages Puppeteer (a headless Chrome Node.js API) to programmatically navigate to Outlook's web interface and perform automated login operations. The system is configured to run in Replit's environment with appropriate browser settings and security considerations for cloud-based execution.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Browser Automation Framework
The application is built around Puppeteer's headless browser automation capabilities. The core architecture follows a class-based design pattern with the `OutlookLoginAutomation` class encapsulating all browser operations. This design provides a clean separation of concerns and makes the automation logic reusable and maintainable.

### Environment Configuration
The system is specifically configured for Replit's cloud environment, utilizing a custom Chromium executable path and browser launch arguments optimized for containerized environments. Key configurations include disabling sandboxing, GPU acceleration, and other features that may not work reliably in cloud environments.

### Security Design
The application implements security best practices by avoiding hardcoded credentials in the source code. Instead, it encourages the use of environment variables for sensitive login information, reducing the risk of credential exposure in version control systems.

### Error Handling and Logging
The system includes comprehensive error handling with try-catch blocks and detailed console logging to provide visibility into the automation process. This makes debugging and monitoring easier in production environments.

### Screenshot Capabilities
The application includes built-in screenshot functionality for verification and debugging purposes, allowing users to visually confirm that the automation is working correctly.

## External Dependencies

### Puppeteer
The primary dependency is Puppeteer (version ^24.19.0), which provides the core browser automation functionality. This library handles all interactions with the Chromium browser, including navigation, element selection, and form submission.

### Microsoft Outlook Web Interface
The application targets Microsoft Outlook's web interface at `https://outlook.office.com/mail/`. This external dependency means the automation is subject to any changes Microsoft makes to their web interface structure or authentication flow.

### Chromium Browser
The system depends on a specific Chromium installation located at `/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium`, which is part of Replit's Nix-based environment setup.

### Node.js Runtime
The application requires Node.js runtime environment with support for async/await patterns and ES6 module features.

## Recent Changes
- **September 07, 2025**: Imported project from GitHub and configured for Replit environment
  - Installed all Node.js dependencies (express, cors, puppeteer)
  - Configured server to bind to 0.0.0.0:5000 for Replit hosting
  - Updated CORS settings to allow all origins for proxy compatibility
  - Configured deployment as VM type for persistent browser automation
  - Project successfully running and accessible via web interface

## Project Status
- ✅ Dependencies installed and up-to-date
- ✅ Server configured for Replit environment (port 5000)
- ✅ CORS properly configured for proxy access
- ✅ Deployment configured as VM for persistent operation
- ✅ Web interface accessible and functional