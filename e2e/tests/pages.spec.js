const {expect, test} = require('../support/test');

const docs = require('../support/docs');
const {
    MAIN, chooseTheme, openSpaceMenu, readFixture, removeFixture, rgb, routes, save, setSource, shot, signIn,
    stays, writeFixture,
} = require('../support/helpers');
const text = require('../support/text');
const darkTheme = require('../../theme/themes/dark.json');
const lightTheme = require('../../theme/themes/light.json');

const MISSING = docs.missing;
const COLLIDE = 'e2e-collisions.md';
const MATH = 'e2e-pages-math.md';
const GUARDED = 'e2e-pages-guarded.md';
const TOKENS = 'e2e-pages-tokens.md';

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
            const response = await page.goto(route);
            expect(response.status(), route).toBe(200);
            await page.waitForLoadState('networkidle');
        }
        expect(problems).toEqual([]);
    });

    test('every screen answers a url typed in from outside the app', async ({page}) => {
        const screens = [
            [routes.doc(docs.doc.path), 'doc'],
            [routes.dir(docs.folder.path), 'dir'],
            [routes.edit(docs.doc.path), 'editor-source'],
            [routes.history(docs.doc.path), 'history-list'],
        ];

        for (const [url, marker] of screens) {
            await page.goto(url);
            await expect(page.getByTestId(marker), url).toBeVisible();
            await expect(page.getByTestId('tree-row').first(), url).toBeVisible();
        }
    });

    test('a chunk that is gone reloads the page into the screen asked for', async ({page}) => {
        // arrange
        await page.goto(routes.doc(docs.doc.path));
        await expect(page.getByTestId('doc')).toBeVisible();
        let asked = 0;
        await page.route('**/assets/EditPage.js', async (route) => {
            asked += 1;
            if (asked === 1) {
                await route.fulfill({status: 404, body: 'gone'});
                return;
            }
            await route.continue();
        });
        const reloaded = page.waitForEvent('load');

        // act
        await page.getByTestId('doc-edit').click();

        // assert
        await reloaded;
        await expect(page.getByTestId('editor-source')).toBeVisible();
        expect(asked).toBe(2);
    });

    test('a chunk that is gone again within a minute shows its error and no second reload', async ({page}) => {
        // arrange
        await page.route('**/assets/EditPage.js', (route) => route.fulfill({status: 404, body: 'gone'}));
        await page.goto(routes.doc(docs.doc.path));
        await expect(page.getByTestId('doc')).toBeVisible();
        let loads = 0;
        page.on('load', () => {
            loads += 1;
        });

        // act
        await page.getByTestId('doc-edit').click();

        // assert
        await expect(page.getByTestId('app-error-message')).toBeVisible();
        await expect(page).toHaveURL(MAIN.url.edit(docs.doc.path));
        await stays(() => loads, 1, 500);
    });

    test('a chunk that is gone under unsaved changes shows its error and brings up no leave prompt', async ({page}) => {
        // arrange
        writeFixture(GUARDED, 'kept\n');
        try {
            await page.route('**/assets/DocumentPage.js', (route) => route.fulfill({status: 404, body: 'gone'}));
            await page.goto(routes.edit(GUARDED));
            await expect(page.getByTestId('editor-source')).toBeVisible();
            await setSource(page, 'typed but not saved\n');
            await expect(page.getByTestId('editor-status')).toHaveAttribute('data-dirty', 'true');
            const prompts = [];
            page.on('dialog', (dialog) => {
                prompts.push(dialog.type());
                void dialog.dismiss();
            });

            // act
            await page.getByTestId('editor-cancel').click();
            await page.getByTestId('modal-confirm').click();

            // assert
            await expect(page.getByTestId('app-error-message')).toBeVisible();
            expect(prompts).toEqual([]);
        } finally {
            removeFixture(GUARDED);
        }
    });

    test('a chunk a note asks for that is gone reloads the note', async ({page}) => {
        // arrange
        writeFixture(MATH, '# Math\n\n$$\n\\frac{a}{b}\n$$\n');
        try {
            let asked = 0;
            await page.route('**/assets/katex.js', async (route) => {
                asked += 1;
                if (asked === 1) {
                    await route.fulfill({status: 404, body: 'gone'});
                    return;
                }
                await route.continue();
            });

            // act
            await page.goto(routes.doc(MATH));

            // assert
            await expect.poll(() => asked).toBe(2);
            await expect(page.getByTestId('doc').locator('.katex')).toBeVisible();
            await expect(page).toHaveURL(MAIN.url.doc(MATH));
        } finally {
            removeFixture(MATH);
        }
    });

    test('a folder\'s table keeps its columns, and on a narrow page the name gives way', async ({page}) => {
        // arrange
        await page.goto(routes.dir(docs.folder.path));
        const head = page.getByTestId('dir-table').locator('th');
        await expect(head).toHaveCount(4);
        const widths = () => head.evaluateAll((cells) => cells.map((th) => Math.round(th.getBoundingClientRect().width)));
        const [nameWidth, otherWidth] = await page.getByTestId('dir-table').evaluate((el) => {
            const style = getComputedStyle(el);
            return ['--col-name', '--col-other'].map((prop) => parseFloat(style.getPropertyValue(prop)));
        });
        const table = await page.getByTestId('dir-table').boundingBox();

        // act & assert
        const [name, size, date, rest] = await widths();
        expect([name, size, date]).toEqual([nameWidth, otherWidth, otherWidth]);
        expect(Math.abs(rest - (table.width - nameWidth - 2 * otherWidth))).toBeLessThanOrEqual(1);
        const sizeCell = page.locator('[data-testid=dir-row][data-dir=false] td').nth(1);
        await expect(sizeCell).toHaveCSS('text-align', 'start');

        await page.setViewportSize({width: 900, height: 900});
        await expect.poll(async () => (await widths())[0]).toBeLessThan(nameWidth);
        expect((await widths()).slice(1, 3)).toEqual([otherWidth, otherWidth]);
    });

    test('the space button stands at the foot of the sidebar and its menu opens upward', async ({page}) => {
        // arrange
        await page.goto(routes.home());
        const button = page.getByTestId('space-menu');
        const sidebar = await page.getByTestId('sidebar').boundingBox();
        const box = await button.boundingBox();

        // act
        await button.click();

        // assert
        expect(sidebar.y + sidebar.height - (box.y + box.height)).toBeLessThan(16);
        const menu = await page.getByTestId('space-menu-dropdown').boundingBox();
        expect(menu.y + menu.height).toBeLessThanOrEqual(box.y);
    });

    test('the Search row of the sidebar shows its key', async ({page}) => {
        // act
        await page.goto(routes.home());

        // assert
        await expect(page.getByTestId('sidebar-search-keys')).toHaveText(/K$/);
    });

    test('a directory without an index lists its entries', async ({page}) => {
        await page.goto(routes.dir(docs.folder.path));

        await expect(page.getByTestId('dir-table')).toBeVisible();
        const rows = page.getByTestId('dir-row');
        expect(await rows.count()).toBeGreaterThan(3);
        await expect(rows.first().getByTestId('dir-row-name')).toHaveAttribute('href', new RegExp(`^${routes.prefix()}/doc/`));
        await shot(page, 'pages-directory');

        await page.locator(`[data-testid=dir-row][data-path="${docs.folder.entry}"] [data-testid=dir-row-name]`)
            .click();
        await expect(page).toHaveURL(MAIN.url.doc(docs.folder.entry));
    });

    test('a slow page keeps the one on screen instead of blanking', async ({page}) => {
        await page.goto(routes.doc(docs.doc.path));
        await expect(page.getByTestId('doc-title').or(page.locator('h1')).first()).toBeVisible();

        const slow = /\/api\/(page|dir|nav)\b/;
        await page.route(slow, async (route) => {
            await new Promise((resolve) => setTimeout(resolve, 1_500));
            await route.continue().catch(() => {
            });
        });
        const other = page.locator('[data-testid=tree-row][data-current="false"][data-dir="false"]').first();
        const target = await other.getAttribute('data-path');
        await other.getByTestId('tree-link').click();

        await expect(page.locator('[data-testid=tree-row][data-current="true"]'))
            .toHaveAttribute('data-path', target);
        await expect(page.getByTestId('tree-row').first()).toBeVisible();
        await expect(page.getByTestId('doc-loading')).toHaveCount(0);
        await expect(page.getByTestId('dir-loading')).toHaveCount(0);
        await expect(page.getByTestId('sidebar-loading')).toHaveCount(0);
        await shot(page, 'pages-slow-navigation');

        await page.unroute(slow);
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

        await expect(page.locator('[data-testid=doc] h2#toasts')).toHaveCount(1);
        await expect(page.locator('[data-testid=doc] h2#toc')).toHaveCount(1);
        await expect(page.locator('[data-testid=doc] h2#doc')).toHaveCount(1);
        await expect(page.locator('[data-testid=doc] h2#editor-source')).toHaveCount(1);

        await expect(page.getByTestId('doc')).toHaveCount(1);
        await expect(page.getByTestId('doc')).toHaveClass(/markdown-document/);
        await expect(page.getByTestId('toc')).toHaveCount(1);
        await expect(page.getByTestId('toc-entry')).toHaveCount(6);

        await page.locator('[data-testid=doc] h2#toasts [data-testid=doc-heading-anchor]').click();
        const toast = page.locator('[data-testid=toast][data-kind="ok"]');
        await expect(toast).toContainText(text.toast.linkCopied);
        expect(await toast.evaluate((el) => el.closest('[data-testid="doc"]') === null),
            'the toast landed inside the document').toBe(true);
        await shot(page, 'pages-id-collisions');

        removeFixture(COLLIDE);
    });

    test('the theme picker switches the theme and survives a reload', async ({page}) => {
        const root = page.locator('html');
        await openSpaceMenu(page);
        await expect(page.getByTestId('space-menu-theme')).toHaveAttribute('data-theme', 'auto');
        await expect(root).not.toHaveAttribute('data-scrawl-theme');

        await chooseTheme(page, 'dark');
        await expect(root).toHaveAttribute('data-scrawl-theme', 'dark');
        await expect(root).toHaveAttribute('data-mantine-color-scheme', 'dark');
        await expect(page.getByTestId('space-menu-dropdown')).toBeVisible();
        await expect(page.locator('body')).toHaveCSS('color', rgb(darkTheme.palette.text));
        await shot(page, 'pages-dark-theme');

        await chooseTheme(page, 'light');
        await expect(root).toHaveAttribute('data-scrawl-theme', 'light');
        await expect(root).toHaveAttribute('data-mantine-color-scheme', 'light');
        await expect(page.locator('body')).toHaveCSS('color', rgb(lightTheme.palette.text));

        await chooseTheme(page, 'dark');

        await page.reload();
        await expect(root).toHaveAttribute('data-scrawl-theme', 'dark');
        await expect(root).toHaveAttribute('data-mantine-color-scheme', 'dark');
        await openSpaceMenu(page);
        await expect(page.getByTestId('space-menu-theme')).toHaveAttribute('data-theme', 'dark');

        await chooseTheme(page, 'auto');
        await expect(root).not.toHaveAttribute('data-scrawl-theme');
    });

    test('the picked theme slides into place like every other choice', async ({page}) => {
        // arrange
        await openSpaceMenu(page);
        const picker = page.getByTestId('space-menu-theme');
        await expect(picker.locator('.mantine-SegmentedControl-indicator')).toHaveAttribute('data-initialized');

        // act
        const moving = await picker.evaluate(async (root) => {
            const dark = [...root.querySelectorAll('label')].find((label) => label.textContent === 'Dark');
            dark.click();
            await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
            const indicator = root.querySelector('.mantine-SegmentedControl-indicator');
            return indicator.getAnimations().map((motion) => motion.transitionProperty);
        });

        // assert
        expect(moving).toContain('transform');
        await expect(picker).toHaveAttribute('data-theme', 'dark');
    });
});

