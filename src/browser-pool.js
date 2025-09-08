const puppeteer = require('puppeteer');

class BrowserPool {
    constructor(options = {}) {
        this.maxBrowsers = options.maxBrowsers || 1; // Only allow 1 browser
        this.maxPagesPerBrowser = options.maxPagesPerBrowser || 5;
        this.browserTimeout = options.browserTimeout || 5 * 60 * 1000; // 5 minutes
        
        this.browsers = new Map(); // browserId -> { browser, pages, createdAt, lastUsed }
        this.pageQueue = []; // Array of { browser, page } available for use
        this.isInitialized = false;
    }

    async init() {
        if (this.isInitialized) return;
        
        console.log('🏭 Initializing browser pool...');
        
        // Pre-warm one browser
        await this.createBrowser();
        
        // Set up cleanup interval
        this.cleanupInterval = setInterval(() => {
            this.cleanupExpiredBrowsers();
        }, 60000); // Check every minute
        
        this.isInitialized = true;
        console.log('✅ Browser pool initialized');
    }

    async createBrowser() {
        if (this.browsers.size >= this.maxBrowsers) {
            console.log(`🛑 Browser pool at capacity (${this.maxBrowsers} max). Using existing browser.`);
            return null;
        }

        const browserOptions = {
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu',
                '--disable-extensions',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding',
                // Performance optimizations
                '--disable-features=TranslateUI',
                '--disable-ipc-flooding-protection',
                '--disable-default-apps',
                '--disable-component-extensions-with-background-pages',
                '--disable-background-networking',
                '--disable-sync',
                '--disable-web-security',
                '--no-default-browser-check',
                '--no-pings',
                '--disable-prompt-on-repost',
                '--disable-hang-monitor',
                '--disable-client-side-phishing-detection',
                '--disable-popup-blocking',
                '--disable-translate',
                '--disable-logging',
                '--disable-permissions-api',
                '--aggressive-cache-discard',
                '--memory-pressure-off'
            ]
        };

        // Try to find Chromium dynamically for Replit environment
        try {
            const fs = require('fs');
            const { execSync } = require('child_process');
            
            try {
                const chromiumPath = execSync('which chromium', { encoding: 'utf8' }).trim();
                if (chromiumPath && fs.existsSync(chromiumPath)) {
                    browserOptions.executablePath = chromiumPath;
                }
            } catch (e) {
                const nixStoreDirs = execSync('ls -d /nix/store/*chromium*/bin/chromium 2>/dev/null || true', { encoding: 'utf8' }).trim().split('\n').filter(p => p);
                if (nixStoreDirs.length > 0 && fs.existsSync(nixStoreDirs[0])) {
                    browserOptions.executablePath = nixStoreDirs[0];
                }
            }
        } catch (error) {
            // Use default Puppeteer browser
        }

        const browser = await puppeteer.launch(browserOptions);
        const browserId = Date.now().toString();
        
        this.browsers.set(browserId, {
            browser,
            pages: 0,
            createdAt: Date.now(),
            lastUsed: Date.now()
        });

        console.log(`🚀 Created new browser in pool: ${browserId}`);
        return browserId;
    }

    async getPage() {
        if (!this.isInitialized) {
            await this.init();
        }

        // Check for available page in queue
        if (this.pageQueue.length > 0) {
            const pageInfo = this.pageQueue.shift();
            this.browsers.get(pageInfo.browserId).lastUsed = Date.now();
            return pageInfo;
        }

        // Find browser with available capacity
        for (const [browserId, browserInfo] of this.browsers.entries()) {
            if (browserInfo.pages < this.maxPagesPerBrowser) {
                try {
                    const page = await browserInfo.browser.newPage();
                    
                    // Set viewport and user agent
                    await page.setViewport({ width: 1280, height: 720 });
                    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
                    
                    browserInfo.pages++;
                    browserInfo.lastUsed = Date.now();
                    
                    return {
                        browserId,
                        browser: browserInfo.browser,
                        page
                    };
                } catch (error) {
                    console.error(`Error creating page in browser ${browserId}:`, error);
                    // Remove failed browser
                    await this.removeBrowser(browserId);
                    continue;
                }
            }
        }

        // No available browsers, create new one
        const browserId = await this.createBrowser();
        if (browserId) {
            const browserInfo = this.browsers.get(browserId);
            const page = await browserInfo.browser.newPage();
            
            await page.setViewport({ width: 1280, height: 720 });
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
            
            browserInfo.pages++;
            browserInfo.lastUsed = Date.now();
            
            return {
                browserId,
                browser: browserInfo.browser,
                page
            };
        }

        throw new Error('Unable to create page: Browser pool at capacity');
    }

    async returnPage(browserId, page) {
        const browserInfo = this.browsers.get(browserId);
        if (!browserInfo) return;

        try {
            // Clear the page for reuse
            await page.goto('about:blank');
            await page.evaluate(() => {
                localStorage.clear();
                sessionStorage.clear();
            });
            
            // Add to queue for reuse
            this.pageQueue.push({ browserId, browser: browserInfo.browser, page });
            browserInfo.lastUsed = Date.now();
            
        } catch (error) {
            console.error('Error returning page to pool:', error);
            // Close the problematic page
            try {
                await page.close();
                browserInfo.pages--;
            } catch (e) {
                // Ignore close errors
            }
        }
    }

    async closePage(browserId, page) {
        const browserInfo = this.browsers.get(browserId);
        if (!browserInfo) return;

        try {
            await page.close();
            browserInfo.pages--;
        } catch (error) {
            console.error('Error closing page:', error);
        }
    }

    async removeBrowser(browserId) {
        const browserInfo = this.browsers.get(browserId);
        if (!browserInfo) return;

        try {
            await browserInfo.browser.close();
        } catch (error) {
            console.error(`Error closing browser ${browserId}:`, error);
        }

        this.browsers.delete(browserId);
        
        // Remove pages from queue that belong to this browser
        this.pageQueue = this.pageQueue.filter(item => item.browserId !== browserId);
        
        console.log(`🗑️ Removed browser from pool: ${browserId}`);
    }

    cleanupExpiredBrowsers() {
        const now = Date.now();
        
        for (const [browserId, browserInfo] of this.browsers.entries()) {
            if (now - browserInfo.lastUsed > this.browserTimeout) {
                console.log(`🧹 Cleaning up expired browser: ${browserId}`);
                this.removeBrowser(browserId);
            }
        }
    }

    getStats() {
        return {
            totalBrowsers: this.browsers.size,
            availablePages: this.pageQueue.length,
            maxBrowsers: this.maxBrowsers,
            isInitialized: this.isInitialized
        };
    }

    async shutdown() {
        console.log('🛑 Shutting down browser pool...');
        
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }

        for (const [browserId] of this.browsers.entries()) {
            await this.removeBrowser(browserId);
        }
        
        this.pageQueue = [];
        this.isInitialized = false;
        
        console.log('✅ Browser pool shutdown complete');
    }
}

// Singleton instance
const browserPool = new BrowserPool();

module.exports = { BrowserPool, browserPool };