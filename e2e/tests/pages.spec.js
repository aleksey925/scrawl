const {expect, test} = require('@playwright/test');

const docs = require('../support/docs');
const {
    MAIN, readFixture, removeFixture, routes, save, setSource, shot, signIn, writeFixture,
} = require('../support/helpers');
const text = require('../support/text');

const MISSING = docs.missing;
const COLLIDE = 'e2e-collisions.md';

const ROUTES = [
    routes.home(),
    routes.doc(docs.doc.path),
    routes.dir(docs.folder.path),
    routes.doc(docs.folder.entry),
    routes.search(docs.search.word),
    routes.edit(docs.doc.path),
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
            // every app route is the same document, and which screen it is comes
            // from the client router, so the status is 200 even for a page that
            // is not there
            const response = await page.goto(route);
            expect(response.status(), route).toBe(200);
            await page.waitForLoadState('networkidle');
        }
        expect(problems).toEqual([]);
    });

    // a direct load and not a click: the page segment is spelled out in the
    // route table, in the path builders and in the pathname reader, and one of
    // the three left behind boots the shell, renders the client 404 and asks
    // for the root tree - which looks like a routing bug and not a stale word.
    // Only an address typed in from outside the app catches it.
    test('every screen answers a url typed in from outside the app', async ({page}) => {
        const screens = [
            [routes.doc(docs.doc.path), 'doc'],
            [routes.dir(docs.folder.path), 'dir'],
            [routes.edit(docs.doc.path), 'editor-source'],
            [routes.history(docs.doc.path), 'history'],
        ];

        for (const [url, marker] of screens) {
            await page.goto(url);
            await expect(page.getByTestId(marker), url).toBeVisible();
            // the tree asked about this very document, not about the root
            await expect(page.getByTestId('tree-row').first(), url).toBeVisible();
        }
    });

    test('a directory without an index lists its entries', async ({page}) => {
        await page.goto(routes.dir(docs.folder.path));

        await expect(page.getByTestId('dir-title')).toBeVisible();
        const rows = page.getByTestId('dir-row');
        expect(await rows.count()).toBeGreaterThan(3);
        await expect(rows.first().getByTestId('dir-row-name')).toHaveAttribute('href', new RegExp(`^${routes.prefix()}/doc/`));
        await shot(page, 'pages-directory');

        await page.locator(`[data-testid=dir-row][data-path="${docs.folder.entry}"] [data-testid=dir-row-name]`)
            .click();
        await expect(page).toHaveURL(MAIN.url.doc(docs.folder.entry));
    });

    test('the folder being viewed is the highlighted row in the tree', async ({page}) => {
        await page.goto(routes.dir(docs.folder.path));

        const current = page.locator('[data-testid=tree-row][data-current="true"]');
        await expect(current).toHaveCount(1);
        await expect(current).toHaveAttribute('data-path', docs.folder.path);
        await expect(current).toHaveAttribute('data-dir', 'true');
        await expect(current.getByTestId('tree-link')).toHaveAttribute('aria-current', 'page');
    });

    test('a missing page says so and offers to create it', async ({page}) => {
        await page.goto(routes.doc(MISSING));

        await expect(page.getByTestId('doc-missing')).toContainText(text.doc.missing);
        await shot(page, 'pages-missing');

        await page.getByTestId('doc-create').click();
        await expect(page).toHaveURL(MAIN.url.edit(MISSING));
        await expect(page.getByTestId('editor-status')).toHaveAttribute('data-state', 'new');
        await expect(page.getByTestId('editor-status')).toHaveText(text.status.new);

        await setSource(page, '# Новая\n');
        await save(page);
        expect(readFixture(MISSING)).toBe('# Новая\n');

        await page.goto(routes.doc(MISSING));
        await expect(page.getByTestId('doc').locator('h1').first()).toContainText('Новая');
        removeFixture(MISSING);
    });

    test('a route that names nothing at all is the empty state', async ({page}) => {
        await page.goto(`${routes.home()}this-route-does-not-exist`);

        await expect(page.getByTestId('app-notfound')).toContainText(text.notFound);
    });

    test('a note cannot take the ids the app looks itself up by', async ({page}) => {
        // each heading slugs to the name of a piece of chrome, and the document
        // is rendered before that chrome, so a document-wide lookup would come
        // back holding the heading instead
        writeFixture(COLLIDE, [
            '# Collisions', '', '## Toasts', '', '## Lightbox', '', '## Palette input', '',
            '## Toc', '', '## Doc', '', '## Editor source', '',
            'Enough headings to earn an outline.', '',
        ].join('\n'));

        const problems = [];
        page.on('pageerror', (err) => problems.push(err.message));
        page.on('console', (msg) => {
            if (msg.type() === 'error') problems.push(msg.text());
        });

        await page.goto(routes.doc(COLLIDE));
        await page.waitForLoadState('networkidle');
        expect(problems, 'a shadowed id threw and took its feature down').toEqual([]);

        // the headings really did claim the ids, so the chrome only survived by
        // being reached through refs and portals instead of by name
        await expect(page.locator('[data-testid=doc] h2#toasts')).toHaveCount(1);
        await expect(page.locator('[data-testid=doc] h2#toc')).toHaveCount(1);
        await expect(page.locator('[data-testid=doc] h2#doc')).toHaveCount(1);
        await expect(page.locator('[data-testid=doc] h2#editor-source')).toHaveCount(1);

        // the hooks still name one element each, and it is the chrome and not a heading
        await expect(page.getByTestId('doc')).toHaveCount(1);
        await expect(page.getByTestId('doc')).toHaveClass(/markdown-document/);
        await expect(page.getByTestId('toc')).toHaveCount(1);
        await expect(page.getByTestId('toc-entry')).toHaveCount(6);

        // the heading anchor copies the link and says so, which is the toast that
        // used to be appended invisibly inside the heading named Toasts
        await page.locator('[data-testid=doc] h2#toasts [data-testid=doc-heading-anchor]').click();
        const toast = page.locator('[data-testid=toast][data-kind="ok"]');
        await expect(toast).toContainText(text.toast.linkCopied);
        expect(await toast.evaluate((el) => el.closest('[data-testid="doc"]') === null),
            'the toast landed inside the document').toBe(true);
        await shot(page, 'pages-id-collisions');

        removeFixture(COLLIDE);
    });

    test('the theme toggle cycles and survives a reload', async ({page}) => {
        const root = page.locator('html');
        const toggle = page.getByTestId('topbar-theme');
        await expect(toggle).toHaveAttribute('data-scheme', 'auto');

        await toggle.click();
        await expect(toggle).toHaveAttribute('data-scheme', 'light');
        await expect(root).toHaveAttribute('data-mantine-color-scheme', 'light');

        await toggle.click();
        await expect(toggle).toHaveAttribute('data-scheme', 'dark');
        await expect(root).toHaveAttribute('data-mantine-color-scheme', 'dark');
        await shot(page, 'pages-dark-theme');

        // the choice is a cookie, because the server paints the first byte from it
        await page.reload();
        await expect(root).toHaveAttribute('data-mantine-color-scheme', 'dark');
        await expect(page.getByTestId('topbar-theme')).toHaveAttribute('data-scheme', 'dark');
    });
});
