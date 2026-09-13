const {expect, test} = require('@playwright/test');

const docs = require('../support/docs');
const {
    MAIN, modifier, pressShortcut, removeFixture, routes, shot, signIn, writeFixture,
} = require('../support/helpers');
const text = require('../support/text');

const DOC = docs.doc;
const ANCHORS = 'e2e-anchors.md';

// a page of its own for the anchor test: the fragment an author writes and the
// slug the renderer makes have to be the same string for the jump to resolve,
// and whether they are in the corpus is not this test's subject
function anchorDocument() {
    const filler = Array.from(
        {length: 40},
        (_, index) => `Строка наполнителя номер ${index}, чтобы страница была выше экрана.`).join('\n\n');
    return `# Якоря\n\nПерейти к [разделу](#раздел).\n\n${filler}\n\n## Раздел\n\nТекст раздела.\n\n${filler}\n`;
}

test.describe('reading', () => {
    test.beforeEach(async ({page}) => {
        await signIn(page);
    });

    test('the root page renders the index document', async ({page}) => {
        await expect(page.getByTestId('doc').locator('h1').first()).toContainText(docs.home.title);
        await expect(page.getByTestId('doc').locator(
            `a[href="${routes.contentHref(docs.linked.path)}"]`).first()).toBeVisible();
        await shot(page, 'reading-root');
    });

    test('the disclosure triangle expands a folder without leaving the page', async ({page}) => {
        const row = page.locator(`[data-testid=tree-row][data-path="${DOC.folder}"]`);
        const twisty = row.getByTestId('tree-twisty');
        await expect(row).toBeVisible();
        await expect(twisty).toHaveAttribute('data-open', 'false');

        await twisty.click();
        await expect(twisty).toHaveAttribute('data-open', 'true');
        await expect(page).toHaveURL(MAIN.url.home());
        await shot(page, 'reading-tree-expanded');

        const child = page.locator(`[data-testid=tree-row][data-path="${DOC.path}"] [data-testid=tree-link]`);
        await child.click();
        await expect(page).toHaveURL(MAIN.url.doc(DOC.path));
        await expect(page.locator('[data-testid=tree-row][data-current="true"]'))
            .toHaveAttribute('data-path', DOC.path);
    });

    test('a folder label opens the folder page and expands the row', async ({page}) => {
        await page.locator(`[data-testid=tree-row][data-path="${DOC.folder}"] [data-testid=tree-link]`).click();

        await expect(page).toHaveURL(MAIN.url.dir(DOC.folder));
        await expect(page.getByTestId('dir-title')).toBeVisible();
        await expect(page.locator(`[data-testid=tree-row][data-path="${DOC.folder}"] [data-testid=tree-twisty]`))
            .toHaveAttribute('data-open', 'true');
        await shot(page, 'reading-folder-page');
    });

    test('the sidebar filter narrows the tree and highlights the match', async ({page}) => {
        const filter = page.getByTestId('sidebar-filter');
        await filter.fill(docs.filter.term);

        await expect(page.locator(`[data-testid=tree-row][data-path="${docs.filter.path}"] mark`))
            .toHaveText(docs.filter.term);
        // the folder holding the match is on screen too, and nothing else is
        const shown = () => page.getByTestId('tree-row').evaluateAll(
            (rows) => rows.map((row) => row.dataset.path));
        await expect.poll(shown).toContain(docs.filter.path);
        await expect.poll(async () => (await shown()).length).toBeLessThan(4);
        await shot(page, 'reading-tree-filter');

        await page.getByTestId('sidebar-filter-clear').click();
        await expect(filter).toHaveValue('');
        await expect.poll(async () => (await shown()).length).toBeGreaterThan(4);
    });

    test('a filter that matches nothing offers the full text search instead', async ({page}) => {
        await page.getByTestId('sidebar-filter').fill('zzzznotinthetreezzzz');

        await expect(page.getByTestId('sidebar-empty')).toHaveText(text.sidebar.nothingMatches);
        await expect(page.getByTestId('tree-row')).toHaveCount(0);
    });

    test('a deeply nested document renders', async ({page}) => {
        await page.goto(routes.doc(docs.deep.path));

        await expect(page.getByTestId('doc').locator('h1').first()).toContainText(docs.deep.title);
        await expect(page.getByTestId('doc').locator('h2')).not.toHaveCount(0);
        await expect(page.getByTestId('topbar-crumb')).toContainText(docs.deep.crumbs);
        await expect(page.locator('[data-testid=topbar-crumb][data-current="true"]')).toHaveCount(1);
        await shot(page, 'reading-deep-document');
    });

    test('an in page anchor scrolls to its heading', async ({page}) => {
        writeFixture(ANCHORS, anchorDocument());
        await page.goto(routes.doc(ANCHORS));
        await expect(page.getByTestId('doc').locator('h2')).toHaveCount(1);
        expect(await page.evaluate(() => window.scrollY)).toBe(0);

        await page.getByTestId('doc').getByRole('link', {name: 'разделу'}).click();

        // the scroll is animated, so wait for the heading to settle under the top bar
        await expect
            .poll(() => page.getByTestId('doc').locator('h2').first().evaluate(
                (el) => el.getBoundingClientRect().top))
            .toBeLessThan(250);
        expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
        await shot(page, 'reading-anchor');

        removeFixture(ANCHORS);
    });

    // the renderer lowercases a slug while an author writes the heading as it
    // reads, so "[x](#Индексы)" has to find <h2 id="индексы">. The exact match
    // is tried first, and only then the folded one, or a document holding both
    // cases would resolve to whichever came first in the dom.
    test('an anchor written in another case than its slug still resolves', async ({page}) => {
        writeFixture(ANCHORS, '# Якоря\n\n[раздел](#Раздел)\n\n## Раздел\n\nтекст\n');
        await page.goto(routes.doc(ANCHORS));

        await page.getByTestId('doc').getByRole('link', {name: 'раздел'}).click();
        await expect
            .poll(() => page.getByTestId('doc').locator('h2').first().evaluate(
                (el) => el.getBoundingClientRect().top))
            .toBeLessThan(250);

        removeFixture(ANCHORS);
    });

    test('a relative link between documents navigates', async ({page}) => {
        await page.getByTestId('doc').locator(
            `a[href="${routes.contentHref(docs.linked.path)}"]`).first().click();

        await expect(page).toHaveURL(MAIN.url.doc(docs.linked.path));
        await expect(page.getByTestId('doc').locator('h1').first()).toContainText(docs.linked.title);
    });

    test('an image loads through /raw/', async ({page}) => {
        await page.goto(routes.doc(docs.illustrated.doc));
        const image = page.getByTestId('doc').locator('img[src^="/raw/"]').first();

        await expect(image).toBeVisible();
        const size = await image.evaluate((el) => ({w: el.naturalWidth, h: el.naturalHeight}));
        expect(size.w).toBeGreaterThan(0);
        expect(size.h).toBeGreaterThan(0);
        await shot(page, 'reading-image');
    });

    test('the image opens in the viewer and closes again', async ({page}) => {
        await page.goto(routes.doc(docs.illustrated.doc));
        await page.getByTestId('doc-image').first().click();

        // the viewer is mounted whether or not it is open, so the image it puts
        // on the screen is what says it is up
        await expect(page.getByTestId('doc-lightbox-image')).toBeVisible();
        await expect(page.getByTestId('doc-lightbox-caption')).toBeVisible();
        await shot(page, 'reading-lightbox');

        await page.getByTestId('doc-lightbox-close').click();
        await expect(page.getByTestId('doc-lightbox-image')).toHaveCount(0);
    });

    test('a code block shows its language and the copy button copies', async ({page}) => {
        await page.goto(routes.doc(DOC.path));
        const block = page.locator('[data-testid=doc-code][data-lang]').first();

        await expect(block).toHaveAttribute('data-lang', DOC.lang);
        const label = await block.evaluate((el) => getComputedStyle(el, '::before').content);
        expect(label).toContain(DOC.lang);

        const code = (await block.locator('pre').innerText()).trim();
        const copy = block.getByTestId('code-copy');
        await expect(copy).toHaveText(text.code.copy);
        await copy.click();
        await expect(copy).toHaveAttribute('data-done', 'true');
        await expect(copy).toHaveText(text.code.copied);

        const clipboard = await page.evaluate(() => navigator.clipboard.readText());
        expect(clipboard.trim()).toBe(code);
        await shot(page, 'reading-code-copy');
    });

    test('the outline highlights the section being read', async ({page}) => {
        await page.goto(routes.doc(DOC.path));
        await expect(page.getByTestId('toc')).toBeVisible();

        await page.locator(`[data-testid=doc] h2#${DOC.heading.id}`).evaluate((el) => {
            window.scrollTo({top: el.getBoundingClientRect().top + window.scrollY - 100, behavior: 'instant'});
        });

        const active = page.locator('[data-testid=toc-entry][data-active="true"]');
        await expect(active).toHaveCount(1);
        await expect(active).toContainText(DOC.heading.text);
        await shot(page, 'reading-toc-active');
    });

    // "?" is a character somebody types, so the sheet must stay out of the way
    // while a field has the keyboard
    test('the shortcut cheat sheet opens', async ({page}) => {
        await page.keyboard.press('?');
        await expect(page.getByTestId('shortcuts')).toBeVisible();
    });

    test('the text starts beside the tree rather than centred in the window', async ({page}) => {
        await page.goto(routes.doc(DOC.path));
        await expect(page.getByTestId('doc')).toBeVisible();

        const gap = await page.evaluate(() => {
            const rail = document.querySelector('nav').getBoundingClientRect();
            const doc = document.querySelector('[data-testid=doc]').getBoundingClientRect();
            return doc.left - rail.right;
        });
        expect(gap).toBeGreaterThanOrEqual(0);
        expect(gap).toBeLessThan(40);
    });

    test('the file list hides on demand and stays hidden', async ({page}) => {
        const burger = page.getByTestId('topbar-burger');
        const sidebar = page.getByTestId('sidebar');
        const left = () => page.getByTestId('doc').evaluate((el) => el.getBoundingClientRect().left);

        await page.goto(routes.doc(DOC.path));
        await expect(sidebar).toBeVisible();
        const beside = await left();

        await burger.click();
        await expect(sidebar).toHaveCount(0);
        await expect(burger).toHaveAttribute('data-opened', 'false');
        expect(await left()).toBeLessThan(beside);
        await shot(page, 'reading-sidebar-hidden');

        await page.reload();
        await expect(sidebar).toHaveCount(0);

        await pressShortcut(page, `${await modifier(page)}+b`);
        await expect(sidebar).toBeVisible();
        await expect(burger).toHaveAttribute('data-opened', 'true');
    });
});
