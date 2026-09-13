const {expect, test} = require('@playwright/test');

const fs = require('fs');

const docs = require('../support/docs');
const {
    HISTORY, MAIN, expectNoHorizontalScroll, fixtureFile, shot, signIn, writeFixture,
} = require('../support/helpers');

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
                    what: sel + ' ' + (el.getAttribute('aria-label') || el.className),
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

    test('the drawer opens, navigates and closes', async ({page}) => {
        const sidebar = page.locator('#sidebar');
        // the drawer is parked with translateX(-100%), so its position is the
        // thing to assert, not css visibility
        const drawerLeft = () => sidebar.evaluate((el) => el.getBoundingClientRect().right);

        expect(await drawerLeft()).toBeLessThanOrEqual(0);

        await page.locator('.topbar-burger').tap();
        await expect(page.locator('body')).toHaveClass(/drawer-open/);
        await expect.poll(drawerLeft).toBeGreaterThan(200);
        await expect(sidebar).toHaveAttribute('aria-modal', 'true');
        await expect(page.locator('.topbar-burger')).toHaveAttribute('aria-expanded', 'true');
        await shot(page, 'mobile-drawer-open');

        await sidebar.locator('.sidebar-close').tap();
        await expect(page.locator('body')).not.toHaveClass(/drawer-open/);
        await expect.poll(drawerLeft).toBeLessThanOrEqual(0);

        await page.locator('.topbar-burger').tap();
        await sidebar.locator(
            `details.tree-dir[data-path="${docs.doc.folder}"] summary .tree-twisty`).tap();
        await sidebar.locator(`.tree-link[href="/p/${DOC}"]`).tap();

        await expect(page).toHaveURL(new RegExp(`/p/${DOC}$`));
        await expect(page.locator('#doc h1').first()).toContainText(docs.doc.title);
        await expect(page.locator('body')).not.toHaveClass(/drawer-open/);
        await shot(page, 'mobile-after-navigation');
    });

    test('swiping the drawer to the left closes it', async ({page}) => {
        const sidebar = page.locator('#sidebar');
        await page.locator('.topbar-burger').tap();
        await expect(page.locator('body')).toHaveClass(/drawer-open/);
        // measuring before the slide-in transition ends gives a box off screen
        await expect
            .poll(() => sidebar.evaluate((el) => el.getBoundingClientRect().x))
            .toBe(0);

        const box = await sidebar.boundingBox();
        const y = box.y + box.height / 2;

        await page.mouse.move(box.x + box.width - 30, y);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width - 120, y, {steps: 6});
        await shot(page, 'mobile-drawer-swiping');
        await page.mouse.up();

        await expect(page.locator('body')).not.toHaveClass(/drawer-open/);
        await expect
            .poll(() => page.locator('#sidebar').evaluate((el) => el.getBoundingClientRect().right))
            .toBeLessThanOrEqual(0);
        await expect(page).toHaveURL(`${MAIN.baseURL}/`);
    });

    test('a closed drawer keeps its links out of the tab order', async ({page}) => {
        await page.goto(`/p/${DOC}`);
        const reachable = await page.evaluate((doc) => {
            const link = document.querySelector(`#sidebar .tree-link[href="/p/${doc}"]`);
            if (!link) return false;
            link.focus();
            return document.activeElement === link;
        }, DOC);
        expect(reachable, 'a link inside the closed drawer took focus').toBe(false);
    });

    test('the editor is usable and the preview tab switches', async ({page}) => {
        writeFixture(SCRATCH, '# Заметка\n\nтекст\n');
        await page.goto(`/edit/${SCRATCH}`);

        const source = page.locator('#editor-source');
        await expect(source).toBeVisible();
        const box = await source.boundingBox();
        expect(box.width).toBeLessThanOrEqual(390);
        expect(box.width).toBeGreaterThan(300);
        expect(box.height).toBeGreaterThan(200);

        const fontSize = await source.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
        expect(fontSize, 'iOS zooms into any field under 16px').toBeGreaterThanOrEqual(16);
        await shot(page, 'mobile-editor');

        await source.fill('# Заметка\n\nновый текст\n');
        await page.locator('[data-pane-tab="preview"]').tap();
        await expect(page.locator('#preview')).toContainText('новый текст');
        await expect(page.locator('#preview')).toBeVisible();
        await shot(page, 'mobile-editor-preview');

        await page.locator('[data-pane-tab="source"]').tap();
        await expect(source).toBeVisible();

        await page.locator('[data-editor-save]').tap();
        await expect(page.locator('#status-state')).toHaveText('Saved');
        await expectNoHorizontalScroll(page);
    });

    test('no page scrolls horizontally', async ({page}) => {
        writeFixture(SCRATCH, '# Заметка\n\nтекст\n');
        const routes = [
            '/',
            `/p/${DOC}`,
            `/p/${docs.deep.path}`,
            `/p/${docs.folder.path}/`,
            `/search?q=${encodeURIComponent(docs.search.word)}`,
            '/p/nothing-here.md',
            `/edit/${SCRATCH}`,
        ];
        for (const route of routes) {
            await page.goto(route);
            await expectNoHorizontalScroll(page);
        }

        await page.goto(`/p/${DOC}`);
        await page.locator('.topbar-burger').tap();
        await expectNoHorizontalScroll(page);
        await shot(page, 'mobile-no-h-scroll');
    });

    test('tap targets are at least 40px', async ({page}) => {
        await page.goto(`/p/${DOC}`);

        const offenders = [];
        for (const selector of ['.topbar button', '.topbar a.btn', '.toc-pill']) {
            offenders.push(...await tooSmall(page, selector));
        }
        await page.locator('.topbar-burger').tap();
        for (const selector of ['#sidebar .tree-row', '#sidebar .row-more', '#sidebar button']) {
            offenders.push(...await tooSmall(page, selector));
        }
        await shot(page, 'mobile-tap-targets');

        expect(offenders, 'elements smaller than the 40px touch minimum').toEqual([]);
    });

    test('controls inside the document are big enough to tap', async ({page}) => {
        await page.goto(`/p/${DOC}`);
        await page.waitForLoadState('networkidle');
        await page.locator('#doc .code-block').first().scrollIntoViewIfNeeded();
        await shot(page, 'mobile-doc-controls');

        // the page holds dozens of each, so report the first few by name
        const offenders = [
            ...await tooSmall(page, '#doc .code-copy'),
            ...await tooSmall(page, '#doc .anchor'),
        ].slice(0, 3);
        expect(offenders, 'controls smaller than the 40px touch minimum').toEqual([]);
    });

    // the diff is a nowrap pre, so a bare 1fr track takes the width of the
    // longest patch line: the page stretched to 1899px inside a 390px viewport,
    // nothing could scroll to it, and Restore sat off screen on every row
    test('the version history page fits the screen and Restore is reachable', async ({page}) => {
        const wide = 'x'.repeat(200);
        await signIn(page, {baseURL: HISTORY.baseURL});
        await page.goto(`${HISTORY.baseURL}/edit/${HISTORY_DOC}`);
        for (const body of [`# Одна\n\n${wide}\n`, `# Две\n\n${wide}${wide}\n`]) {
            await page.locator('#editor-source').fill(body);
            await page.locator('[data-editor-save]').tap();
            await expect(page.locator('#status-state')).toHaveText('Saved');
        }

        await page.goto(`${HISTORY.baseURL}/history/${HISTORY_DOC}`);
        await expect(page.locator('.version').first()).toBeVisible();
        await expectNoHorizontalScroll(page);

        const viewport = page.viewportSize().width;
        const restore = page.locator('[data-restore]').first();
        const box = await restore.boundingBox();
        expect(box.x + box.width, 'Restore reaches past the right edge').toBeLessThanOrEqual(viewport);
        expect(await tooSmall(page, '[data-restore]'),
            'Restore is under the 40px touch minimum').toEqual([]);

        await page.locator('.version').nth(1).locator('.version-pick').tap();
        const diff = page.locator('#version-detail .diff');
        await expect(diff).toBeVisible();
        // the patch scrolls inside its own box rather than taking the page with it
        expect(await diff.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
        await expectNoHorizontalScroll(page);
        await shot(page, 'mobile-history');

        // the same tap has to close it again, or the only way back to the list
        // is scrolling past the whole patch
        await page.locator('.version').nth(1).locator('.version-pick').tap();
        await expect(page.locator('#version-detail .diff')).toHaveCount(0);
        await expect(page.locator('.version.is-selected')).toHaveCount(0);
        await expect(page.locator('#version-detail')).toContainText('Pick a version');
    });

    test('the palette opens from the top bar and navigates', async ({page}) => {
        await page.goto(`/p/${DOC}`);
        await page.waitForLoadState('networkidle');
        await page.locator('.search-trigger').tap();

        await expect(page.locator('#palette')).toBeVisible();
        await page.locator('#palette-input').fill(docs.search.palette.query);
        await expect(page.locator('#palette-results .palette-item').first()).toBeVisible();
        await shot(page, 'mobile-palette');

        await page.locator('#palette-results .palette-item').first().tap();
        await expect(page).toHaveURL(new RegExp(`/p/${docs.search.palette.path}\\?q=`));
    });

    test('the outline sheet opens from the floating pill', async ({page}) => {
        await page.goto(`/p/${DOC}`);
        const pill = page.locator('.toc-pill');
        await expect(pill).toBeVisible();

        await pill.tap();
        await expect(page.locator('body')).toHaveClass(/toc-open/);
        await expect(page.locator('#toc-rail')).toBeVisible();
        await shot(page, 'mobile-toc-sheet');

        await page.locator('#toc-rail .toc-item a').first().tap();
        await expect(page.locator('body')).not.toHaveClass(/toc-open/);
    });

    test('closing the outline sheet leaves the page live behind it', async ({page}) => {
        await page.goto(`/p/${DOC}`);
        await page.locator('.toc-pill').tap();
        await expect(page.locator('body')).toHaveClass(/toc-open/);

        await page.keyboard.press('Escape');
        await expect(page.locator('body')).not.toHaveClass(/toc-open/);

        // the sheet marks everything behind it inert. A close that skipped its
        // own teardown used to leave that on, and the page took no tap at all
        // until it was reloaded.
        const stuck = await page.evaluate(() => Array.from(
            document.querySelectorAll('[inert]')).map((el) => el.className));
        expect(stuck, 'the sheet left the page inert behind it').toEqual([]);

        await page.locator('.topbar-burger').tap();
        await expect(page.locator('body')).toHaveClass(/drawer-open/);
    });

    test('the notes can be installed as an app', async ({page}) => {
        await page.goto('/');
        await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
        await expect(page.locator('meta[name="apple-mobile-web-app-capable"]'))
            .toHaveAttribute('content', 'yes');

        const res = await page.request.get(`${MAIN.baseURL}/manifest.webmanifest`);
        expect(res.status()).toBe(200);
        expect(res.headers()['content-type']).toContain('application/manifest+json');

        const manifest = await res.json();
        expect(manifest.display).toBe('standalone');
        const title = await page.locator('.sidebar-title').textContent();
        expect(manifest.name, 'the home screen name is the configured site title')
            .toBe(title.trim());

        const icon = await page.request.get(`${MAIN.baseURL}${manifest.icons[0].src}`);
        expect(icon.status()).toBe(200);
        expect(icon.headers()['content-type']).toBe('image/png');
    });

    test('the image viewer closes on a tap', async ({page}) => {
        await page.goto(`/p/${docs.illustrated.doc}`);
        const image = page.locator('#doc img[src^="/raw/"]').first();
        await expect(image).toBeVisible();
        await image.tap();

        const dialog = page.locator('#lightbox');
        await expect(dialog).toBeVisible();
        await shot(page, 'mobile-lightbox');

        // the backdrop closes it with a pointer, and on a phone the image covers
        // nearly the whole dialog, leaving almost no backdrop to aim at
        await page.locator('#lightbox-img').tap();
        await expect(dialog).not.toBeVisible();
    });

    test('the search sheet fills the screen with the phone turned sideways', async ({page}) => {
        await page.setViewportSize({width: 844, height: 390});
        await page.goto(`/p/${DOC}`);
        await page.locator('.search-trigger').tap();

        const dialog = page.locator('#palette');
        await expect(dialog).toBeVisible();
        // past the width breakpoint it fell back to the centred panel, which at
        // this height is a strip the on-screen keyboard covers
        const box = await dialog.boundingBox();
        expect(box.y, 'the sheet starts at the top edge').toBeLessThan(20);
        expect(box.height, 'the sheet takes the height').toBeGreaterThan(300);
        await shot(page, 'mobile-landscape-palette');
        await expectNoHorizontalScroll(page);
    });
});
