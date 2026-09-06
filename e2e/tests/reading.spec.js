const {expect, test} = require('@playwright/test');

const docs = require('../support/docs');
const {MAIN, pressShortcut, shot, signIn} = require('../support/helpers');

const DOC = docs.doc;

test.describe('reading', () => {
    test.beforeEach(async ({page}) => {
        await signIn(page);
    });

    test('the root page renders the index document', async ({page}) => {
        await expect(page.locator('#doc h1').first()).toContainText(docs.home.title);
        await expect(page.locator(`#doc a[href="/p/${DOC.path}"]`)).toHaveCount(1);
        await shot(page, 'reading-root');
    });

    test('the disclosure triangle expands a folder without leaving the page', async ({page}) => {
        const folder = page.locator(`#sidebar details.tree-dir[data-path="${DOC.folder}"]`);
        await expect(folder).toHaveJSProperty('open', false);

        await folder.locator('summary .tree-twisty').click();
        await expect(folder).toHaveJSProperty('open', true);
        await expect(page).toHaveURL(`${MAIN.baseURL}/`);
        await shot(page, 'reading-tree-expanded');

        await folder.locator(`.tree-link[href="/p/${DOC.path}"]`).click();
        await expect(page).toHaveURL(`${MAIN.baseURL}/p/${DOC.path}`);
        await expect(page.locator('.tree-row.is-current')).toHaveAttribute('data-path', DOC.path);
    });

    test('a folder label opens the folder page and expands the row', async ({page}) => {
        await page.locator(
            `#sidebar details.tree-dir[data-path="${DOC.folder}"] > summary .tree-link`).click();

        await expect(page).toHaveURL(`${MAIN.baseURL}/p/${DOC.folder}/`);
        await expect(page.locator('.dir-list-title')).toContainText('items');
        await expect(page.locator(`#sidebar details.tree-dir[data-path="${DOC.folder}"]`))
            .toHaveJSProperty('open', true);
        await shot(page, 'reading-folder-page');
    });

    test('the sidebar filter narrows the tree and highlights the match', async ({page}) => {
        await pressShortcut(page, '/');
        const filter = page.locator('#tree-filter');
        await expect(filter).toBeFocused();

        await filter.fill(docs.filter.term);
        await expect(page.locator(`#sidebar .tree-row[data-path="${docs.filter.path}"] mark`))
            .toHaveText(docs.filter.term);
        const visible = () => page.evaluate(() => Array.from(
            document.querySelectorAll('#sidebar .tree-leaf'))
            .filter((row) => row.offsetParent !== null)
            .map((row) => row.dataset.path));
        await expect.poll(visible).toEqual([docs.filter.path]);
        await shot(page, 'reading-tree-filter');

        await filter.fill('');
        await expect(page.locator('#sidebar .tree-item[hidden]')).toHaveCount(0);
    });

    test('the shortcut cheat sheet opens', async ({page}) => {
        await pressShortcut(page, '?');

        const sheet = page.locator('dialog.modal');
        await expect(sheet.locator('.modal-title')).toHaveText('Keyboard shortcuts');
        await expect(sheet.locator('.keys dt').first()).toBeVisible();
        await shot(page, 'reading-cheat-sheet');
    });

    test('a deeply nested document renders', async ({page}) => {
        await page.goto(`/p/${docs.deep.path}`);

        await expect(page.locator('#doc h1').first()).toContainText(docs.deep.title);
        await expect(page.locator('#doc h2')).not.toHaveCount(0);
        await expect(page.locator('.crumbs-list .crumb')).toContainText(docs.deep.crumbs);
        await shot(page, 'reading-deep-document');
    });

    test('an in page anchor scrolls to its heading', async ({page}) => {
        await page.goto(`/p/${DOC.path}`);
        const before = await page.evaluate(() => window.scrollY);
        expect(before).toBe(0);

        await page.locator(`#doc a[href*="${DOC.heading.href}"]`).first().click();

        // the scroll is animated, so wait for the heading to settle under the top bar
        await expect
            .poll(() => page.locator(`#doc h2#${DOC.heading.id}`).evaluate(
                (el) => el.getBoundingClientRect().top))
            .toBeLessThan(250);
        expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
        await shot(page, 'reading-anchor');
    });

    test('a relative link between documents navigates', async ({page}) => {
        await page.locator(`#doc a[href="/p/${docs.linked.path}"]`).first().click();

        await expect(page).toHaveURL(`${MAIN.baseURL}/p/${docs.linked.path}`);
        await expect(page.locator('#doc h1').first()).toContainText(docs.linked.title);
    });

    test('an image loads through /raw/', async ({page}) => {
        await page.goto(`/p/${docs.illustrated.doc}`);
        const image = page.locator('#doc img[src^="/raw/"]').first();

        await expect(image).toBeVisible();
        const size = await image.evaluate((el) => ({w: el.naturalWidth, h: el.naturalHeight}));
        expect(size.w).toBeGreaterThan(0);
        expect(size.h).toBeGreaterThan(0);
        await shot(page, 'reading-image');
    });

    test('a code block shows its language and the copy button copies', async ({page}) => {
        await page.goto(`/p/${DOC.path}`);
        const block = page.locator('#doc .code-block[data-lang]').first();

        await expect(block).toHaveAttribute('data-lang', DOC.lang);
        const label = await block.evaluate(
            (el) => getComputedStyle(el, '::before').content);
        expect(label).toContain(DOC.lang);

        const code = (await block.locator('pre').innerText()).trim();
        await block.locator('.code-copy').click();
        await expect(block.locator('.code-copy.is-done')).toBeVisible();

        const clipboard = await page.evaluate(() => navigator.clipboard.readText());
        expect(clipboard.trim()).toBe(code);
        await shot(page, 'reading-code-copy');
    });

    test('the toc rail highlights the section being read', async ({page}) => {
        await page.goto(`/p/${DOC.path}`);
        await expect(page.locator('#toc-rail')).toBeVisible();

        await page.locator(`#doc h2#${DOC.heading.id}`).evaluate((el) => {
            window.scrollTo({top: el.getBoundingClientRect().top + window.scrollY - 100, behavior: 'instant'});
        });

        const active = page.locator('#toc-rail .toc-item.is-active');
        await expect(active).toHaveCount(1);
        await expect(active).toContainText(DOC.heading.text);
        await shot(page, 'reading-toc-active');
    });
});
