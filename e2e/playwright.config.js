const {defineConfig, devices} = require('@playwright/test');

// a worker brings up servers of its own in support/test.js, so files run in
// parallel, and the tests of one file in order, on the trees that file shares
module.exports = defineConfig({
    testDir: './tests',
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    // a shared runner is slow enough to lose a race a laptop always wins, and a
    // rerun is cheaper than a red build nobody trusts
    retries: process.env.CI ? 1 : 0,
    timeout: 45_000,
    expect: {timeout: 10_000},
    reporter: [['list'], ['html', {open: 'never', outputFolder: 'playwright-report'}]],
    outputDir: './test-results',

    use: {
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: 'off',
        permissions: ['clipboard-read', 'clipboard-write'],
    },

    projects: [
        {
            name: 'desktop',
            use: {
                ...devices['Desktop Chrome'],
                viewport: {width: 1440, height: 900},
            },
            testIgnore: /mobile\.spec\.js/,
        },
        {
            name: 'mobile',
            use: {
                ...devices['iPhone 13'],
                viewport: {width: 390, height: 844},
                isMobile: true,
                hasTouch: true,
                // chromium is the only engine installed, keep the iPhone metrics
                // and user agent but run them on it
                defaultBrowserType: 'chromium',
            },
            testMatch: /mobile\.spec\.js/,
            // the profile is one file, a minute long in one worker, and none of
            // its tests leans on another
            fullyParallel: true,
        },
        {
            // a site opened from disk is where the engines part ways: Firefox
            // shares the cookie between files and Chromium the storage
            name: 'site-firefox',
            use: {...devices['Desktop Firefox'], permissions: []},
            testMatch: /site\.spec\.js/,
        },
    ],
});
