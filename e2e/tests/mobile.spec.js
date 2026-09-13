const {expect, test} = require('@playwright/test');

const fs = require('fs');

const docs = require('../support/docs');
const {
    HISTORY, MAIN, expectNoHorizontalScroll, fixtureFile, routes, save, setSource, shot, signIn,
    sourceText, writeFixture,
} = require('../support/helpers');
const text = require('../support/text');

const MIN_TAP = 44;
const DOC = docs.doc.path;
const SCRATCH = 'e2e-mobile/zametka.md';
const HISTORY_FOLDER = 'e2e-mobile-history';
const HISTORY_DOC = `${HISTORY_FOLDER}/versions.md`;

// tooSmall reports every element of a selector that is under the minimum touch
// size, so a failure names the offender instead of giving a bare count
async function tooSmall(page, selector) {
    return page.evaluate(([sel, min]) => {
        return Array.from(document.querySelectorAll(sel))
            .filter((el) => el.offsetParent !== null || el === document.activeElement)
            .map((el) => {
                const box = el.getBoundingClientRect();
                return {
                    what: `${sel} ${el.getAttribute('aria-label') || el.dataset.testid || el.className}`,
                    w: Math.round(box.width),
                    h: Math.round(box.height),
                };
            })
            .filter((item) => item.w > 0 && (item.w < min || item.h < min));
    }, [selector, MIN_TAP]);
}

