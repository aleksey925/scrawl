const {expect, test} = require('../support/test');

const docs = require('../support/docs');
const {
    MAIN, atHome, openSpaceMenu, rgb, routes, shot, signIn, submitCredentials, user,
} = require('../support/helpers');
const text = require('../support/text');
const darkTheme = require('../../theme/themes/dark.json');
const lightTheme = require('../../theme/themes/light.json');

test.describe('login', () => {
    test('accepts the right password and lands on the notes home', async ({page}) => {
        await signIn(page);

        await expect(page).toHaveURL(MAIN.url.home());
        await expect(page.locator('[data-testid=dir-row][data-path="index.md"]')).toBeVisible();
        await expect(page.getByTestId('tree-row').first()).toBeVisible();
        await shot(page, 'login-home');
    });

    test('keeps the session across a reload', async ({page}) => {
        await signIn(page);
        await page.reload();

        await expect(page).toHaveURL(MAIN.url.home());
        await expect(page.getByTestId('dir')).toBeVisible();
        await expect(page.getByTestId('sidebar')).toBeVisible();
    });

    test('a protected url while signed out comes back after signing in', async ({page}) => {
        const target = routes.doc(docs.doc.path);
        await page.goto(target);

        await expect(page).toHaveURL(`${MAIN.baseURL}/login?from=${encodeURIComponent(target)}`);
        await shot(page, 'login-redirected');

        await submitCredentials(page);
        await expect(page).toHaveURL(MAIN.url.doc(docs.doc.path));
        await expect(page.getByTestId('doc').locator('h1').first()).toContainText(docs.doc.title);
    });

    test('signing out returns to the login screen, which refuses a wrong password', async ({page}) => {
        await signIn(page);

        await openSpaceMenu(page);
        await expect(page.getByTestId('space-menu-user')).toHaveText(user);
        await shot(page, 'login-user-menu');
        await page.getByTestId('space-menu-signout').click();

        await expect(page).toHaveURL(new RegExp(`^${MAIN.baseURL}/login\\?from=`));
        await expect(page.locator('form.login-box')).toBeVisible();

        await submitCredentials(page, {secret: 'not-the-password'});
        await expect(page.locator('.login-error')).toContainText(text.login.wrong);
        await shot(page, 'login-wrong-password');

        await submitCredentials(page);
        await expect(page).toHaveURL(atHome());
        await expect(page.getByTestId('dir')).toBeVisible();
    });

    test('the theme toggle walks the themes and paints the page in each', async ({page}) => {
        // arrange
        await page.emulateMedia({colorScheme: 'light'});
        await page.goto(`${MAIN.baseURL}/login`);
        const root = page.locator('html');
        const toggle = page.locator('[data-theme-toggle]');
        const ground = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
        const light = await ground();

        // act
        await toggle.click();
        await toggle.click();

        // assert
        await expect(root).toHaveAttribute('data-scrawl-theme', 'dark');
        await expect(toggle).toHaveAttribute('aria-label', `Theme: ${darkTheme.name}`);
        await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', darkTheme.palette.bg);
        await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', /apple-touch-icon-dark\.png/);
        expect(await ground()).not.toBe(light);
        await shot(page, 'login-dark-theme');

        await toggle.click();
        await expect(root).not.toHaveAttribute('data-scrawl-theme');
        expect(await ground()).toBe(light);
    });
    test('the logo is drawn in the text color of the theme', async ({page}) => {
        // arrange
        await page.emulateMedia({colorScheme: 'light'});

        // act
        await page.goto(`${MAIN.baseURL}/login`);

        // assert
        const logo = page.locator('svg.login-logo');
        await expect(logo).toBeVisible();
        await expect(logo).toHaveCSS('color', rgb(lightTheme.palette.text));
        await shot(page, 'login-page');
    });

    for (const theme of [lightTheme, darkTheme]) {
        test(`a field in focus is drawn with the focus ring of the theme, ${theme.scheme}`, async ({page}) => {
            // arrange
            await page.emulateMedia({colorScheme: theme.scheme});
            await page.goto(`${MAIN.baseURL}/login`);
            const field = page.locator('#login-password');

            // act
            await field.focus();

            // assert
            const [inner, outer] = [rgb(theme.palette.focusRing), rgb(theme.palette.focusRingOuter)];
            await expect(field).toHaveCSS('box-shadow', `${inner} 0px 0px 0px 1px inset, ${outer} 0px 0px 0px 1px`);
            await shot(page, `login-field-focus-${theme.scheme}`);
        });
    }

    test('the form signs in without javascript', async ({browser}) => {
        // arrange
        const context = await browser.newContext({javaScriptEnabled: false});
        const page = await context.newPage();

        // act
        await page.goto(`${MAIN.baseURL}/login?from=${encodeURIComponent(routes.home())}`);
        await submitCredentials(page);

        // assert
        await expect(page).toHaveURL(atHome());
        await context.close();
    });
});
