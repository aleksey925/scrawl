const {expect, test} = require('@playwright/test');

const docs = require('../support/docs');
const {MAIN, atHome, routes, shot, signIn, submitCredentials, user} = require('../support/helpers');
const text = require('../support/text');

test.describe('login', () => {
    test('accepts the right password and lands on the notes home', async ({page}) => {
        await signIn(page);

        await expect(page).toHaveURL(MAIN.url.home());
        await expect(page.getByTestId('doc').locator('h1').first()).toContainText(docs.home.title);
        await expect(page.getByTestId('tree-row').first()).toBeVisible();
        await shot(page, 'login-home');
    });

    test('keeps the session across a reload', async ({page}) => {
        await signIn(page);
        await page.reload();

        await expect(page).toHaveURL(MAIN.url.home());
        await expect(page.getByTestId('doc')).toBeVisible();
        await expect(page.getByTestId('sidebar')).toBeVisible();
    });

    test('a protected url while signed out comes back after signing in', async ({page}) => {
        const target = routes.doc(docs.doc.path);
        await page.goto(target);

        // the app is behind the same middleware as everything else, so an
        // anonymous visitor is handed the sign-in form and not the app shell
        await expect(page).toHaveURL(`${MAIN.baseURL}/login?from=${encodeURIComponent(target)}`);
        await shot(page, 'login-redirected');

        await submitCredentials(page);
        await expect(page).toHaveURL(MAIN.url.doc(docs.doc.path));
        await expect(page.getByTestId('doc').locator('h1').first()).toContainText(docs.doc.title);
    });

    test('signing out returns to the login screen, which refuses a wrong password', async ({page}) => {
        await signIn(page);

        await page.getByTestId('topbar-account').click();
        await expect(page.getByTestId('topbar-account-user')).toHaveText(user);
        await shot(page, 'login-user-menu');
        await page.getByTestId('topbar-account-signout').click();

        // signing out is a full page load to the server's form, the one login
        // screen there is: it answers at the root and works without javascript
        await expect(page).toHaveURL(new RegExp(`^${MAIN.baseURL}/login\\?from=`));
        await expect(page.locator('form.login-card')).toBeVisible();

        await submitCredentials(page, {secret: 'not-the-password'});
        await expect(page.locator('.login-error')).toContainText(text.login.wrong);
        await shot(page, 'login-wrong-password');

        await submitCredentials(page);
        await expect(page).toHaveURL(atHome());
        await expect(page.getByTestId('doc')).toBeVisible();
    });
});
