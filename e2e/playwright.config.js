const {defineConfig, devices} = require('@playwright/test');

module.exports = defineConfig({
    testDir: './tests',
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
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
                defaultBrowserType: 'chromium',
            },
            testMatch: /mobile\.spec\.js/,
            fullyParallel: true,
        },
        {
            name: 'site-firefox',
            use: {...devices['Desktop Firefox'], permissions: []},
            testMatch: /site\.spec\.js/,
        },
    ],
});