test.describe('mobile', () => {
    test.beforeEach(async ({page}) => {
        await signIn(page);
    });

    test.afterAll(() => {
        fs.rmSync(fixtureFile('e2e-mobile'), {recursive: true, force: true});
        fs.rmSync(fixtureFile(HISTORY_FOLDER, HISTORY), {recursive: true, force: true});
    });

    // the drawer opens and shuts again inside the same frame. AppLayout closes
    // it from an effect that lists the disclosure handlers among its
    // dependencies, and those are a fresh object on every render, so the effect
    // runs after each one and takes the drawer down with it.
    test.fixme('the drawer opens, navigates and closes', async ({page}) => {
        const burger = page.getByTestId('topbar-burger');
        await expect(burger).toHaveAttribute('data-opened', 'false');

        await burger.tap();
        await expect(burger).toHaveAttribute('data-opened', 'true');
        await expect(page.getByTestId('sidebar')).toBeVisible();
        await shot(page, 'mobile-drawer-open');

        await page.locator(`[data-testid=tree-row][data-path="${docs.doc.folder}"] [data-testid=tree-twisty]`)
            .tap();
        await page.locator(`[data-testid=tree-row][data-path="${DOC}"] [data-testid=tree-link]`).tap();

        await expect(page).toHaveURL(MAIN.url.doc(DOC));
        await expect(page.getByTestId('doc').locator('h1').first()).toContainText(docs.doc.title);
        // a navigation closes it, which is the only way back to the document
        await expect(page.getByTestId('sidebar')).toHaveCount(0);
        await shot(page, 'mobile-after-navigation');
    });

    // the drawer is a mantine component and closes on its overlay, on Escape and
    // on a navigation. It has no swipe of its own, which the legacy drawer had.
    test.fixme('swiping the drawer to the left closes it', async ({page}) => {
        await page.getByTestId('topbar-burger').tap();
        await expect(page.getByTestId('sidebar')).toBeVisible();

        const box = await page.getByTestId('sidebar').boundingBox();
        const y = box.y + box.height / 2;
        await page.mouse.move(box.x + box.width - 30, y);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width - 150, y, {steps: 6});
        await page.mouse.up();

        await expect(page.getByTestId('sidebar')).toHaveCount(0);
    });

    test('a closed drawer keeps its links out of the tab order', async ({page}) => {
        await page.goto(routes.doc(DOC));
        await expect(page.getByTestId('doc')).toBeVisible();

        // the panel is not merely off screen: nothing of it is in the document
        // while it is closed, so there is no link to land on with a tab
        await expect(page.getByTestId('sidebar')).toHaveCount(0);
        await expect(page.getByTestId('tree-link')).toHaveCount(0);
        const reachable = await page.evaluate(
            () => document.querySelector('[data-testid="tree-link"]') !== null);
        expect(reachable, 'a link inside the closed drawer was in the document').toBe(false);
    });

    test('the editor is usable and the preview tab switches', async ({page}) => {
        writeFixture(SCRATCH, '# Заметка\n\nтекст\n');
        await page.goto(routes.edit(SCRATCH));
        await expect.poll(() => sourceText(page)).toBe('# Заметка\n\nтекст\n');

        const source = page.getByTestId('editor-source');
        await expect(source).toBeVisible();
        const box = await source.boundingBox();
        expect(box.height).toBeGreaterThan(200);

        const fontSize = await source.locator('.cm-content').evaluate(
            (el) => parseFloat(getComputedStyle(el).fontSize));
        expect(fontSize, 'iOS zooms into any field under 16px').toBeGreaterThanOrEqual(16);
        // one pane at a time on a phone, so the layout control is off and the
        // tabs stand in for it
        await expect(page.getByTestId('editor-panes')).toHaveAttribute('data-mode', 'source');
        await expect(page.getByTestId('editor-layout-mode')).toHaveCount(0);
        await shot(page, 'mobile-editor');

        await setSource(page, '# Заметка\n\nновый текст\n');
        await page.getByTestId('editor-tab-preview').tap();
        await expect(page.getByTestId('editor-preview')).toContainText('новый текст');
        await expect(page.getByTestId('editor-panes')).toHaveAttribute('data-mode', 'preview');
        await expect(page.getByTestId('editor-source')).toHaveCount(0);
        await shot(page, 'mobile-editor-preview');

        await page.getByTestId('editor-tab-source').tap();
        await expect(page.getByTestId('editor-source')).toBeVisible();

        await page.getByTestId('editor-save').tap();
        await expect(page.locator('[data-testid=toast][data-kind="ok"]')).toContainText(text.toast.saved);
        await expectNoHorizontalScroll(page);
    });

    // the source pane collapses to a sliver. The wrapper around it carries the
    // pane class but no flex-grow, and only the split layout gives it a width,
    // so with one pane on screen it shrinks to its content.
    test.fixme('the editor pane takes the width of the screen', async ({page}) => {
        writeFixture(SCRATCH, '# Заметка\n\nтекст\n');
        await page.goto(routes.edit(SCRATCH));

        const box = await page.getByTestId('editor-source').boundingBox();
        expect(box.width).toBeLessThanOrEqual(390);
        expect(box.width).toBeGreaterThan(300);
    });

    test('no page scrolls horizontally', async ({page}) => {
        writeFixture(SCRATCH, '# Заметка\n\nтекст\n');
        const pages = [
            routes.home(),
            routes.doc(DOC),
            routes.doc(docs.deep.path),
            routes.dir(docs.folder.path),
            routes.search(docs.search.word),
            routes.doc('nothing-here.md'),
            routes.edit(SCRATCH),
        ];
        for (const route of pages) {
            await page.goto(route);
            await page.waitForLoadState('networkidle');
            await expectNoHorizontalScroll(page);
        }
        await shot(page, 'mobile-no-h-scroll');
    });

    test('the controls inside a document are big enough to tap', async ({page}) => {
        await page.goto(routes.doc(DOC));
        await page.waitForLoadState('networkidle');
        await page.getByTestId('doc-code').first().scrollIntoViewIfNeeded();
        await shot(page, 'mobile-doc-controls');

        // the page holds dozens of each, so report the first few by name
        const offenders = [
            ...await tooSmall(page, '[data-testid=code-copy]'),
            ...await tooSmall(page, '[data-testid=doc-heading-anchor]'),
        ].slice(0, 3);
        expect(offenders, 'controls smaller than the touch minimum').toEqual([]);
    });

    test('the editor tabs are big enough to tap', async ({page}) => {
        writeFixture(SCRATCH, '# Заметка\n\nтекст\n');
        await page.goto(routes.edit(SCRATCH));
        await expect(page.getByTestId('editor-tabs')).toBeVisible();

        expect(await tooSmall(page, '[data-testid=editor-tab-source], [data-testid=editor-tab-preview]'))
            .toEqual([]);
        expect(await tooSmall(page, '[data-testid=editor-toolbar] button')).toEqual([]);
    });

    // every control in the top bar is drawn at the desktop size: the burger is
    // 22px square and the icon buttons beside it 34px, against a 44px minimum
    test.fixme('the top bar controls are big enough to tap', async ({page}) => {
        await page.goto(routes.doc(DOC));

        const offenders = await tooSmall(page, '[data-testid=topbar] button, [data-testid=topbar] a');
        await shot(page, 'mobile-tap-targets');
        expect(offenders, 'elements smaller than the touch minimum').toEqual([]);
    });

    // the diff is a nowrap pre, so a bare track takes the width of the longest
    // patch line: the page stretched far past the viewport, nothing could scroll
    // to it, and Restore sat off screen on every row
    test('the version history page fits the screen and collapses on a second tap', async ({page}) => {
        const wide = 'x'.repeat(200);
        await signIn(page, {baseURL: HISTORY.baseURL, from: routes.edit(HISTORY_DOC)});
        for (const body of [`# Одна\n\n${wide}\n`, `# Две\n\n${wide}${wide}\n`]) {
            await setSource(page, body);
            await save(page);
        }

        await page.goto(HISTORY.url.history(HISTORY_DOC));
        await expect(page.getByTestId('version').first()).toBeVisible();
        await expectNoHorizontalScroll(page);

        const viewport = page.viewportSize().width;
        const box = await page.getByTestId('version-restore').first().boundingBox();
        expect(box.x + box.width, 'Restore reaches past the right edge').toBeLessThanOrEqual(viewport);

        // stacked, a version opens inside its own row and nothing is picked on
        // arrival, which would otherwise bury the list under a screen of diff
        await expect(page.locator('[data-testid=version][data-selected="true"]')).toHaveCount(0);
        await page.getByTestId('version').nth(1).getByTestId('version-pick').tap();
        const diff = page.getByTestId('history-diff');
        await expect(diff).toBeVisible();
        // the patch scrolls inside its own box rather than taking the page with it
        expect(await diff.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
        await expectNoHorizontalScroll(page);
        await shot(page, 'mobile-history');

        // the same tap has to close it again, or the only way back to the list
        // is scrolling past the whole patch
        await page.getByTestId('version').nth(1).getByTestId('version-pick').tap();
        await expect(page.getByTestId('history-diff')).toHaveCount(0);
        await expect(page.locator('[data-testid=version][data-selected="true"]')).toHaveCount(0);
    });

    // Restore is an extra small button, which is 30px tall
    test.fixme('Restore is big enough to tap', async ({page}) => {
        await signIn(page, {baseURL: HISTORY.baseURL, from: routes.history(HISTORY_DOC)});

        expect(await tooSmall(page, '[data-testid=version-restore]')).toEqual([]);
    });

    test('the palette opens from the top bar and navigates', async ({page}) => {
        await page.goto(routes.doc(DOC));
        await page.waitForLoadState('networkidle');
        // the labelled button gives way to an icon on a narrow screen
        await expect(page.getByTestId('topbar-search')).toBeHidden();
        await page.getByTestId('topbar-search-compact').tap();

        await expect(page.getByTestId('palette-input')).toBeVisible();
        await page.getByTestId('palette-input').fill(docs.search.palette.query);
        await expect(page.getByTestId('palette-item').first()).toBeVisible();
        await shot(page, 'mobile-palette');

        await page.getByTestId('palette-item').first().tap();
        await expect(page).toHaveURL(new RegExp(`${routes.doc(docs.search.palette.path)}\\?q=`));
    });

    // the outline lives in the same kind of drawer the navigation does, so it
    // closes itself the moment it opens
    test.fixme('the outline sheet opens from the top bar', async ({page}) => {
        await page.goto(routes.doc(DOC));
        await page.getByTestId('topbar-toc').tap();

        await expect(page.getByTestId('toc-entry').first()).toBeVisible();
        await shot(page, 'mobile-toc-sheet');

        await page.getByTestId('toc-entry').first().tap();
        await expect(page.getByTestId('toc-entry')).toHaveCount(0);
    });

    test('a sheet that closed leaves the page live behind it', async ({page}) => {
        await page.goto(routes.doc(docs.illustrated.doc));
        await page.getByTestId('doc-image').first().tap();
        await expect(page.getByTestId('doc-lightbox-image')).toBeVisible();

        await page.keyboard.press('Escape');
        await expect(page.getByTestId('doc-lightbox-image')).toHaveCount(0);

        // a panel that covers the page marks everything behind it inert. A close
        // that skipped its own teardown used to leave that on, and the page took
        // no tap at all until it was reloaded.
        const stuck = await page.evaluate(() => Array.from(
            document.querySelectorAll('[inert]')).map((el) => el.className));
        expect(stuck, 'the sheet left the page inert behind it').toEqual([]);

        await page.getByTestId('doc-image').first().tap();
        await expect(page.getByTestId('doc-lightbox-image')).toBeVisible();
    });

    test('the image viewer closes on a tap', async ({page}) => {
        await page.goto(routes.doc(docs.illustrated.doc));
        const image = page.getByTestId('doc-image').first();
        await expect(image).toBeVisible();
        await image.tap();

        await expect(page.getByTestId('doc-lightbox-image')).toBeVisible();
        await shot(page, 'mobile-lightbox');

        // on a phone the image covers nearly the whole dialog, leaving almost no
        // backdrop to aim at, so it closes on a tap of its own
        await page.getByTestId('doc-lightbox-image').tap();
        await expect(page.getByTestId('doc-lightbox-image')).toHaveCount(0);
    });

    test('the notes can be installed as an app', async ({page}) => {
        await page.goto(routes.home());
        await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
        await expect(page.locator('meta[name="apple-mobile-web-app-capable"]'))
            .toHaveAttribute('content', 'yes');

        const res = await page.request.get(`${MAIN.baseURL}/manifest.webmanifest`);
        expect(res.status()).toBe(200);
        expect(res.headers()['content-type']).toContain('application/manifest+json');

        const manifest = await res.json();
        expect(manifest.display).toBe('standalone');
        const me = await (await page.request.get(`${MAIN.baseURL}/api/me`)).json();
        expect(manifest.name, 'the home screen name is the configured site title')
            .toBe(me.site_title);

        const icon = await page.request.get(`${MAIN.baseURL}${manifest.icons[0].src}`);
        expect(icon.status()).toBe(200);
        expect(icon.headers()['content-type']).toBe('image/png');
    });

    // the legacy palette was a sheet from the top edge at every size, because a
    // centred panel on a phone held sideways is a strip the keyboard covers.
    // The app's palette is the same centred dialog it is on a desktop.
    test('the palette is usable with the phone turned sideways', async ({page}) => {
        await page.setViewportSize({width: 844, height: 390});
        await page.goto(routes.doc(DOC));
        await page.getByTestId('topbar-search').tap();

        await expect(page.getByTestId('palette-input')).toBeVisible();
        await page.getByTestId('palette-input').fill(docs.search.palette.query);
        await expect(page.getByTestId('palette-item').first()).toBeVisible();
        await shot(page, 'mobile-landscape-palette');
        await expectNoHorizontalScroll(page);

        await page.getByTestId('palette-item').first().tap();
        await expect(page).toHaveURL(new RegExp(`${routes.doc(docs.search.palette.path)}\\?q=`));
    });
});
