#!/usr/bin/env node

/**
 * Chrome Setup Script for Deployment Environments
 * Handles Chrome/Chromium detection and installation for different platforms
 */

const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

class ChromeSetup {
    constructor() {
        this.platform = process.platform;
        this.isRender = !!(process.env.RENDER || process.env.RENDER_SERVICE_ID);
        this.isHeroku = !!process.env.DYNO;
        this.isRailway = !!process.env.RAILWAY_ENVIRONMENT;
        this.isReplit = !!(process.env.REPLIT_ENVIRONMENT || process.env.REPL_ID);
        this.isVercel = !!process.env.VERCEL;
        
        console.log(`🔍 Detected environment: ${this.getEnvironmentName()}`);
    }

    getEnvironmentName() {
        if (this.isRender) return 'Render';
        if (this.isHeroku) return 'Heroku';
        if (this.isRailway) return 'Railway';
        if (this.isReplit) return 'Replit';
        if (this.isVercel) return 'Vercel';
        return 'Generic';
    }

    async setup() {
        console.log('🚀 Starting Chrome setup...');
        
        try {
            // Check if Puppeteer Chrome is already available
            const puppeteer = require('puppeteer');
            if (typeof puppeteer.executablePath === 'function') {
                const chromePath = puppeteer.executablePath();
                if (fs.existsSync(chromePath)) {
                    console.log(`✅ Puppeteer Chrome found at: ${chromePath}`);
                    return chromePath;
                }
            }
        } catch (error) {
            console.log('⚠️  Puppeteer Chrome not found, checking alternatives...');
        }

        // Platform-specific setup
        if (this.isRender) {
            return await this.setupForRender();
        } else if (this.isHeroku) {
            return await this.setupForHeroku();
        } else if (this.isRailway) {
            return await this.setupForRailway();
        } else if (this.isReplit) {
            return await this.setupForReplit();
        } else {
            return await this.setupGeneric();
        }
    }

    async setupForRender() {
        console.log('🔧 Setting up Chrome for Render...');
        
        // Render uses the build command to install Chrome
        const renderPaths = [
            '/opt/render/.cache/puppeteer/chrome/linux-*/chrome-linux64/chrome',
            '/usr/bin/google-chrome-stable',
            '/usr/bin/google-chrome'
        ];

        for (const pathPattern of renderPaths) {
            const chromePath = await this.findChrome(pathPattern);
            if (chromePath) {
                console.log(`✅ Chrome found at: ${chromePath}`);
                return chromePath;
            }
        }

        console.log('⚠️  Chrome not found. Make sure your build command includes: npx puppeteer browsers install chrome');
        return null;
    }

    async setupForHeroku() {
        console.log('🔧 Setting up Chrome for Heroku...');
        
        const herokuPaths = [
            '/app/.chrome-for-testing/chrome-linux64/chrome',
            '/app/.apt/usr/bin/google-chrome-stable',
            '/usr/bin/google-chrome-stable'
        ];

        for (const pathPattern of herokuPaths) {
            const chromePath = await this.findChrome(pathPattern);
            if (chromePath) {
                console.log(`✅ Chrome found at: ${chromePath}`);
                return chromePath;
            }
        }

        console.log('⚠️  Chrome not found. Add the Google Chrome buildpack to your Heroku app.');
        return null;
    }

    async setupForRailway() {
        console.log('🔧 Setting up Chrome for Railway...');
        
        const railwayPaths = [
            '/usr/bin/google-chrome-stable',
            '/usr/bin/google-chrome',
            '/usr/bin/chromium-browser'
        ];

        for (const pathPattern of railwayPaths) {
            const chromePath = await this.findChrome(pathPattern);
            if (chromePath) {
                console.log(`✅ Chrome found at: ${chromePath}`);
                return chromePath;
            }
        }

        console.log('⚠️  Chrome not found. Railway should have Chrome available by default.');
        return null;
    }

    async setupForReplit() {
        console.log('🔧 Setting up Chrome for Replit...');
        
        const replitPaths = [
            '/nix/store/*/bin/chromium',
            '/usr/bin/chromium'
        ];

        for (const pathPattern of replitPaths) {
            const chromePath = await this.findChrome(pathPattern);
            if (chromePath) {
                console.log(`✅ Chrome found at: ${chromePath}`);
                return chromePath;
            }
        }

        console.log('⚠️  Chrome not found. Replit should have Chromium in the Nix store.');
        return null;
    }

    async setupGeneric() {
        console.log('🔧 Setting up Chrome for generic environment...');
        
        const genericPaths = [
            '/usr/bin/google-chrome-stable',
            '/usr/bin/google-chrome',
            '/usr/bin/chromium-browser',
            '/usr/bin/chromium'
        ];

        for (const pathPattern of genericPaths) {
            const chromePath = await this.findChrome(pathPattern);
            if (chromePath) {
                console.log(`✅ Chrome found at: ${chromePath}`);
                return chromePath;
            }
        }

        console.log('⚠️  Chrome not found in common locations.');
        return null;
    }

    async findChrome(pathPattern) {
        try {
            if (pathPattern.includes('*')) {
                // Handle glob patterns
                const command = `ls ${pathPattern} 2>/dev/null | head -1`;
                const result = execSync(command, { encoding: 'utf8' }).trim();
                if (result && fs.existsSync(result)) {
                    return result;
                }
            } else {
                // Handle direct paths
                if (fs.existsSync(pathPattern)) {
                    return pathPattern;
                }
            }
        } catch (error) {
            // Path not found, continue searching
        }
        return null;
    }
}

// Main execution
async function main() {
    const setup = new ChromeSetup();
    const chromePath = await setup.setup();
    
    if (chromePath) {
        console.log('✅ Chrome setup completed successfully');
        process.env.CHROME_EXECUTABLE_PATH = chromePath;
    } else {
        console.log('⚠️  Chrome setup completed with warnings');
    }
}

// Run if executed directly
if (require.main === module) {
    main().catch(error => {
        console.error('❌ Chrome setup failed:', error.message);
        process.exit(1);
    });
}

module.exports = ChromeSetup;