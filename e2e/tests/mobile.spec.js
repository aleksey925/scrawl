const {expect, test} = require('@playwright/test');

const fs = require('fs');

const docs = require('../support/docs');
const {
    MAIN, expectNoHorizontalScroll, fixtureFile, shot, signIn, writeFixture,
} = require('../support/helpers');

const MIN_TAP = 40;
const DOC = docs.doc.path;
const SCRATCH = 'e2e-mobile/zametka.md';

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
});
