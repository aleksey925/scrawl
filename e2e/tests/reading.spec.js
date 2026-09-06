const {expect, test} = require('@playwright/test');

const {MAIN, pressShortcut, shot, signIn} = require('../support/helpers');

test.describe('reading', () => {
    test.beforeEach(async ({page}) => {
        await signIn(page);
    });

    test('the root page renders the index document', async ({page}) => {
        await expect(page.locator('#doc h1').first()).toContainText('База знаний');
        await expect(page.locator('#doc a[href="/p/db/postgresql.md"]')).toHaveCount(1);
        await shot(page, 'reading-root');
    });

    test('the disclosure triangle expands a folder without leaving the page', async ({page}) => {
        const folder = page.locator('#sidebar details.tree-dir[data-path="db"]');
        await expect(folder).toHaveJSProperty('open', false);

        await folder.locator('summary .tree-twisty').click();
        await expect(folder).toHaveJSProperty('open', true);
        await expect(page).toHaveURL(`${MAIN.baseURL}/`);
        await shot(page, 'reading-tree-expanded');

        await folder.locator('.tree-link[href="/p/db/postgresql.md"]').click();
        await expect(page).toHaveURL(/\/p\/db\/postgresql\.md$/);
        await expect(page.locator('.tree-row.is-current')).toHaveAttribute('data-path', 'db/postgresql.md');
    });

    test('a folder label opens the folder page and expands the row', async ({page}) => {
        await page.locator('#sidebar details.tree-dir[data-path="db"] > summary .tree-link').click();

        await expect(page).toHaveURL(`${MAIN.baseURL}/p/db/`);
        await expect(page.locator('.dir-list-title')).toContainText('items');
        await expect(page.locator('#sidebar details.tree-dir[data-path="db"]'))
            .toHaveJSProperty('open', true);
        await shot(page, 'reading-folder-page');
    });

    test('the sidebar filter narrows the tree and highlights the match', async ({page}) => {
        await pressShortcut(page, '/');
        const filter = page.locator('#tree-filter');
        await expect(filter).toBeFocused();

        await filter.fill('postgre');
        await expect(page.locator('#sidebar .tree-row[data-path="db/postgresql.md"] mark'))
            .toHaveText('postgre');
        const visible = () => page.evaluate(() => Array.from(
            document.querySelectorAll('#sidebar .tree-leaf'))
            .filter((row) => row.offsetParent !== null)
            .map((row) => row.dataset.path));
        await expect.poll(visible).toEqual(['db/postgresql.md']);
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

    test('a deep cyrillic document renders', async ({page}) => {
        await page.goto('/p/python/libs-docs/sqlalchemy-tutorial.md');

        await expect(page.locator('#doc h1').first()).toContainText('SQLAlchemy');
        await expect(page.locator('#doc h2')).not.toHaveCount(0);
        await expect(page.locator('.crumbs-list .crumb')).toContainText([/python/, /libs-docs/, /sqlalchemy/]);
        await shot(page, 'reading-deep-cyrillic');
    });

    test('an in page anchor scrolls to its heading', async ({page}) => {
        await page.goto('/p/db/postgresql.md');
        const before = await page.evaluate(() => window.scrollY);
        expect(before).toBe(0);

        await page.locator('#doc a[href*="%D0%98%D0%BD%D0%B4%D0%B5%D0%BA%D1%81%D1%8B"]').first().click();

        // the scroll is animated, so wait for the heading to settle under the top bar
        await expect
            .poll(() => page.locator('#doc h2#индексы').evaluate(
                (el) => el.getBoundingClientRect().top))
            .toBeLessThan(250);
        expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
        await shot(page, 'reading-anchor');
    });

    test('a relative link between documents navigates', async ({page}) => {
        await page.locator('#doc a[href="/p/clean-code/clean-code-index.md"]').first().click();

        await expect(page).toHaveURL(/\/p\/clean-code\/clean-code-index\.md$/);
        await expect(page.locator('#doc h1').first()).toContainText('Чистый код');
    });

    test('an image loads through /raw/', async ({page}) => {
        await page.goto('/p/regexp/regexp-index.md');
        const image = page.locator('#doc img[src^="/raw/"]').first();

        await expect(image).toBeVisible();
        const size = await image.evaluate((el) => ({w: el.naturalWidth, h: el.naturalHeight}));
        expect(size.w).toBeGreaterThan(0);
        expect(size.h).toBeGreaterThan(0);
        await shot(page, 'reading-image');
    });

    test('a code block shows its language and the copy button copies', async ({page}) => {
        await page.goto('/p/db/postgresql.md');
        const block = page.locator('#doc .code-block[data-lang]').first();

        await expect(block).toHaveAttribute('data-lang', 'bash');
        const label = await block.evaluate(
            (el) => getComputedStyle(el, '::before').content);
        expect(label).toContain('bash');

        const code = (await block.locator('pre').innerText()).trim();
        await block.locator('.code-copy').click();
        await expect(block.locator('.code-copy.is-done')).toBeVisible();

        const clipboard = await page.evaluate(() => navigator.clipboard.readText());
        expect(clipboard.trim()).toBe(code);
        await shot(page, 'reading-code-copy');
    });

    test('the toc rail highlights the section being read', async ({page}) => {
        await page.goto('/p/db/postgresql.md');
        await expect(page.locator('#toc-rail')).toBeVisible();

        await page.locator('#doc h2#индексы').evaluate((el) => {
            window.scrollTo({top: el.getBoundingClientRect().top + window.scrollY - 100, behavior: 'instant'});
        });

        const active = page.locator('#toc-rail .toc-item.is-active');
        await expect(active).toHaveCount(1);
        await expect(active).toContainText('Индексы');
        await shot(page, 'reading-toc-active');
    });
});
