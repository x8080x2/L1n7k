const { OutlookLoginAutomation } = require('./outlook-login');

async function runExample() {
    const automation = new OutlookLoginAutomation();

    try {
        console.log('=== Outlook Login Automation Demo ===\n');
        
        // Initialize browser
        await automation.init();

        // Navigate to Outlook
        const navigated = await automation.navigateToOutlook();
        if (!navigated) {
            throw new Error('Failed to navigate to Outlook');
        }

        console.log('✓ Successfully navigated to Outlook');
        
        // Take screenshot for verification
        await automation.takeScreenshot('outlook-page.png');
        console.log('✓ Screenshot taken');

        // Display instructions
        console.log('\n📧 OUTLOOK LOGIN AUTOMATION READY');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('The browser is now at the Outlook login page.');
        console.log('');
        console.log('To perform automated login, you can use:');
        console.log('');
        console.log('const success = await automation.performLogin(');
        console.log('    "your-email@company.com",');
        console.log('    "your-password"');
        console.log(');');
        console.log('');
        console.log('For security, consider using environment variables:');
        console.log('const email = process.env.OUTLOOK_EMAIL;');
        console.log('const password = process.env.OUTLOOK_PASSWORD;');
        console.log('');
        console.log('Browser will remain open for inspection...');

        // Keep browser open for manual inspection/testing
        await new Promise(resolve => setTimeout(resolve, 30000));

    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    } finally {
        await automation.close();
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n👋 Shutting down gracefully...');
    process.exit(0);
});

runExample().catch(console.error);