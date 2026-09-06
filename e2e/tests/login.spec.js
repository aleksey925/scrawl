const {expect, test} = require('@playwright/test');

const docs = require('../support/docs');
const {MAIN, shot, signIn, submitCredentials} = require('../support/helpers');

test.describe('login', () => {
    test('rejects a wrong password and shows the error', async ({page}) => {
        await page.goto('/login');
        await submitCredentials(page, {secret: 'not-the-password'});

        await expect(page).toHaveURL(/\/login$/);
        await expect(page.locator('.login-error')).toHaveText(/Wrong user name or password/);
        await shot(page, 'login-wrong-password');
    });

    test('accepts the right password and lands on the knowledge base', async ({page}) => {
        await signIn(page);

        await expect(page).toHaveURL(`${MAIN.baseURL}/`);
        await expect(page.locator('#doc h1').first()).toContainText(docs.home.title);
        await expect(page.locator('#sidebar .tree-item').first()).toBeVisible();
        await shot(page, 'login-home');
    });

    test('keeps the session across a reload', async ({page}) => {
        await signIn(page);
        await page.reload();

        await expect(page).toHaveURL(`${MAIN.baseURL}/`);
        await expect(page.locator('#doc')).toBeVisible();
    });

    test('signing out returns to the login page', async ({page}) => {
        await signIn(page);
        await page.click('[data-menu-open="user-menu"]');
        await expect(page.locator('#user-menu')).toBeVisible();
        await shot(page, 'login-user-menu');

        await page.click('#user-menu button[type="submit"]');
        await expect(page).toHaveURL(/\/login/);
        await expect(page.locator('.login-card')).toBeVisible();
    });

    test('a protected url while signed out comes back after signing in', async ({page}) => {
        const target = `/p/${docs.doc.path}`;
        await page.goto(target);

        await expect(page).toHaveURL(`${MAIN.baseURL}/login?from=${encodeURIComponent(target)}`);
        await shot(page, 'login-redirected');

        await submitCredentials(page);
        await expect(page).toHaveURL(`${MAIN.baseURL}${target}`);
        await expect(page.locator('#doc h1').first()).toContainText(docs.doc.title);
    });
});
