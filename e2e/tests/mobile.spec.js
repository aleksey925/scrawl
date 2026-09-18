const {expect, test} = require('@playwright/test');

const fs = require('fs');

const docs = require('../support/docs');
const {breakOrigin, restoreOrigin} = require('../support/git');
const {
    HISTORY, MAIN, MULTI, expectNoHorizontalScroll, fixtureFile, routes, save, setSource, shot, signIn,
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

    // the panel slides in from off the screen, so it has a box long before it
    // has a place, and toBeVisible answers for a panel that is merely translated
    // away. Reading boundingBox() then gives coordinates outside the viewport
    // and a gesture aimed at them lands on nothing, so wait for the right edge
    // to arrive instead of for the element to exist.
    async function openDrawer(page) {
        await page.getByTestId('topbar-burger').tap();
        const sidebar = page.getByTestId('sidebar');
        await expect(sidebar).toBeVisible();
        await expect
            .poll(async () => {
                const box = await sidebar.boundingBox();
                return box === null ? -1 : Math.round(box.x + box.width);
            })
            .toBeGreaterThan(200);
        return sidebar;
    }

    // the drawer once opened and shut again inside the same frame, because the
    // effect that closes it on a navigation listed the disclosure handlers among
    // its dependencies and those were a fresh object on every render. It closes
    // on the location now, so opening has to survive the renders that follow.
    test('the drawer opens, navigates and closes', async ({page}) => {
        const burger = page.getByTestId('topbar-burger');
        await expect(burger).toHaveAttribute('data-opened', 'false');

        await openDrawer(page);
        await expect(burger).toHaveAttribute('data-opened', 'true');
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

    // mantine's drawer closes on its overlay, on Escape and on a navigation, but
    // a thumb reaches none of those. The swipe is ours, and it has to close
    // during the move: a guard armed after the gesture eats the next real tap.
    test('swiping the drawer to the left closes it', async ({page}) => {
        const sidebar = await openDrawer(page);

        const box = await sidebar.boundingBox();
        const y = box.y + box.height / 2;
        const from = box.x + box.width - 30;
        const travel = 120;

        // the gesture goes in as touch input rather than through page.mouse,
        // which is what every other interaction in this file uses. A swipe is a
        // finger, and the panel reads it from the pointer events the browser
        // raises for one; mouse input never becomes that drag.
        const cdp = await page.context().newCDPSession(page);
        const send = (type, x) => cdp.send('Input.dispatchTouchEvent', {
            type,
            touchPoints: type === 'touchEnd' ? [] : [{x, y}],
        });

        await send('touchStart', from);
        for (let step = 1; step <= 6; step += 1) {
            await send('touchMove', from - (travel * step) / 6);
        }
        await send('touchEnd', from - travel);

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

    // the source pane once collapsed to a sliver: its wrapper carried the pane
    // class but no flex-grow, and only the split layout handed it a width, so
    // with one pane on screen it shrank to its content.
    test('the editor pane takes the width of the screen', async ({page}) => {
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

    // the top bar used to keep its desktop sizes on a phone: a 22px burger and
    // 34px icons against a 44px minimum. The breadcrumb links were the ones
    // nobody counted, because a bare anchor is inline and ignores a min-height.
    test('the top bar controls are big enough to tap', async ({page}) => {
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

    // Restore is an extra small button, 30px tall until a coarse pointer grows
    // it. It is also the one control here that rewrites the document.
    test('Restore is big enough to tap', async ({page}) => {
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
    // went down with the same effect. It is reached by a hash, which react
    // router replaces rather than pushes, and that still has to count as a move.
    test('the outline sheet opens from the top bar', async ({page}) => {
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
        const me = await (await page.request.get(MAIN.url.api('/me'))).json();
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

// the tree is behind a closed drawer on a phone and the document body carries
// no badge, so the topbar control is the one surface that answers "is this
// note at risk". These drive the remote project for that reason.
test.describe('mobile sync state', () => {
    const WIKI = MULTI.projects.wiki;
    const wiki = MULTI.extra.find((extra) => extra.name === 'wiki');
    const SYNC_DOC = 'e2e-mobile-sync.md';
    const SYNC_FOLDER = 'e2e-mobile-folder';

    test.beforeEach(async ({page}) => {
        restoreOrigin(wiki.origin);
        fs.writeFileSync(`${wiki.dir}/${SYNC_DOC}`, '# Mobile sync\n\nstarting point.\n', 'utf8');
        await signIn(page, {baseURL: MULTI.baseURL, from: WIKI.doc(SYNC_DOC)});
        await expect.poll(async () => syncErrorOf(page, WIKI), {timeout: 20_000}).toBe('');
    });

    test.afterEach(async ({page}) => {
        restoreOrigin(wiki.origin);
        fs.rmSync(`${wiki.dir}/${SYNC_DOC}`, {force: true});
        fs.rmSync(`${wiki.dir}/${SYNC_FOLDER}`, {recursive: true, force: true});
        await expect.poll(async () => syncErrorOf(page, WIKI), {timeout: 20_000}).toBe('');
    });

    // saveStuck writes one note through the editor with the origin already
    // broken, which is what puts its path in the unsynced set.
    async function saveStuck(page, contentPath, source) {
        await page.goto(WIKI.edit(contentPath));
        await setSource(page, source);
        await save(page);
    }

    test('the control and the banner reach a phone with the drawer shut', async ({page}) => {
        breakOrigin(wiki.origin);
        await saveStuck(page, SYNC_DOC, '# Mobile sync\n\nstuck.\n');

        await page.goto(WIKI.doc(SYNC_DOC));
        await expect(page.getByTestId('sync-control')).toHaveAttribute('data-here', 'true');
        await expect(page.getByTestId('project-alert')).toBeVisible();
        // the tree is behind a closed drawer, which is what makes the control
        // the one surface that speaks for this note
        await expect(page.getByTestId('sidebar')).toHaveCount(0);
        await shot(page, 'mobile-sync-control');

        await page.getByTestId('sync-control').tap();
        await expect(page.getByTestId('sync-popover')).toBeVisible();
        await shot(page, 'mobile-sync-popover');
    });

    // the root index and a folder index: on both the route path is not the
    // file, and a control that asked the route would stay silent about the very
    // note on screen
    test('an index note reaches the control on a phone too', async ({page}) => {
        breakOrigin(wiki.origin);
        // the root index belongs to the corpus and cannot be deleted between
        // runs, so the text carries a stamp: a save that writes the bytes the
        // file already holds stages nothing, commits nothing and is missing
        // from the very path set this asserts on
        await saveStuck(page, 'index.md', `# Remote page\n\nthe root index on a phone, stuck at ${Date.now()}.\n`);
        await saveStuck(page, `${SYNC_FOLDER}/index.md`, '# Guide\n\nthe folder index, stuck.\n');

        await page.goto(WIKI.home());
        await expect(page.getByTestId('sync-control')).toHaveAttribute('data-here', 'true');
        await expect(page.getByTestId('project-alert')).toBeVisible();

        await page.goto(WIKI.dir(SYNC_FOLDER));
        await expect(page.getByTestId('sync-control')).toHaveAttribute('data-here', 'true');
        await shot(page, 'mobile-sync-folder-index');
    });

    // the one element this feature spends on a nowrap row that is already full
    test('the top bar still fits with the control up', async ({page}) => {
        breakOrigin(wiki.origin);
        await saveStuck(page, SYNC_DOC, '# Mobile sync\n\nstuck.\n');

        await page.goto(WIKI.doc(SYNC_DOC));
        await expect(page.getByTestId('sync-control')).toBeVisible();
        await expectNoHorizontalScroll(page);

        const offenders = await tooSmall(page, '[data-testid=topbar] button, [data-testid=topbar] a');
        await shot(page, 'mobile-sync-tap-targets');
        expect(offenders, 'elements smaller than the touch minimum').toEqual([]);
    });
});

// syncErrorOf reads the state the page itself polls, so a wait for the server's
// own rhythm is honest rather than a sleep.
async function syncErrorOf(page, project) {
    return page.evaluate(async (url) => {
        const res = await fetch(url, {headers: {accept: 'application/json'}});
        const body = await res.json();
        return body.project.sync_error;
    }, project.api('/me'));
}
