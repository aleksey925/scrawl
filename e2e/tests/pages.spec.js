const {expect, test} = require('../support/test');

const docs = require('../support/docs');
const {
    MAIN, chooseTheme, holdRoute, mockMe, openSpaceMenu, readFixture, recordPrompts, removeFixture, rgb, routes, save, setSource,
    shot, signIn, stays, writeFixture,
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

    test('the pages of a note and of the editor load while the browser is idle', async ({page}) => {
        // arrange
        const documentPage = page.waitForRequest((request) => request.url().endsWith('/assets/DocumentPage.js'));
        const editPage = page.waitForRequest((request) => request.url().endsWith('/assets/EditPage.js'));

        // act
        await page.goto(routes.home());

        // assert
        await expect(page.getByTestId('tree-row').first()).toBeVisible();
        await Promise.all([documentPage, editPage]);
        const afterLoad = () => page.evaluate(() => {
            const loaded = performance.getEntriesByType('navigation')[0].loadEventStart;
            return performance.getEntriesByType('resource')
                .filter((entry) => /\/assets\/(DocumentPage|EditPage)\.js$/.test(entry.name))
                .map((entry) => entry.startTime >= loaded);
        });
        await expect.poll(afterLoad).toEqual([true, true]);
    });

    test('a reader with no right to write loads the page of a note on idle and not the editor', async ({page}) => {
        // arrange
        await mockMe(page, {}, {read_only: true});
        const asked = [];
        page.on('request', (request) => {
            if (request.url().endsWith('/assets/EditPage.js')) {
                asked.push(request.url());
            }
        });
        const documentPage = page.waitForRequest((request) => request.url().endsWith('/assets/DocumentPage.js'));

        // act
        await page.goto(routes.home());

        // assert
        await documentPage;
        await stays(() => asked, [], 500);
    });

    test('a move between notes asks for the same tree with the tag of the one it has', async ({page}) => {
        // arrange
        const asked = [];
        page.on('response', async (response) => {
            const url = new URL(response.url());
            if (url.pathname.endsWith('/api/nav')) {
                const sent = await response.request().headerValue('if-none-match');
                asked.push({search: url.search, sent, tag: await response.headerValue('etag')});
            }
        });
        await page.goto(routes.doc(docs.doc.path));
        await expect(page.getByTestId('doc')).toBeVisible();
        await expect.poll(() => asked.length).toBe(1);

        // act
        await page.locator(`[data-testid=tree-row][data-path="${docs.folder.entry}"] [data-testid=tree-link]`).click();

        // assert
        const current = page.locator(`[data-testid=tree-row][data-path="${docs.folder.entry}"]`);
        await expect(current).toHaveAttribute('data-current', 'true');
        await expect.poll(() => asked.length).toBe(2);
        const [first, second] = asked;
        expect(second).toEqual({search: '', sent: first.tag, tag: first.tag});
        expect(first.search).toBe('');
    });

    test('a chunk that is gone reloads the page into the screen asked for', async ({page}) => {
        // arrange
        let asked = 0;
        let click = () => {};
        const clicked = new Promise((resolve) => {
            click = resolve;
        });
        let reach = () => {};
        const preloading = new Promise((resolve) => {
            reach = resolve;
        });
        await page.route('**/assets/EditPage.js', async (route) => {
            asked += 1;
            if (asked === 1) {
                reach();
                await clicked;
                await route.fulfill({status: 404, body: 'gone'});
                return;
            }
            await route.continue();
        });
        await page.goto(routes.doc(docs.doc.path));
        await expect(page.getByTestId('doc')).toBeVisible();
        await preloading;
        const reloaded = page.waitForEvent('load');

        // act
        await page.getByTestId('doc-edit').click();
        click();

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

    test('a chunk that is gone as the editor is left with a kept draft reloads into the reader and brings up no prompt', async ({page}) => {
        // arrange
        writeFixture(GUARDED, 'kept\n');
        try {
            let asked = 0;
            let click = () => {};
            const clicked = new Promise((resolve) => {
                click = resolve;
            });
            await page.route('**/assets/DocumentPage.js', async (route) => {
                asked += 1;
                if (asked === 1) {
                    await clicked;
                    await route.fulfill({status: 404, body: 'gone'});
                    return;
                }
                await route.continue();
            });
            await page.goto(routes.edit(GUARDED));
            await expect(page.getByTestId('editor-source')).toBeVisible();
            await setSource(page, 'typed but not saved\n');
            await expect(page.getByTestId('editor-status')).toHaveAttribute('data-dirty', 'true');
            const prompts = recordPrompts(page);
            const reloaded = page.waitForEvent('load');

            // act
            await page.getByTestId('editor-cancel').click();
            click();

            // assert
            await reloaded;
            await expect(page.getByTestId('doc')).toBeVisible();
            await expect(page).toHaveURL(MAIN.url.doc(GUARDED));
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

    test('a chunk a note asks for that is gone while a load on idle is on its way still reloads the note', async ({page}) => {
        // arrange
        writeFixture(MATH, '# Math\n\n$$\n\\frac{a}{b}\n$$\n');
        let release = () => {};
        const held = new Promise((resolve) => {
            release = resolve;
        });
        try {
            let preloads = 0;
            await page.route('**/assets/EditPage.js', async (route) => {
                preloads += 1;
                if (preloads === 1) {
                    await held;
                }
                await route.continue();
            });
            await page.goto(routes.doc(docs.doc.path));
            await expect.poll(() => preloads).toBe(1);
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
            await page.locator(`[data-testid=tree-row][data-path="${MATH}"]`).getByTestId('tree-link').click();

            // assert
            await expect.poll(() => asked).toBe(2);
            await expect(page.getByTestId('doc').locator('.katex')).toBeVisible();
            await expect(page).toHaveURL(MAIN.url.doc(MATH));
        } finally {
            release();
            removeFixture(MATH);
        }
    });

    test('a page\'s chunk that is gone while the browser is idle leaves the note on screen as it is', async ({page}) => {
        // arrange
        let asked = 0;
        await page.route('**/assets/EditPage.js', (route) => {
            asked += 1;
            return route.fulfill({status: 404, body: 'gone'});
        });
        let loads = 0;
        page.on('load', () => {
            loads += 1;
        });

        // act
        await page.goto(routes.doc(docs.doc.path));
        await expect.poll(() => asked).toBe(1);

        // assert
        await stays(() => loads, 1, 1000);
        await expect(page.getByTestId('doc')).toBeVisible();
    });

    test('a page\'s stylesheet that fails while the browser is idle loads the app again on the way to that page', async ({page}) => {
        // arrange
        let asked = 0;
        await page.route('**/assets/EditPage.css', async (route) => {
            asked += 1;
            if (asked === 1) {
                await route.fulfill({status: 404, body: 'gone'});
                return;
            }
            await route.continue();
        });
        let loads = 0;
        page.on('load', () => {
            loads += 1;
        });
        await page.goto(routes.doc(docs.doc.path));
        await expect.poll(() => asked).toBe(1);
        await stays(() => loads, 1, 500);

        // act
        await page.getByTestId('doc-edit').click();

        // assert
        await expect.poll(() => loads).toBe(2);
        await expect(page).toHaveURL(MAIN.url.edit(docs.doc.path));
        await expect(page.getByTestId('editor-source')).toBeVisible();
        await expect.poll(() => asked).toBe(2);
    });

    test('a dialog\'s chunk that is gone while the browser is idle leaves the page as it is, and opening the dialog loads the page again', async ({page}) => {
        // arrange
        let asked = 0;
        await page.route('**/assets/SearchDialog.js', async (route) => {
            asked += 1;
            if (asked === 1) {
                await route.fulfill({status: 404, body: 'gone'});
                return;
            }
            await route.continue();
        });
        let loads = 0;
        page.on('load', () => {
            loads += 1;
        });
        await page.goto(routes.doc(docs.doc.path));
        await expect.poll(() => asked).toBe(1);
        await stays(() => loads, 1, 1000);

        // act
        const reloaded = page.waitForEvent('load');
        await page.keyboard.press('ControlOrMeta+k');
        await reloaded;
        await expect.poll(() => asked).toBe(2);
        await page.keyboard.press('ControlOrMeta+k');

        // assert
        await expect(page.getByTestId('search-input')).toBeFocused();
        await expect(page).toHaveURL(MAIN.url.doc(docs.doc.path));
    });

    test('Move to whose chunk is gone under unsaved changes says so and keeps the text', async ({page}) => {
        // arrange
        writeFixture(GUARDED, 'kept\n');
        try {
            let asked = 0;
            await page.route('**/assets/MoveDialog.js', async (route) => {
                asked += 1;
                await route.fulfill({status: 404, body: 'gone'});
            });
            await page.goto(routes.edit(GUARDED));
            await expect.poll(() => asked).toBe(1);
            await expect(page.getByTestId('editor-source')).toBeVisible();
            await setSource(page, 'typed but not saved\n');
            await expect(page.getByTestId('editor-status')).toHaveAttribute('data-dirty', 'true');
            const rowMenu = page.locator(`[data-testid=tree-row][data-path="${GUARDED}"] [data-testid=tree-row-menu]`);
            await rowMenu.click();

            // act
            await page.getByTestId('tree-row-menu-move').click();

            // assert
            const failed = page.locator('[data-testid=toast][data-kind="error"]');
            await expect(failed).toContainText('Move to did not open');
            await expect(failed).toContainText('Its part of the app did not load. Load the page again to open it.');
            await expect(page.getByTestId('move-dialog')).toHaveCount(0);
            await expect(page.getByTestId('editor-status')).toHaveAttribute('data-dirty', 'true');
            await expect(page).toHaveURL(MAIN.url.edit(GUARDED));
        } finally {
            removeFixture(GUARDED);
        }
    });

    test('Move to whose stylesheet failed while the browser was idle says so under unsaved changes and opens no dialog', async ({page}) => {
        // arrange
        writeFixture(GUARDED, 'kept\n');
        try {
            let asked = 0;
            await page.route('**/assets/MoveDialog.css', async (route) => {
                asked += 1;
                await route.fulfill({status: 404, body: 'gone'});
            });
            await page.goto(routes.edit(GUARDED));
            await expect.poll(() => asked).toBe(1);
            await expect(page.getByTestId('editor-source')).toBeVisible();
            await setSource(page, 'typed but not saved\n');
            await expect(page.getByTestId('editor-status')).toHaveAttribute('data-dirty', 'true');
            await page.locator(`[data-testid=tree-row][data-path="${GUARDED}"] [data-testid=tree-row-menu]`).click();

            // act
            await page.getByTestId('tree-row-menu-move').click();

            // assert
            await expect(page.locator('[data-testid=toast][data-kind="error"]')).toContainText('Move to did not open');
            await expect(page.getByTestId('move-dialog')).toHaveCount(0);
            await expect(page.getByTestId('editor-status')).toHaveAttribute('data-dirty', 'true');
            await expect(page).toHaveURL(MAIN.url.edit(GUARDED));
        } finally {
            removeFixture(GUARDED);
        }
    });

    test('a page opened while its stylesheet loaded on idle is on its way, which then fails, loads the app again on the way to that page', async ({page}) => {
        // arrange
        let fail = () => {};
        const failing = new Promise((resolve) => {
            fail = resolve;
        });
        let asked = 0;
        await page.route('**/assets/EditPage.css', async (route) => {
            asked += 1;
            if (asked === 1) {
                await failing;
                await route.fulfill({status: 404, body: 'gone'});
                return;
            }
            await route.continue();
        });
        let loads = 0;
        page.on('load', () => {
            loads += 1;
        });
        await page.goto(routes.doc(docs.doc.path));
        await expect.poll(() => asked).toBe(1);
        await page.getByTestId('doc-edit').click();
        await stays(() => page.url(), MAIN.url.doc(docs.doc.path), 500);

        // act
        fail();

        // assert
        await expect.poll(() => loads).toBe(2);
        await expect(page).toHaveURL(MAIN.url.edit(docs.doc.path));
        await expect(page.getByTestId('editor-source')).toBeVisible();
        await expect.poll(() => asked).toBe(2);
    });

    test('a page whose stylesheet failed while the browser was idle, opened less than a minute after the app was loaded again, says it did not load', async ({page}) => {
        // arrange
        await page.addInitScript(() => {
            sessionStorage.setItem('scrawl-stale-bundle-reload', String(Date.now()));
        });
        let asked = 0;
        await page.route('**/assets/EditPage.css', (route) => {
            asked += 1;
            return route.fulfill({status: 404, body: 'gone'});
        });
        let loads = 0;
        page.on('load', () => {
            loads += 1;
        });
        await page.goto(routes.doc(docs.doc.path));
        await expect.poll(() => asked).toBe(1);

        // act
        await page.getByTestId('doc-edit').click();

        // assert
        await expect(page.getByTestId('app-error-message')).toHaveText('Its part of the app did not load. Load the page again to open it.');
        await expect(page.getByTestId('editor-source')).toHaveCount(0);
        expect(loads).toBe(1);
    });

    test('Move to opened while its stylesheet loaded on idle is on its way, which then fails, loads the page again', async ({page}) => {
        // arrange
        let fail = () => {};
        const failing = new Promise((resolve) => {
            fail = resolve;
        });
        let asked = 0;
        await page.route('**/assets/MoveDialog.css', async (route) => {
            asked += 1;
            if (asked === 1) {
                await failing;
                await route.fulfill({status: 404, body: 'gone'});
                return;
            }
            await route.continue();
        });
        await page.goto(routes.doc(docs.doc.path));
        await expect.poll(() => asked).toBe(1);
        const rowMenu = page.locator(`[data-testid=tree-row][data-path="${docs.doc.path}"] [data-testid=tree-row-menu]`);
        await rowMenu.click();
        await page.getByTestId('tree-row-menu-move').click();
        await stays(() => page.getByTestId('move-dialog').count(), 0, 500);
        const reloaded = page.waitForEvent('load');

        // act
        fail();

        // assert
        await reloaded;
        await expect.poll(() => asked).toBe(2);
        await rowMenu.click();
        await page.getByTestId('tree-row-menu-move').click();
        await expect(page.getByTestId('move-dialog')).toBeVisible();
    });

    test('a dialog\'s chunk that fails while the browser is idle and a page is on its way does not load the app again', async ({page}) => {
        // arrange
        let fail = () => {};
        const failing = new Promise((resolve) => {
            fail = resolve;
        });
        let asked = 0;
        await page.route('**/assets/SearchDialog.js', async (route) => {
            asked += 1;
            await failing;
            await route.fulfill({status: 404, body: 'gone'});
        });
        const chunk = await holdRoute(page, '**/assets/DocumentPage.js');
        let loads = 0;
        page.on('load', () => {
            loads += 1;
        });
        await page.goto(routes.recent());
        await chunk.reached;
        await expect.poll(() => asked).toBe(1);
        await page.locator('[data-testid=tree-row][data-path="guide.md"]').getByTestId('tree-link').click();

        // act
        fail();
        await stays(() => loads, 1, 1000);
        chunk.release();

        // assert
        await expect(page.getByTestId('doc')).toBeVisible();
        await expect(page).toHaveURL(MAIN.url.doc('guide.md'));
        expect(loads).toBe(1);
    });

    test('mantine\'s sizes follow the root font size, as in a browser set to a larger font', async ({page}) => {
        // arrange
        await page.goto(routes.doc(docs.doc.path));
        const button = page.getByTestId('sidebar-hide');
        await expect(button).toBeVisible();
        const height = async () => (await button.boundingBox()).height;
        const before = await height();

        // act
        await page.addStyleTag({content: 'html { font-size: 20px; }'});

        // assert
        await expect.poll(async () => Math.round(await height())).toBe(Math.round(before * 1.25));
    });

    test('the page is empty while the first page loads', async ({page}) => {
        // arrange
        const chunk = await holdRoute(page, '**/assets/DocumentPage.js');

        // act
        await page.goto(routes.doc(docs.doc.path), {waitUntil: 'commit'});
        await chunk.reached;

        // assert
        await expect(page.locator('#scrawl-app-root > :not(style)')).toHaveCount(0);

        // act
        chunk.release();

        // assert
        await expect(page.getByTestId('doc')).toBeVisible();
    });

    test('the icons of a folder\'s table head draw in their fill and bold weights', async ({page}) => {
        // act
        await page.goto(routes.dir(docs.folder.path));

        // assert
        const icons = page.getByTestId('dir-table').locator('th svg');
        await expect(icons).toHaveCount(3);
        expect(await icons.evaluateAll((drawn) => drawn.map((icon) => icon.childElementCount > 0))).toEqual([true, true, true]);
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

    test('a toast stands at the foot of the window in the middle, with no close button', async ({page}) => {
        // arrange
        await page.goto(routes.dir(docs.folder.path));

        // act
        await page.locator(`[data-testid=tree-row][data-path="${docs.folder.path}"] [data-testid=tree-row-menu]`).click();
        await page.getByTestId('tree-row-menu-copy-link').click();

        // assert
        const toast = page.getByTestId('toast-box');
        await expect.poll(async () => {
            const box = await toast.boundingBox();
            const view = page.viewportSize();
            const gap = view.height - box.y - box.height;
            return {centered: Math.abs(box.x + box.width / 2 - view.width / 2) < 2, atFoot: gap > 0 && gap < 60};
        }).toEqual({centered: true, atFoot: true});
        await expect(page.locator('.mantine-Notification-closeButton')).toHaveCount(0);
    });

    test.describe('a toast on a desktop', () => {
        const TOAST_NOTE = 'e2e-pages-toast.md';
        const toasts = (page) => () => page.getByTestId('toast').count();

        test.afterEach(() => {
            removeFixture(TOAST_NOTE);
        });

        async function copied(page) {
            await page.goto(routes.dir(docs.folder.path));
            await page.locator(`[data-testid=tree-row][data-path="${docs.folder.path}"] [data-testid=tree-row-menu]`).click();
            await page.getByTestId('tree-row-menu-copy-link').click();
            await expect(page.getByTestId('toast-box')).toBeVisible();
            await page.mouse.move(0, 0);
        }

        async function deleted(page) {
            writeFixture(TOAST_NOTE, '# Toast\n');
            await page.goto(routes.home());
            await page.locator(`[data-testid=tree-row][data-path="${TOAST_NOTE}"] [data-testid=tree-row-menu]`).click();
            await page.getByTestId('tree-row-menu-delete').click();
            await expect(page.getByTestId('toast-action')).toBeVisible();
            await page.mouse.move(0, 0);
        }

        test('goes after 4 seconds', async ({page}) => {
            // act
            await copied(page);

            // assert
            await stays(toasts(page), 1, 3000);
            await expect(page.getByTestId('toast')).toHaveCount(0, {timeout: 2500});
        });

        test('with Undo stays 6 seconds', async ({page}) => {
            // act
            await deleted(page);

            // assert
            await stays(toasts(page), 1, 5000);
            await expect(page.getByTestId('toast')).toHaveCount(0, {timeout: 2500});
        });

        test('stays while the pointer is on it', async ({page}) => {
            // arrange
            await copied(page);

            // act
            await page.getByTestId('toast-box').hover();

            // assert
            await stays(toasts(page), 1, 5000);
            await page.mouse.move(0, 0);
            await expect(page.getByTestId('toast')).toHaveCount(0, {timeout: 5000});
        });

        test('goes at a click on it outside its buttons', async ({page}) => {
            // arrange
            await deleted(page);

            // act
            await page.getByTestId('toast-box').click({position: {x: 20, y: 10}});

            // assert
            await expect(page.getByTestId('toast')).toHaveCount(0, {timeout: 1500});
            expect(() => readFixture(TOAST_NOTE)).toThrow();
        });
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
        const title = page.getByTestId('doc').locator('h1');
        await expect(title).toBeVisible();
        const shown = await title.textContent();

        const slow = /\/api\/(page|dir|nav)\b/;
        const {release} = await holdRoute(page, slow);
        await page.locator(`[data-testid=tree-row][data-path="${docs.linked.path}"] [data-testid=tree-link]`).click();

        await expect(page.locator('[data-testid=tree-row][data-current="true"]'))
            .toHaveAttribute('data-path', docs.linked.path);
        await expect(page.getByTestId('tree-row').first()).toBeVisible();
        await expect(title).toHaveText(shown);
        await expect(page.getByTestId('doc-loading')).toHaveCount(0);
        await expect(page.getByTestId('dir-loading')).toHaveCount(0);
        await expect(page.getByTestId('sidebar-loading')).toHaveCount(0);
        await shot(page, 'pages-slow-navigation');

        release();
        await expect(title).toHaveText(docs.linked.title);
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

        test('fills a row a name is typed into in a folder\'s list with the hover tint', async ({page}) => {
            // arrange
            await page.goto(routes.dir(docs.folder.path));

            // act
            await page.getByTestId('dir-new-more').click();
            await page.getByTestId('dir-new-folder').click();

            // assert
            await expect(page.getByTestId('dir-draft').locator('td').first()).toHaveCSS('background-color', rgb(theme.palette.hover));
        });

        test('draws the status tip dark with its own tokens', async ({page}) => {
            // arrange
            await mockMe(page, {kind: 'remote', read_only: false, unsynced: {paths: [TOKENS], many: false}});
            await page.goto(routes.doc(TOKENS));

            // act
            await page.getByTestId('sync-control').click();

            // assert
            const tip = page.getByTestId('sync-popover');
            await expect(tip).toHaveCSS('background-color', rgb(theme.palette.tooltip));
            await expect(tip).toHaveCSS('color', rgb(theme.palette.tooltipText));
            await expect(tip.locator('[data-testid=status-tip] > div').last()).toHaveCSS(
                'color', rgb(theme.palette.tooltipTextSecondary),
            );
        });
    });
}