for (const [scheme, theme] of [['light', lightTheme], ['dark', darkTheme]]) {
    test.describe(`the ${scheme} theme`, () => {
        test.use({colorScheme: scheme});

        test.beforeEach(async ({page}) => {
            await signIn(page);
            writeFixture(TOKENS, `# Tokens\n\nA [link](${docs.doc.path}) in the text.\n`);
        });

        test.afterEach(() => {
            removeFixture(TOKENS);
        });

        test('paints a link, the current row, Home and the letters with its own tokens', async ({page}) => {
            // act
            await page.goto(routes.doc(TOKENS));

            // assert
            const link = page.getByTestId('doc').locator('p a');
            const linkColor = theme.palette.link === 'currentColor'
                ? await link.evaluate((el) => getComputedStyle(el.parentElement).color)
                : rgb(theme.palette.link);
            await expect(link).toHaveCSS('color', linkColor);
            const current = page.locator(`[data-testid=tree-row][data-path="${TOKENS}"]`);
            await expect(current).toHaveAttribute('data-current', 'true');
            await expect(current).toHaveCSS('font-weight', theme.currentWeight);
            await expect(page.getByTestId('sidebar-home')).toHaveCSS('background-color', rgb(theme.palette.selected));
            await expect(page.locator('body')).toHaveCSS('-webkit-font-smoothing', theme.fontSmoothing);
        });

        test('fills the menu row under the pointer', async ({page}) => {
            // arrange
            await page.goto(routes.doc(TOKENS));
            await page.getByTestId('note-menu').click();
            const row = page.getByTestId('note-menu-copy-link');

            // act
            await row.hover();

            // assert
            await expect(row).toHaveCSS('background-color', rgb(theme.palette.menuHighlight));
            await expect(row).toHaveCSS('color', rgb(theme.palette.menuHighlightText));
        });
    });
}
