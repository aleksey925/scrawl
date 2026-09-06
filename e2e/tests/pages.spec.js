const {expect, test} = require('@playwright/test');

const docs = require('../support/docs');
const {readFixture, removeFixture, shot, signIn} = require('../support/helpers');

const MISSING = docs.missing;

const ROUTES = [
    '/',
    `/p/${docs.doc.path}`,
    `/p/${docs.folder.path}/`,
    `/p/${docs.folder.entry}`,
    `/search?q=${encodeURIComponent(docs.search.word)}`,
    `/edit/${docs.doc.path}`,
];

test.describe('pages', () => {
    test.beforeEach(async ({page}) => {
        await signIn(page);
    });

    test('every main route loads without a console error', async ({page}) => {
        const problems = [];
        page.on('pageerror', (err) => problems.push(`${page.url()}: ${err.message}`));
        page.on('console', (msg) => {
            if (msg.type() === 'error') problems.push(`${page.url()}: ${msg.text()}`);
        });

        for (const route of ROUTES) {
            const response = await page.goto(route);
            expect(response.status(), route).toBe(200);
            await page.waitForLoadState('networkidle');
        }
        expect(problems).toEqual([]);
    });

    test('a directory without an index lists its entries', async ({page}) => {
        await page.goto(`/p/${docs.folder.path}/`);

        await expect(page.locator('.dir-list-title')).toContainText('items');
        const entries = page.locator('.entries .entry');
        expect(await entries.count()).toBeGreaterThan(3);
        await expect(entries.first().locator('.entry-size')).toContainText(/KB|B/);
        await shot(page, 'pages-directory');
    });

    test('the folder being viewed is the highlighted row in the tree', async ({page}) => {
        await page.goto(`/p/${docs.folder.path}/`);

        const current = page.locator('#sidebar .tree-row.is-current');
        await expect(current).toHaveCount(1);
        await expect(current).toHaveJSProperty('tagName', 'SUMMARY');
        await expect(current.locator('.tree-name')).toHaveText(docs.folder.name);
        await expect(current.locator('.tree-link')).toHaveAttribute('aria-current', 'page');
    });

    test('a missing page answers 404 and offers to create it', async ({page}) => {
        const response = await page.goto(`/p/${MISSING}`);

        expect(response.status()).toBe(404);
        await expect(page.locator('.empty-title')).toContainText('does not exist yet');
        await shot(page, 'pages-missing');

        await page.locator('.empty-actions a.btn-primary').click();
        await expect(page).toHaveURL(new RegExp(`/edit/${MISSING}$`));
        await expect(page.locator('#editor-source')).toHaveValue('');
        await expect(page.locator('#status-state')).toHaveText('New page');

        await page.locator('#editor-source').fill('# Новая\n');
        await page.click('[data-editor-save]');
        await expect(page.locator('#status-state')).toHaveText('Saved');
        expect(readFixture(MISSING)).toBe('# Новая\n');

        await page.goto(`/p/${MISSING}`);
        await expect(page.locator('#doc h1').first()).toContainText('Новая');
        removeFixture(MISSING);
    });

    test('the theme toggle cycles and survives a reload', async ({page}) => {
        const root = page.locator('html');
        await expect(root).toHaveAttribute('data-theme', 'auto');

        await page.locator('[data-theme-toggle]').first().click();
        await expect(root).toHaveAttribute('data-theme', 'light');
        await page.locator('[data-theme-toggle]').first().click();
        await expect(root).toHaveAttribute('data-theme', 'dark');
        await shot(page, 'pages-dark-theme');

        await page.reload();
        await expect(root).toHaveAttribute('data-theme', 'dark');
    });
});
