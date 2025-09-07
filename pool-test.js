const { OutlookLoginAutomation } = require('./src/outlook-login');
const { PerformanceProfiler } = require('./performance-test');

async function testBrowserPooling() {
    console.log('🚀 Testing browser pooling benefits...\n');

    // First request (cold start)
    console.log('📊 FIRST REQUEST (Cold Start):');
    const profiler1 = new PerformanceProfiler();
    const automation1 = new OutlookLoginAutomation({
        enableScreenshots: false,
        usePool: true
    });

    profiler1.start('First Request Total');
    await automation1.init();
    await automation1.navigateToOutlook();
    await automation1.close();
    const firstTime = profiler1.end('First Request Total');

    // Small delay to simulate realistic usage
    await new Promise(resolve => setTimeout(resolve, 500));

    // Second request (warm start - should use pooled browser)
    console.log('\n📊 SECOND REQUEST (Warm Start):');
    const profiler2 = new PerformanceProfiler();
    const automation2 = new OutlookLoginAutomation({
        enableScreenshots: false,
        usePool: true
    });

    profiler2.start('Second Request Total');
    await automation2.init();
    await automation2.navigateToOutlook();
    await automation2.close();
    const secondTime = profiler2.end('Second Request Total');

    // Results
    console.log('\n🏁 POOLING PERFORMANCE COMPARISON:');
    console.log('='.repeat(50));
    console.log(`First Request:  ${firstTime}ms`);
    console.log(`Second Request: ${secondTime}ms`);
    console.log(`Improvement:    ${Math.round((firstTime - secondTime) / firstTime * 100)}% faster`);
    console.log(`Time Saved:     ${firstTime - secondTime}ms`);
    console.log('='.repeat(50));

    return { firstTime, secondTime };
}

if (require.main === module) {
    testBrowserPooling().then(() => {
        console.log('\n✅ Browser pooling test completed');
        process.exit(0);
    }).catch(error => {
        console.error('❌ Test failed:', error);
        process.exit(1);
    });
}

module.exports = { testBrowserPooling };