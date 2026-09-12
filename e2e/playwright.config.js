const {defineConfig, devices} = require('@playwright/test');

const {instances} = require('./support/env');

const launcher = require.resolve('./support/serve.js');

// one worker on purpose: both projects drive the same notes tree on disk,
// and a second worker would rename files under a running test
module.exports = defineConfig({
    testDir: './tests',
    fullyParallel: false,
    workers: 1,
    forbidOnly: !!process.env.CI,
    // a shared runner is slow enough to lose a race a laptop always wins, and a
    // rerun is cheaper than a red build nobody trusts
    retries: process.env.CI ? 1 : 0,
    timeout: 45_000,
    expect: {timeout: 10_000},
    reporter: [['list'], ['html', {open: 'never', outputFolder: 'playwright-report'}]],
    outputDir: './test-results',

    use: {
        baseURL: instances.main.baseURL,
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
        },
    ],

    webServer: [
        {
            command: `node ${launcher} main`,
            url: `${instances.main.baseURL}/login`,
            reuseExistingServer: false,
            timeout: 120_000,
            stdout: 'pipe',
            stderr: 'pipe',
        },
        {
            command: `node ${launcher} readonly`,
            url: `${instances.readonly.baseURL}/login`,
            reuseExistingServer: false,
            timeout: 120_000,
            stdout: 'pipe',
            stderr: 'pipe',
        },
        {
            command: `node ${launcher} shared`,
            url: `${instances.shared.baseURL}/login`,
            reuseExistingServer: false,
            timeout: 120_000,
            stdout: 'pipe',
            stderr: 'pipe',
        },
        {
            command: `node ${launcher} history`,
            url: `${instances.history.baseURL}/login`,
            reuseExistingServer: false,
            timeout: 120_000,
            stdout: 'pipe',
            stderr: 'pipe',
        },
    ],
});
