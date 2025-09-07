const { OutlookLoginAutomation } = require('./src/outlook-login');

class PerformanceProfiler {
    constructor() {
        this.timings = {};
        this.startTimes = {};
    }

    start(operation) {
        this.startTimes[operation] = Date.now();
        console.log(`⏱️  Started: ${operation}`);
    }

    end(operation) {
        if (this.startTimes[operation]) {
            const duration = Date.now() - this.startTimes[operation];
            this.timings[operation] = duration;
            console.log(`✅ Completed: ${operation} (${duration}ms)`);
            delete this.startTimes[operation];
            return duration;
        }
        return 0;
    }

    getReport() {
        console.log('\n📊 PERFORMANCE REPORT:');
        console.log('='.repeat(50));
        Object.entries(this.timings).forEach(([operation, time]) => {
            console.log(`${operation.padEnd(30)} ${time}ms`);
        });
        console.log('='.repeat(50));
        
        const totalTime = Object.values(this.timings).reduce((sum, time) => sum + time, 0);
        console.log(`Total Time: ${totalTime}ms (${(totalTime/1000).toFixed(2)}s)`);
        return this.timings;
    }
}

async function testCurrentPerformance() {
    const profiler = new PerformanceProfiler();
    // Test with optimizations enabled
    const automation = new OutlookLoginAutomation({
        enableScreenshots: false, // Disable screenshots for faster testing
        usePool: true // Enable browser pooling
    });

    try {
        // Test browser initialization
        profiler.start('Browser Initialization');
        await automation.init();
        profiler.end('Browser Initialization');

        // Test navigation
        profiler.start('Navigation to Outlook');
        const navigated = await automation.navigateToOutlook();
        profiler.end('Navigation to Outlook');

        if (!navigated) {
            console.error('❌ Navigation failed');
            return;
        }

        // Test screenshot operation
        profiler.start('Screenshot Operation');
        await automation.takeScreenshot('screenshots/performance-test.png');
        profiler.end('Screenshot Operation');

        // Test login detection
        profiler.start('Login Status Check');
        const isLoggedIn = await automation.isLoggedIn();
        profiler.end('Login Status Check');

        console.log(`Currently logged in: ${isLoggedIn}`);

        // Test page analysis
        profiler.start('Page Analysis');
        const pageTitle = await automation.page.title();
        const pageUrl = automation.page.url();
        profiler.end('Page Analysis');

        console.log(`Page: ${pageTitle}`);
        console.log(`URL: ${pageUrl}`);

        // Test session cleanup
        profiler.start('Session Cleanup');
        await automation.close();
        profiler.end('Session Cleanup');

        return profiler.getReport();

    } catch (error) {
        console.error('❌ Performance test failed:', error);
        try {
            await automation.close();
        } catch (e) {
            // Ignore cleanup errors
        }
    }
}

// Run the performance test
if (require.main === module) {
    console.log('🚀 Starting performance test...\n');
    testCurrentPerformance().then(() => {
        console.log('\n✅ Performance test completed');
        process.exit(0);
    }).catch(error => {
        console.error('❌ Test failed:', error);
        process.exit(1);
    });
}

module.exports = { PerformanceProfiler, testCurrentPerformance };