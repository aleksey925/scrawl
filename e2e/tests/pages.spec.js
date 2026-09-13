const {expect, test} = require('@playwright/test');

const docs = require('../support/docs');
const {readFixture, removeFixture, shot, signIn, writeFixture} = require('../support/helpers');

const MISSING = docs.missing;
const COLLIDE = 'e2e-collisions.md';

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

    test('a note cannot take the ids the app looks itself up by', async ({page}) => {
        // each heading slugs to the id of an element the app resolves, and the
        // document is rendered before that chrome, so a document-wide lookup
        // comes back holding the heading
        writeFixture(COLLIDE, [
            '# Collisions', '', '## Toasts', '', '## Lightbox', '',
            '## Palette input', '', '## Toc rail', '',
            'Enough headings to earn an outline.', '',
        ].join('\n'));

        const problems = [];
        page.on('pageerror', (err) => problems.push(err.message));
        page.on('console', (msg) => {
            if (msg.type() === 'error') problems.push(msg.text());
        });

        await page.goto(`/p/${COLLIDE}`);
        await page.waitForLoadState('networkidle');
        expect(problems, 'a shadowed id threw and took its feature down').toEqual([]);
        // the headings really did claim the ids, so the lookups only survived
        // by asking about shape instead
        expect(await page.locator('#doc h2#toasts').count()).toBe(1);
        expect(await page.locator('#doc h2#toc-rail').count()).toBe(1);

        await expect(page.locator('.app-body > #toc-rail')).toBeVisible();

        // the heading anchor copies the link and says so, which is the toast
        // that used to be appended invisibly inside the heading named Toasts
        await page.locator('#doc h2#toasts .anchor').click();
        await expect(page.locator('body > #toasts .toast')).toBeVisible();
        await shot(page, 'pages-id-collisions');

        removeFixture(COLLIDE);
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
