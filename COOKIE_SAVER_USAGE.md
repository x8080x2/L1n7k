# Microsoft Cookie Saver - Usage Guide

## Overview
This standalone module extracts **13 essential Microsoft authentication cookies** from an authenticated Puppeteer session and saves them with 5-year expiry for persistent session management.

## What It Does
1. **Collects cookies** from multiple Microsoft domains (login.microsoftonline.com, outlook.office.com, etc.)
2. **Filters to 13 essential cookies** needed for authentication persistence
3. **Extends expiry** to 5 years for all cookies
4. **Saves to JSON** with metadata (email, password, user agent, etc.)
5. **Generates injection script** for restoring the session in a browser

## Installation
No installation needed - just require the module:

```javascript
const { saveMicrosoftCookies, loadSession, injectSession } = require('./src/cookie-saver');
```

## Basic Usage

### 1. Save Cookies from Authenticated Session

```javascript
const puppeteer = require('puppeteer');
const { saveMicrosoftCookies } = require('./src/cookie-saver');

async function captureSession() {
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();
    
    // ... perform your login here ...
    // (User logs in manually or via automation)
    
    // After successful login, save the cookies
    const result = await saveMicrosoftCookies(page, 'user@example.com', 'password123');
    
    console.log(`Saved ${result.cookieCount} cookies!`);
    console.log(`Session file: ${result.sessionFile}`);
    console.log(`Injection script: ${result.injectionScript}`);
    
    await browser.close();
}
```

### 2. Load Saved Session

```javascript
const { loadSession } = require('./src/cookie-saver');

const sessionData = loadSession('session_data/session_1234567890_user_example_com.json');
console.log(`Email: ${sessionData.email}`);
console.log(`Cookies: ${sessionData.totalCookies}`);
console.log(`Timestamp: ${sessionData.timestamp}`);
```

### 3. Inject Cookies into New Browser Session

```javascript
const puppeteer = require('puppeteer');
const { injectSession } = require('./src/cookie-saver');

async function restoreSession() {
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();
    
    // Inject saved cookies
    const cookieCount = await injectSession(page, 'session_data/session_1234567890_user_example_com.json');
    console.log(`Injected ${cookieCount} cookies`);
    
    // Navigate to Outlook - should be already logged in!
    await page.goto('https://outlook.office.com/mail/');
    
    // User should be automatically authenticated
}
```

## What Cookies Are Captured?

The module captures **13 essential cookies**:

### Core Authentication (Critical)
- `ESTSAUTH` - Enterprise STS authentication token
- `ESTSAUTHPERSISTENT` - Persistent auth token
- `buid` - Browser unique identifier
- `esctx-*` - Any cookies starting with "esctx-" (context tokens)

### Outlook Specific (Required)
- `luat` - Outlook user authentication token
- `SuiteServiceProxyKey` - Service proxy key
- `OWAAppIdType` - Outlook Web App identifier

### Session Management (Minimal)
- `fpc` - Flight pre-check cookie
- `stsservicecookie` - STS service cookie
- `x-ms-gateway-slice` - Gateway routing

## Output Files

### 1. Session JSON File
Location: `session_data/session_[timestamp]_[email].json`

Contains:
```json
{
  "id": 1234567890,
  "timestamp": "2025-11-09T22:00:00.000Z",
  "email": "user@example.com",
  "password": "cGFzc3dvcmQxMjM=",
  "totalCookies": 13,
  "domains": [...],
  "cookies": [...],
  "userAgent": "Mozilla/5.0...",
  "browserFingerprint": {...}
}
```

### 2. Injection Script
Location: `session_data/inject_session_[timestamp].js`

Usage:
1. Open browser console on any Microsoft domain
2. Copy/paste the injection script
3. Script will inject all cookies
4. Navigate to Outlook - you'll be logged in!

## Advanced Usage

### Save Without Email/Password

```javascript
// Just save cookies, no credentials
const result = await saveMicrosoftCookies(page);
```

### Extract Cookies Only (No Files)

```javascript
const result = await saveMicrosoftCookies(page, 'user@example.com');
const cookies = result.cookies; // Array of cookie objects
```

### Use in Your Own System

```javascript
const { saveMicrosoftCookies } = require('./src/cookie-saver');

// Integrate into your existing authentication flow
async function myCustomAuth(page, email, password) {
    // Your login logic here...
    await performLogin(page, email, password);
    
    // Capture cookies after successful login
    const cookieResult = await saveMicrosoftCookies(page, email, password);
    
    // Use the cookies however you need
    return cookieResult;
}
```

## Return Value

`saveMicrosoftCookies()` returns:
```javascript
{
    success: true,
    sessionFile: 'session_data/session_1234567890_user_example_com.json',
    injectionScript: 'session_data/inject_session_1234567890.js',
    cookieCount: 13,
    cookies: [...],  // Array of cookie objects
    sessionData: {...}  // Complete session data object
}
```

## Important Notes

1. **Security Warning**: Cookies and passwords are stored in **plain text** (password is base64 encoded, not encrypted). Protect these files!

2. **Cookie Expiry**: All cookies are automatically extended to 5 years from capture time

3. **Domains**: Cookies are collected from 9 Microsoft authentication domains

4. **Use Case**: Perfect for session persistence, testing, automation, or migrating sessions

5. **Browser Context**: Injection script works in any browser's developer console

## Example: Complete Flow

```javascript
const puppeteer = require('puppeteer');
const { saveMicrosoftCookies, injectSession } = require('./src/cookie-saver');

async function completeExample() {
    // ===== STEP 1: Capture Session =====
    const browser1 = await puppeteer.launch({ headless: false });
    const page1 = await browser1.newPage();
    
    await page1.goto('https://outlook.office.com/mail/');
    // User logs in...
    
    const capture = await saveMicrosoftCookies(page1, 'user@example.com', 'pass');
    console.log(`Captured ${capture.cookieCount} cookies to ${capture.sessionFile}`);
    
    await browser1.close();
    
    // ===== STEP 2: Restore Session (Later) =====
    const browser2 = await puppeteer.launch({ headless: false });
    const page2 = await browser2.newPage();
    
    await injectSession(page2, capture.sessionFile);
    await page2.goto('https://outlook.office.com/mail/');
    
    // User is automatically logged in!
    console.log('Session restored - user is logged in!');
    
    await browser2.close();
}

completeExample();
```

## Questions?

This module is designed to be **simple, standalone, and reusable**. Just pass your authenticated Puppeteer page and it handles the rest!
