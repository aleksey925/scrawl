const {expect, test} = require('../support/test');

const fs = require('fs');

const docs = require('../support/docs');
const {breakOrigin, restoreOrigin} = require('../support/git');
const {
    DIALOG_TITLE, HISTORY, MAIN, MOVE_WAIT_MS, MULTI, PAST_DRAFT_DELAY_MS, READONLY, atHome, dialogButtons, expectNoHorizontalScroll, fixtureFile, headingAnchorGeometry, inStep,
    holdRoute, mockMe, nameOf, okToast, readFixture, recordMoves, refuseDrafts, removeFixture, rgb, routes, save, setSource, shot, signIn, sourceText, stays, titleRoom, writeFixture,
} = require('../support/helpers');
const text = require('../support/text');
const {user} = require('../support/env');
const lightTheme = require('../../internal/theme/themes/light.json');

const MIN_TAP = 44;
const BUTTON_HEIGHT = 40;
const CHOICE_HEIGHT = 36;
const ROW_HEIGHT = 48;
const NO_LINE = 'rgba(0, 0, 0, 0)';
const PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const DOC = docs.doc.path;
const SCRATCH = 'e2e-mobile/zametka.md';
const EMPTY_FOLDER = 'e2e-mobile/pusto';
const HISTORY_FOLDER = 'e2e-mobile-history';
const HISTORY_DOC = `${HISTORY_FOLDER}/versions.md`;
const DIAGRAM_NOTE = 'e2e-mobile-diagram.md';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) '
    + 'Chrome/131.0.0.0 Mobile Safari/537.36';

async function tooSmall(page, selector, min = MIN_TAP) {
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
    }, [selector, min]);
}

async function openedMenu(page, testId) {
    const menu = page.getByTestId(testId);
    await expect(menu).toBeVisible();
    await expect.poll(() => menu.evaluate((el) => getComputedStyle(el).transform))
        .toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
}

async function namingBand(row) {
    return row.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const group = el.parentElement.getBoundingClientRect();
        const below = el.nextElementSibling;
        const separatorOf = (item) => getComputedStyle(item, '::after').display;
        return {
            band: {
                edges: [rect.left, rect.right],
                background: getComputedStyle(el).backgroundColor,
                height: rect.height,
                separators: [separatorOf(el), separatorOf(below)],
            },
            group: [group.left, group.right],
            rowHeight: below.getBoundingClientRect().height,
        };
    });
}

async function openProfile(page) {
    await page.goto(routes.home());
    await page.getByTestId('tab-profile').tap();
    await expect(page.getByTestId('profile-page')).toBeVisible();
}

const LONG_PRESS_HOLD = 700;
const SETTLE_WAIT_MS = 800;

async function longPress(page, x, y) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x, y}]});
    await page.waitForTimeout(LONG_PRESS_HOLD);
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
}

async function touchDrag(page, from, to, {steps = 10, pauseMs = 0} = {}) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [from]});
    for (let index = 1; index <= steps; index += 1) {
        const point = {x: from.x + ((to.x - from.x) * index) / steps, y: from.y + ((to.y - from.y) * index) / steps};
        await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [point]});
        if (pauseMs > 0) {
            await page.waitForTimeout(pauseMs);
        }
    }
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
}

async function forcePress(page) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const {root} = await cdp.send('DOM.getDocument');
    return async (selector) => {
        const {nodeId} = await cdp.send('DOM.querySelector', {nodeId: root.nodeId, selector});
        await cdp.send('CSS.forcePseudoState', {nodeId, forcedPseudoClasses: ['active']});
    };
}

function hitsDown(page, x, box) {
    return page.evaluate(([left, heights]) => heights.map((y) => document.elementFromPoint(left, y)?.dataset.testid),
        [x, [box.y, box.y + box.height / 2, box.y + box.height - 1]]);
}

async function pressedBand(page, selector) {
    const element = page.locator(selector).first();
    await expect(element).toBeVisible();
    const press = await forcePress(page);
    await press(selector);
    await expect.poll(() => element.evaluate((el) => getComputedStyle(el, '::before').opacity)).toBe('1');
    return element.evaluate((el) => {
        const band = getComputedStyle(el, '::before');
        const row = el.getBoundingClientRect();
        return [row.left + parseFloat(band.left), row.right - parseFloat(band.right)];
    });
}

async function asStandalone(page) {
    await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', {value: true}));
}

async function boxOf(page, testId) {
    const box = await page.getByTestId(testId).boundingBox();
    return {
        left: Math.round(box.x), top: Math.round(box.y),
        right: Math.round(box.x + box.width), bottom: Math.round(box.y + box.height),
    };
}

function wayBack(page, testId) {
    return page.getByTestId(testId).evaluate((el) => {
        const arrow = el.querySelector('svg').getBoundingClientRect();
        return {left: Math.round(arrow.left), size: Math.round(arrow.width), color: getComputedStyle(el).color};
    });
}

function textEdges(page, testId) {
    return page.getByTestId(testId).evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const box = range.getBoundingClientRect();
        return {left: Math.round(box.left), right: Math.round(box.right)};
    });
}

function editorFit(page) {
    return page.evaluate(() => {
        const boxOfId = (testId) => document.querySelector(`[data-testid="${testId}"]`)?.getBoundingClientRect();
        const source = boxOfId('editor-source');
        const strip = boxOfId('editor-strip');
        const alert = boxOfId('space-alert');
        return {
            sourceOverStrip: Math.round(source.bottom) <= Math.round(strip.top),
            alertOverSource: alert === undefined ? 'no banner' : Math.round(alert.bottom) <= Math.round(source.top),
            scroll: document.documentElement.scrollHeight - window.innerHeight,
        };
    });
}

async function fakeVisibleArea(page) {
    await page.addInitScript(() => {
        const view = Object.assign(new EventTarget(), {
            offsetTop: 0, offsetLeft: 0, width: window.innerWidth, height: window.innerHeight, scale: 1,
        });
        Object.defineProperty(window, 'visualViewport', {value: view, configurable: true});
    });
}

function moveVisibleArea(page, top, height) {
    return page.evaluate(({offsetTop, visible}) => {
        Object.assign(window.visualViewport, {offsetTop, height: visible});
        window.visualViewport.dispatchEvent(new Event('resize'));
    }, {offsetTop: top, visible: height});
}

function readingPlace(page, note = '[data-testid=doc]') {
    return page.evaluate((selector) => {
        const top = document.querySelector('header').getBoundingClientRect().bottom;
        const root = document.querySelector(selector);
        const block = root === null ? undefined : [...root.children].find((child) => child.getBoundingClientRect().bottom > top);
        return block === undefined
            ? null
            : {text: block.textContent.trim().slice(0, 40), offset: Math.round(block.getBoundingClientRect().top - top)};
    }, note);
}

async function settled(page) {
    await expect.poll(() => page.evaluate(() => document.getAnimations()
        .filter((animation) => animation.playState === 'running').length)).toBe(0);
}

test.describe('mobile', () => {
    test.beforeEach(async ({page}) => {
        await signIn(page);
    });

    test.afterAll(() => {
        fs.rmSync(fixtureFile('e2e-mobile'), {recursive: true, force: true});
        fs.rmSync(fixtureFile(HISTORY_FOLDER, HISTORY), {recursive: true, force: true});
        removeFixture(DIAGRAM_NOTE);
    });

    test('the tab bar floats at the bottom with Notes, Search and Profile, and the round New beside it', async ({page}) => {
        // act
        await page.goto(routes.home());

        // assert
        const bar = page.getByTestId('tab-bar');
        await expect(bar.locator(':scope > :is(button, a) > :last-child')).toHaveText(['Notes', 'Search', 'Profile']);
        const {width, height} = page.viewportSize();
        const box = await bar.boundingBox();
        const plus = await page.getByTestId('tab-new').boundingBox();
        expect([Math.round(box.x), Math.round(plus.x + plus.width)]).toEqual([16, width - 16]);
        expect(Math.round(box.x + box.width)).toBeLessThan(Math.round(plus.x));
        expect([Math.round(box.y + box.height), Math.round(plus.y + plus.height)]).toEqual([height - 8, height - 8]);
        expect([Math.round(plus.width), Math.round(plus.height)]).toEqual([Math.round(box.height), Math.round(box.height)]);
        await expect(page.getByTestId('tab-new')).toHaveAttribute('aria-label', 'New');
        await expect(bar).toHaveCSS('border-radius', `${box.height / 2}px`);
        await expect(page.locator('[data-screen]')).toHaveCSS('padding-bottom', `${Math.round(height - box.y) + 12 + 16}px`);
        await expect(page.getByTestId('sidebar')).toHaveCount(0);
        await expect(page.getByTestId('topbar-burger')).toHaveCount(0);
        expect(await tooSmall(page, ':is([data-testid=tab-bar] button, [data-testid=tab-new])')).toEqual([]);
        await shot(page, 'mobile-tab-bar');
    });

    test('the current tab is an accent pill with a filled icon and a bold label, the others plain', async ({page}) => {
        // arrange
        const names = ['notes', 'search', 'profile'];
        const look = (name) => page.getByTestId(`tab-${name}`).evaluate((el) => {
            const style = getComputedStyle(el);
            return {
                color: style.color,
                weight: getComputedStyle(el.lastElementChild).fontWeight,
                ground: style.backgroundColor,
                border: style.borderStyle,
                shadow: style.boxShadow,
                outline: style.outlineStyle,
            };
        });
        const looks = async () => Object.fromEntries(
            await Promise.all(names.map(async (tab) => [tab, await look(tab)])));
        const drawing = (name) => page.getByTestId(`tab-${name}`).locator('svg').innerHTML();
        const bare = {border: 'none', shadow: 'none', outline: 'none'};
        const expected = (current) => Object.fromEntries(names.map((tab) => [tab, tab === current
            ? {...bare, color: rgb(lightTheme.palette.accent), weight: '600', ground: rgb(lightTheme.palette.tabCurrent)}
            : {...bare, color: rgb(lightTheme.palette.icon), weight: '400', ground: NO_LINE}]));
        await page.goto(routes.home());
        await expect(page.getByTestId('tab-notes')).toHaveAttribute('data-current', 'true');

        // act
        const seen = {notes: await looks()};
        await shot(page, 'mobile-tab-current');
        const filled = await drawing('notes');
        await page.getByTestId('tab-profile').tap();
        await expect(page).toHaveURL(routes.profile());
        await expect(page.getByTestId('tab-profile')).toHaveAttribute('data-current', 'true');
        await settled(page);
        seen.profile = await looks();
        const regular = await drawing('notes');

        // assert
        expect(seen).toEqual({notes: expected('notes'), profile: expected('profile')});
        expect(filled).not.toBe(regular);
        const user = await page.getByTestId('profile-user').textContent();
        await expect(page.getByTestId('tab-profile').getByTestId('avatar')).toHaveText(user.charAt(0).toUpperCase());
    });

    test('the keyboard focus ring of a tab stays inside the screen', async ({page}) => {
        // arrange
        await page.goto(routes.home());
        const first = page.getByTestId('tab-notes');
        await expect(first).toBeVisible();
        await page.keyboard.press('Tab');

        // act
        await first.focus();

        // assert
        await expect(first).toHaveCSS('outline-style', 'solid');
        await expect(first).toHaveCSS('outline-offset', '-2px');
        const box = await first.boundingBox();
        expect(box.x >= 0 && box.y + box.height <= page.viewportSize().height).toBe(true);
    });

    test('the keyboard focus ring of the way up stays inside the bar', async ({page}) => {
        // arrange
        await page.goto(routes.doc(DOC));
        const up = page.getByTestId('topbar-up');
        await expect(up).toBeVisible();
        await page.keyboard.press('Tab');

        // act
        await up.focus();

        // assert
        await expect(up).toHaveCSS('outline-style', 'solid');
        await expect(up).toHaveCSS('outline-offset', '-2px');
        const bar = await page.getByTestId('topbar').boundingBox();
        const box = await up.boundingBox();
        expect(box.y >= bar.y && box.y + box.height <= bar.y + bar.height).toBe(true);
    });

    test('the keyboard focus ring of Save stays inside the editor bar', async ({page}) => {
        // arrange
        writeFixture(SCRATCH, '# Заметка\n\nтекст\n');
        await page.goto(routes.edit(SCRATCH));
        const saveButton = page.getByTestId('editor-save');
        await setSource(page, '# Заметка\n\nновый текст\n');
        await expect(saveButton).toBeEnabled();
        await page.keyboard.press('Tab');

        // act
        await saveButton.focus();

        // assert
        await expect(saveButton).toHaveCSS('outline-style', 'solid');
        await expect(saveButton).toHaveCSS('outline-offset', '-2px');
        const bar = await page.getByTestId('topbar').boundingBox();
        const box = await saveButton.boundingBox();
        expect(box.y >= bar.y && box.y + box.height <= bar.y + bar.height).toBe(true);
    });

    test.describe('the action of the tab bar', () => {
        const cells = (page) => page.getByTestId('tab-bar').locator(':scope > :is(button, a)');

        test('a note and a file have their own action bar in place of the tabs, and the top bar keeps no action', async ({page}) => {
            // arrange
            const picture = 'e2e-mobile/action/picture.png';
            const textFile = 'e2e-mobile/action/plain.txt';
            const app = 'e2e-mobile/action/index.html';
            writeFixture(picture, 'not really a png');
            writeFixture(textFile, 'just text\n');
            writeFixture(app, '<!doctype html><h1>App</h1>\n');
            const actionsOf = (testId) => page.getByTestId(testId).locator(':scope > :is(button, a)')
                .evaluateAll((items) => items.map((el) => el.dataset.testid));
            const topActions = page.getByTestId('topbar-actions').locator('a, button');

            // act & assert
            await page.goto(routes.doc(DOC));
            await expect.poll(() => actionsOf('note-bar')).toEqual(['note-bar-outline', 'note-bar-find', 'note-bar-edit', 'note-menu']);
            await expect(page.getByTestId('note-bar-edit')).toHaveAttribute('href', routes.edit(DOC));
            await expect(page.getByTestId('tab-bar')).toHaveCount(0);
            await expect(topActions).toHaveCount(0);
            expect(await tooSmall(page, '[data-testid=note-bar] > *')).toEqual([]);
            await shot(page, 'mobile-note-bar');

            await page.goto(routes.doc(textFile));
            await expect(page.getByTestId('file')).toBeVisible();
            await expect.poll(() => actionsOf('file-bar')).toEqual(['file-bar-edit', 'file-menu']);
            await expect(page.getByTestId('file-bar-edit')).toHaveAttribute('href', routes.edit(textFile));
            await expect(topActions).toHaveCount(0);

            await page.goto(routes.doc(app));
            await expect.poll(() => actionsOf('file-bar')).toEqual(['file-bar-run', 'file-bar-edit', 'file-menu']);

            await page.goto(routes.doc(picture));
            await expect(page.getByTestId('file')).toHaveAttribute('data-type', 'image');
            await expect.poll(() => actionsOf('file-bar')).toEqual(['file-menu']);
            await expect(page.getByTestId('tab-bar')).toHaveCount(0);
            removeFixture('e2e-mobile/action');
        });

        test('the bar of a note or a file hugs its buttons in the middle, on the line of the tab bar', async ({page}) => {
            // arrange
            const app = 'e2e-mobile/hug/index.html';
            writeFixture(app, '<!doctype html><h1>App</h1>\n');
            const width = page.viewportSize().width;
            const geometryOf = (testId) => page.getByTestId(testId).evaluate((bar) => {
                const box = bar.getBoundingClientRect();
                const buttons = Array.from(bar.children).map((el) => {
                    const rect = el.getBoundingClientRect();
                    return [rect.width, rect.height];
                });
                return {left: box.left, right: box.right, height: box.height, bottom: box.bottom, buttons};
            });
            await page.goto(routes.home());
            const tabs = await page.getByTestId('tab-bar').boundingBox();

            // act
            await page.goto(routes.doc(DOC));
            await expect(page.getByTestId('note-menu')).toBeVisible();
            const note = await geometryOf('note-bar');
            await page.goto(routes.doc(app));
            await expect(page.getByTestId('file-bar-run')).toBeVisible();
            const file = await geometryOf('file-bar');

            // assert
            expect(note).toEqual({
                left: (width - 216) / 2, right: (width + 216) / 2, height: 52, bottom: tabs.y + tabs.height,
                buttons: [[52, 44], [52, 44], [52, 44], [52, 44]],
            });
            expect(file).toEqual({
                left: (width - 164) / 2, right: (width + 164) / 2, height: 52, bottom: tabs.y + tabs.height,
                buttons: [[52, 44], [52, 44], [52, 44]],
            });
            removeFixture('e2e-mobile/hug');
        });

        test('a reader of a read-only space sees no Edit in the bar of a note and no write in its sheet', async ({page}) => {
            // arrange
            await mockMe(page, {}, {read_only: true});
            await page.goto(routes.doc(DOC));

            // act
            await page.getByTestId('note-menu').tap();

            // assert
            await openedMenu(page, 'note-menu-dropdown');
            const actionsOf = page.getByTestId('note-bar').locator(':scope > :is(button, a)');
            expect(await actionsOf.evaluateAll((items) => items.map((el) => el.dataset.testid)))
                .toEqual(['note-bar-outline', 'note-bar-find', 'note-menu']);
            for (const testId of ['note-menu-rename', 'note-menu-move', 'note-menu-delete']) {
                await expect(page.getByTestId(testId)).toHaveCount(0);
            }
            await expect(page.getByTestId('note-menu-copy-link')).toBeVisible();
        });

        test('a reader of a read-only space sees no Edit in the bar of a text file and no write in its sheet', async ({page}) => {
            // arrange
            const textFile = 'e2e-mobile/reader/plain.txt';
            writeFixture(textFile, 'just text\n');
            await mockMe(page, {}, {read_only: true});
            await page.goto(routes.doc(textFile));
            await expect(page.getByTestId('file')).toBeVisible();

            // act
            await page.getByTestId('file-menu').tap();

            // assert
            await openedMenu(page, 'file-menu-dropdown');
            const actionsOf = page.getByTestId('file-bar').locator(':scope > :is(button, a)');
            expect(await actionsOf.evaluateAll((items) => items.map((el) => el.dataset.testid))).toEqual(['file-menu']);
            for (const testId of ['file-menu-rename', 'file-menu-move', 'file-menu-delete']) {
                await expect(page.getByTestId(testId)).toHaveCount(0);
            }
            await expect(page.getByTestId('file-download')).toBeVisible();
            removeFixture('e2e-mobile/reader');
        });

        test('New is gone in a read-only space, and the tab bar takes the whole width', async ({page}) => {
            // arrange
            await mockMe(page, {}, {read_only: true});

            // act
            await page.goto(routes.home());

            // assert
            await expect(cells(page).locator(':scope > :last-child')).toHaveText(['Notes', 'Search', 'Profile']);
            await expect(page.getByTestId('tab-new')).toHaveCount(0);
            const width = page.viewportSize().width;
            const bar = await page.getByTestId('tab-bar').boundingBox();
            expect([Math.round(bar.x), Math.round(bar.x + bar.width)]).toEqual([16, width - 16]);
            const boxes = await cells(page).evaluateAll((items) => items.map((el) => Math.round(el.getBoundingClientRect().width)));
            expect(new Set(boxes).size).toBe(1);
        });

        test('New opens the create sheet with two tiles, a tap on the scrim only closes it, and so does Escape', async ({page}) => {
            // arrange
            const folder = 'e2e-mobile/tiles';
            writeFixture(`${folder}/under.md`, '# Under\n');
            await page.goto(routes.dir(folder));
            const sheet = page.getByTestId('new-menu');

            // act & assert
            await page.getByTestId('tab-new').tap();
            await openedMenu(page, 'new-menu');
            await expect(sheet.getByRole('heading')).toHaveText(`Create in ${nameOf(folder)}`);
            await expect(sheet.locator('[data-testid^=new-menu-]')).toHaveText([text.create.folder, text.create.note]);
            await expect(sheet.locator(':focus')).toHaveCount(1);
            const width = page.viewportSize().width;
            const noteTile = await page.getByTestId('new-menu-note').boundingBox();
            const folderTile = await page.getByTestId('new-menu-folder').boundingBox();
            expect([Math.round(folderTile.x), Math.round(noteTile.x + noteTile.width)]).toEqual([16, width - 16]);
            expect([folderTile.y, folderTile.height]).toEqual([noteTile.y, noteTile.height]);
            await expect(page.getByTestId('new-menu-note')).toHaveCSS('background-color', rgb(lightTheme.palette.groupedCard));
            await expect(page.getByTestId('new-menu-folder')).toHaveCSS('background-color', rgb(lightTheme.palette.groupedCard));
            const icon = await page.getByTestId('new-menu-note').locator('svg').boundingBox();
            expect([icon.width, icon.height]).toEqual([26, 26]);
            await shot(page, 'mobile-new-sheet');

            await page.getByTestId('new-scrim').tap({position: {x: 40, y: 40}});
            await expect(sheet).toHaveCount(0);
            await stays(() => new URL(page.url()).pathname, routes.dir(folder), MOVE_WAIT_MS);

            await page.getByTestId('tab-new').tap();
            await openedMenu(page, 'new-menu');
            await page.keyboard.press('Escape');
            await expect(sheet).toHaveCount(0);
            await expect(page.getByTestId('tab-new')).toBeFocused();
            removeFixture(folder);
        });
    });

    test.describe('on Android', () => {
        test.use({userAgent: ANDROID});

        test('an html app runs under one bar with no tab bar', async ({page}) => {
            // arrange
            writeFixture('e2e-mobile/app/index.html', '<!doctype html><h1 id="title">Phone app</h1>\n');
            await page.goto(routes.doc('e2e-mobile/app/index.html'));

            // act
            await page.getByTestId('file-bar-run').tap();

            // assert
            await expect(page.frameLocator('[data-testid=run-frame]').locator('#title')).toHaveText('Phone app');
            await expect(page.getByTestId('tab-bar')).toHaveCount(0);
            const bar = await boxOf(page, 'run-bar');
            const frame = await boxOf(page, 'run-frame');
            expect(bar.top).toBe(0);
            expect(frame.top).toBe(bar.bottom);
            expect(frame.bottom).toBe(page.viewportSize().height);
            expect(await tooSmall(page, '[data-testid=run-bar] a, [data-testid=run-bar] button')).toEqual([]);
            await expect(page.getByTestId('run-bar')).toHaveCSS('position', 'fixed');
            await shot(page, 'mobile-html-app');
        });

        test('the bar of the run screen is as tall as the other bars, and its way back is drawn as the reader\'s', async ({page}) => {
            // arrange
            writeFixture('e2e-mobile/app/index.html', '<!doctype html><h1 id="title">Phone app</h1>\n');
            await page.goto(routes.doc('e2e-mobile/app/index.html'));
            const reader = await wayBack(page, 'topbar-up');
            const topbar = await page.getByTestId('topbar').boundingBox();
            const titleSize = await page.getByTestId('topbar-title').evaluate((el) => getComputedStyle(el).fontSize);

            // act
            await page.getByTestId('file-bar-run').tap();

            // assert
            await expect(page.getByTestId('run-bar')).toBeVisible();
            expect(await wayBack(page, 'run-back')).toEqual(reader);
            expect((await page.getByTestId('run-bar').boundingBox()).height).toBe(topbar.height);
            await expect(page.getByTestId('run-name')).toHaveCSS('font-size', titleSize);
            expect(await page.getByTestId('run-open-outside').evaluate((el) => Math.round(el.querySelector('svg').getBoundingClientRect().right)))
                .toBe(page.viewportSize().width - reader.left);
        });
    });

    test('an html file in a folder list has a Run button that starts it in a tab on an iPhone', async ({page, context}) => {
        // arrange
        writeFixture('e2e-mobile/app/index.html', '<!doctype html><h1 id="title">Phone app</h1>\n');
        writeFixture('e2e-mobile/app/style.css', 'h1 { color: inherit; }\n');
        await page.goto(routes.dir('e2e-mobile/app'));

        // act & assert
        const row = page.locator('[data-testid=dir-row][data-path="e2e-mobile/app/index.html"]');
        await expect(row.getByTestId('dir-row-run')).toHaveText('Run');
        await expect(row.getByTestId('dir-row-run')).toHaveCSS('text-transform', 'none');
        await expect(page.locator('[data-testid=dir-row][data-path="e2e-mobile/app/style.css"]').getByTestId('dir-row-run'))
            .toHaveCount(0);
        await shot(page, 'mobile-html-app-run-button');
        const [tab] = await Promise.all([context.waitForEvent('page'), row.getByTestId('dir-row-run').tap()]);
        await expect(tab.locator('#title')).toHaveText('Phone app');
        await expect(page).toHaveURL(routes.dir('e2e-mobile/app'));
    });

    test('a pressed Run takes the press alone, and its row stays as it is', async ({page}) => {
        // arrange
        writeFixture('e2e-mobile/app/index.html', '<!doctype html><h1 id="title">Phone app</h1>\n');
        await page.goto(routes.dir('e2e-mobile/app'));
        const row = '[data-testid=dir-row][data-path="e2e-mobile/app/index.html"]';
        const run = `${row} [data-testid=dir-row-run]`;
        await expect(page.locator(run)).toBeVisible();
        const press = await forcePress(page);
        const band = () => page.locator(row).evaluate((el) => getComputedStyle(el, '::before').opacity);

        // act & assert
        await press(row);
        await expect.poll(band).toBe('1');
        await press(run);
        await expect(page.locator(run)).toHaveCSS('background-color', rgb(lightTheme.palette.pressed));
        await expect.poll(band).toBe('0');
        await stays(band, '0', 300);
    });

    test('a folder with an index.html has a Run button and a Run in its long press menu on an iPhone', async ({page, context}) => {
        // arrange
        writeFixture('e2e-mobile/runs/app/index.html', '<!doctype html><h1 id="title">Folder app</h1>\n');
        writeFixture('e2e-mobile/runs/plain/note.md', '# Plain\n');
        await page.goto(routes.dir('e2e-mobile/runs'));
        const row = page.locator('[data-testid=dir-row][data-path="e2e-mobile/runs/app"]');
        const plain = page.locator('[data-testid=dir-row][data-path="e2e-mobile/runs/plain"]');

        // act & assert
        await expect(row.getByTestId('dir-row-run')).toHaveText('Run');
        await expect(plain).toBeVisible();
        await expect(plain.getByTestId('dir-row-run')).toHaveCount(0);
        await shot(page, 'mobile-folder-run-button');
        const [fromButton] = await Promise.all([context.waitForEvent('page'), row.getByTestId('dir-row-run').tap()]);
        await expect(fromButton.locator('#title')).toHaveText('Folder app');
        await fromButton.close();

        const box = await row.boundingBox();
        await longPress(page, box.x + 80, box.y + box.height / 2);
        await openedMenu(page, 'tree-row-menu-dropdown');
        await expect(page.getByTestId('tree-row-menu-dropdown').locator('[data-testid^="tree-row-menu-"]'))
            .toHaveText(['Open', 'Run', 'Rename', 'Move to…', 'Copy link', 'Delete']);
        const [fromMenu] = await Promise.all([context.waitForEvent('page'), page.getByTestId('tree-row-menu-run').tap()]);
        await expect(fromMenu.locator('#title')).toHaveText('Folder app');
        await fromMenu.close();
        await expect(page).toHaveURL(routes.dir('e2e-mobile/runs'));

        await expect(page.getByTestId('tree-row-menu-dropdown')).toHaveCount(0);
        await row.getByTestId('dir-row-name').tap();
        await expect(page).toHaveURL(routes.dir('e2e-mobile/runs/app'));
    });

    test('Notes opens the root list, a folder opens its list, and the back link goes up', async ({page}) => {
        // arrange
        await page.goto(routes.dir(docs.deep.folder));

        // act & assert
        await page.getByTestId('tab-notes').tap();
        await expect(page).toHaveURL(atHome());
        const folder = page.locator(`[data-testid=dir-row][data-path="${docs.folder.path}"]`);
        await expect(folder).toHaveText(docs.folder.name);
        await folder.tap();
        await expect(page).toHaveURL(MAIN.url.dir(docs.folder.path));
        await expect(page.getByTestId('dir-up')).toHaveCount(0);
        await expect(page.getByTestId('dir-new')).toHaveCount(0);
        await expect(page.locator(`[data-testid=dir-row][data-path="${docs.folder.entry}"]`)).toHaveText(docs.folder.entry.split('/').pop());
        await shot(page, 'mobile-folder-list');

        await page.getByTestId('topbar-up').tap();
        await expect(page).toHaveURL(atHome());
    });

    test('a pressed row of a list fills its row inside the white group', async ({page}) => {
        // arrange
        await page.goto(routes.home());
        const selector = `[data-testid=dir-row][data-path="${docs.folder.path}"]`;

        // act
        const edges = await pressedBand(page, selector);

        // assert
        const group = await page.getByTestId('dir-table').boundingBox();
        expect(edges).toEqual([group.x, group.x + group.width]);
        await expect.poll(() => page.locator(selector).evaluate((el) => getComputedStyle(el, '::before').backgroundColor))
            .toBe(rgb(lightTheme.palette.rowPressed));
    });

    test('a list is one white group on the gray page, its separators starting at the text', async ({page}) => {
        // act
        await page.goto(routes.home());

        // assert
        const table = page.getByTestId('dir-table');
        await expect(table).toBeVisible();
        await expect(page.locator('main')).toHaveCSS('background-color', rgb(lightTheme.palette.groupedBg));
        await expect(table).toHaveCSS('background-color', rgb(lightTheme.palette.groupedCard));
        await expect(table).toHaveCSS('border-radius', '12px');
        const box = await table.boundingBox();
        expect([box.x, box.x + box.width]).toEqual([16, page.viewportSize().width - 16]);
        const separators = await table.locator('[data-testid=dir-row]').evaluateAll((rows) => rows.map((row) => {
            const line = getComputedStyle(row, '::after');
            return line.display === 'none' || line.content === 'none' ? 'none' : `${line.left} ${line.borderTopColor}`;
        }));
        const line = `52px ${rgb(lightTheme.palette.groupedSeparator)}`;
        expect(separators).toEqual(['none', ...separators.slice(1).map(() => line)]);
        await expect(page.getByTestId('dir-row').first().locator('[data-testid=dir-row-name]')).toHaveCSS('font-size', '17px');
    });

    test('a pressed row of Recent is one band from edge to edge of the screen too', async ({page}) => {
        // arrange
        await page.goto(routes.doc(DOC));
        await expect(page.getByTestId('doc')).toBeVisible();
        await page.goto(routes.recent());

        // act
        const edges = await pressedBand(page, '[data-testid=recent-item]');

        // assert
        expect(edges).toEqual([0, page.viewportSize().width]);
    });

    test('a finger resting on a row shrinks it a little', async ({page}) => {
        // arrange
        await page.goto(routes.home());
        const folder = page.locator(`[data-testid=dir-row][data-path="${docs.folder.path}"]`);
        const box = await folder.boundingBox();
        const cdp = await page.context().newCDPSession(page);

        // act
        await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchStart', touchPoints: [{x: box.x + 80, y: box.y + box.height / 2}],
        });

        // assert
        const scale = () => folder.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);
        await expect.poll(scale, {timeout: 450, intervals: [50]}).toBeLessThan(1);
        await cdp.send('Input.dispatchTouchEvent', {type: 'touchCancel', touchPoints: []});
    });

    test('a finger that only taps a row does not shrink it', async ({page}) => {
        // arrange
        await page.goto(routes.home());
        const folder = page.locator(`[data-testid=dir-row][data-path="${docs.folder.path}"]`);
        const box = await folder.boundingBox();
        const cdp = await page.context().newCDPSession(page);

        // act
        await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchStart', touchPoints: [{x: box.x + 80, y: box.y + box.height / 2}],
        });
        await page.waitForTimeout(100);

        // assert
        await expect(folder).toHaveAttribute('data-holding', 'true');
        const transforms = await folder.evaluate((el) => [el, el.querySelector('a')].map((node) => getComputedStyle(node).transform));
        expect(transforms.filter((value) => !/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/.test(value))).toEqual([]);
        await cdp.send('Input.dispatchTouchEvent', {type: 'touchCancel', touchPoints: []});
    });

    test('a screen opened slides in from the right, one gone back to from the left, a tab not at all', async ({page}) => {
        // arrange
        await page.addInitScript(() => {
            window.moves = [];
            window.timings = [];
            const animate = Element.prototype.animate;
            Element.prototype.animate = function (keyframes, options) {
                if (Array.isArray(keyframes) && String(keyframes[0]?.transform).startsWith('translateX')) {
                    window.moves.push(keyframes[0].transform);
                    window.timings.push({opacity: keyframes[0].opacity, duration: options.duration, easing: options.easing});
                }
                return animate.call(this, keyframes, options);
            };
        });
        await page.goto(routes.home());
        const folder = page.locator(`[data-testid=dir-row][data-path="${docs.folder.path}"]`);
        const moves = () => page.evaluate(() => window.moves);

        // act & assert
        await folder.tap();
        await expect(page).toHaveURL(MAIN.url.dir(docs.folder.path));
        await expect.poll(moves).toEqual(['translateX(28%)']);
        await page.getByTestId('topbar-up').tap();
        await expect(page).toHaveURL(atHome());
        await expect.poll(moves).toEqual(['translateX(28%)', 'translateX(-28%)']);
        await page.getByTestId('tab-profile').tap();
        await expect(page.getByTestId('tab-profile')).toHaveAttribute('data-current', 'true');
        await page.getByTestId('tab-notes').tap();
        await expect(page).toHaveURL(atHome());
        expect(await moves()).toEqual(['translateX(28%)', 'translateX(-28%)']);
        await expect.poll(() => page.locator('[data-screen]').evaluate((el) => [el.style.transform, el.style.opacity]))
            .toEqual(['', '']);
        const easeOut = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)';
        expect(await page.evaluate(() => window.timings)).toEqual([
            {opacity: '0', duration: 300, easing: easeOut},
            {opacity: '1', duration: 300, easing: easeOut},
        ]);
    });

    test('the note an editor is left for slides in from the left', async ({page}) => {
        // arrange
        await page.addInitScript(() => {
            window.moves = [];
            const animate = Element.prototype.animate;
            Element.prototype.animate = function (keyframes, options) {
                if (Array.isArray(keyframes) && String(keyframes[0]?.transform).startsWith('translateX')) {
                    window.moves.push(keyframes[0].transform);
                }
                return animate.call(this, keyframes, options);
            };
        });
        const moves = () => page.evaluate(() => window.moves);
        await page.goto(MAIN.url.dir(docs.doc.folder));
        await page.locator(`[data-testid=dir-row][data-path="${DOC}"]`).tap();
        await expect.poll(moves).toEqual(['translateX(28%)']);
        await page.getByTestId('note-bar-edit').tap();
        await expect(page.getByTestId('editor')).toBeVisible();

        // act
        await page.getByTestId('editor-cancel').tap();

        // assert
        await expect(page).toHaveURL(MAIN.url.doc(DOC));
        await expect.poll(moves).toEqual(['translateX(28%)', 'translateX(-28%)']);
    });

    test('the way up to a folder the history wrote in another way slides in from the left', async ({page}) => {
        // arrange
        const above = 'e2e-mobile/up(1)';
        writeFixture(`${above}/note.md`, '# Up\n');
        await page.addInitScript(() => {
            window.moves = [];
            const animate = Element.prototype.animate;
            Element.prototype.animate = function (keyframes, options) {
                if (Array.isArray(keyframes) && String(keyframes[0]?.transform).startsWith('translateX')) {
                    window.moves.push(keyframes[0].transform);
                }
                return animate.call(this, keyframes, options);
            };
        });
        const moves = () => page.evaluate(() => window.moves);
        await page.goto(MAIN.url.dir(above).replace('(1)', '%281%29'));
        await page.locator(`[data-screen] [data-testid=dir-row][data-path="${above}/note.md"]`).tap();
        await expect(page.locator('[data-screen] [data-testid=doc]')).toBeVisible();
        await expect.poll(moves).toEqual(['translateX(28%)']);

        // act
        await page.getByTestId('topbar-up').tap();

        // assert
        await expect(page.locator(`[data-screen] [data-testid=dir-row][data-path="${above}/note.md"]`)).toBeVisible();
        await expect.poll(moves).toEqual(['translateX(28%)', 'translateX(-28%)']);
        removeFixture(above);
    });

    test('a back the browser takes moves nothing in a tab, and slides in from the left in an app', async ({page}) => {
        // arrange
        await page.addInitScript(() => {
            window.moves = [];
            const animate = Element.prototype.animate;
            Element.prototype.animate = function (keyframes, options) {
                if (Array.isArray(keyframes) && String(keyframes[0]?.transform).startsWith('translateX')) {
                    window.moves.push(keyframes[0].transform);
                }
                return animate.call(this, keyframes, options);
            };
        });
        const moves = () => page.evaluate(() => window.moves);
        const folder = page.locator(`[data-testid=dir-row][data-path="${docs.folder.path}"]`);
        await page.goto(routes.home());
        await folder.tap();
        await expect(page).toHaveURL(MAIN.url.dir(docs.folder.path));
        await expect.poll(moves).toEqual(['translateX(28%)']);

        // act & assert
        await page.goBack();
        await expect(folder).toBeVisible();
        await stays(moves, ['translateX(28%)'], 300);

        await asStandalone(page);
        await page.goto(routes.home());
        await folder.tap();
        await expect.poll(moves).toEqual(['translateX(28%)']);
        await page.goBack();
        await expect.poll(moves).toEqual(['translateX(28%)', 'translateX(-28%)']);
    });

    test.describe('a swipe from the left edge', () => {
        async function swipe(page, to, rest = 0) {
            const cdp = await page.context().newCDPSession(page);
            const y = 400;
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: 4, y}]});
            for (let step = 1; step <= 8; step++) {
                const x = 4 + ((to - 4) * step) / 8;
                await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x, y}]});
                await page.waitForTimeout(rest);
            }
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
        }

        const folder = () => MAIN.url.dir(docs.folder.path);

        async function inStandalone(page) {
            await asStandalone(page);
            await page.addInitScript(() => {
                document.addEventListener('touchstart', () => {
                    window.tappedMoving = Array.from(document.querySelectorAll('[data-screen], [data-leaving]'))
                        .flatMap((element) => element.getAnimations())
                        .some((animation) => animation.playState === 'running');
                }, {capture: true});
            });
        }

        async function swipeAndTap(page, testId) {
            const box = await page.getByTestId(testId).boundingBox();
            await swipe(page, 300);
            const cdp = await page.context().newCDPSession(page);
            const point = {x: box.x + box.width / 2, y: box.y + box.height / 2};
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [point]});
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
        }

        async function addTouchSender(page) {
            await page.evaluate(() => {
                window.sendTouch = (type, point, target = document.body) => {
                    const touches = point === undefined
                        ? []
                        : [new Touch({identifier: 1, target, clientX: point[0], clientY: point[1]})];
                    const event = new TouchEvent(type, {touches, changedTouches: touches, bubbles: true, cancelable: true});
                    target.dispatchEvent(event);
                    return event.defaultPrevented;
                };
            });
        }

        async function addEnteringWait(page) {
            await page.evaluate(() => {
                window.untilEntering = async () => {
                    const running = () => document.querySelector('[data-testid=doc]')?.closest('[data-screen]')?.getAnimations()
                        .some((animation) => animation.playState === 'running') === true;
                    for (let frame = 0; frame < 300 && !running(); frame++) {
                        await new Promise((resolve) => requestAnimationFrame(resolve));
                    }
                    return running();
                };
            });
        }

        async function touchesFrom(page, [start, ...moves], end = 'touchcancel') {
            await addTouchSender(page);
            return page.evaluate(async ({start, moves, end}) => {
                const send = window.sendTouch;
                send('touchstart', start);
                const taken = [];
                for (const point of moves) {
                    taken.push(send('touchmove', point));
                    await new Promise((resolve) => setTimeout(resolve, 16));
                }
                window.layer = document.querySelector('[data-screen]')?.style.willChange;
                window.shift = document.querySelector('[data-screen]')?.style.transform;
                send(end);
                return taken;
            }, {start, moves, end});
        }

        test('every move of a drag from the edge is the drag\'s, and the page is a layer while it is dragged', async ({page}) => {
            // arrange
            await asStandalone(page);
            await page.goto(folder());
            await expect(page.getByTestId('dir-row').first()).toBeVisible();

            // act
            const taken = await touchesFrom(page, [[4, 400], [7, 399], [10, 398], [20, 396], [40, 395], [80, 394]]);

            // assert
            expect(taken).toEqual([true, true, true, true, true]);
            expect(await page.evaluate(() => window.layer)).toBe('transform');
            await expect.poll(() => page.locator('[data-screen]').evaluate((el) => el.style.willChange)).toBe('');
        });

        test('a drag that starts while the next screen still slides in takes it where it is and moves it with the finger', async ({page}) => {
            // arrange
            await asStandalone(page);
            await page.goto(folder());
            await addTouchSender(page);
            await addEnteringWait(page);
            await page.locator(`[data-testid=dir-row][data-path="${docs.folder.entry}"]`).tap();

            // act
            const drag = await page.evaluate(async () => {
                const send = window.sendTouch;
                const entering = await window.untilEntering();
                const shift = () => new DOMMatrix(getComputedStyle(document.querySelector('[data-screen]')).transform).m41;
                send('touchstart', [4, 400]);
                send('touchmove', [10, 400]);
                const before = shift();
                send('touchmove', [20, 400]);
                const taken = shift();
                for (const x of [40, 70, 104]) {
                    await new Promise((resolve) => setTimeout(resolve, 16));
                    send('touchmove', [x, 400]);
                }
                const moved = shift();
                send('touchcancel');
                return {entering, shifted: before > 0, jump: Math.round(taken - before), followed: Math.round(moved - taken)};
            });

            // assert
            expect(drag).toEqual({entering: true, shifted: true, jump: 0, followed: 84});
        });

        test('a short slow drag of a screen still sliding in puts the page back when let go', async ({page}) => {
            // arrange
            await asStandalone(page);
            await page.goto(folder());
            await addTouchSender(page);
            await addEnteringWait(page);
            await page.locator(`[data-testid=dir-row][data-path="${docs.folder.entry}"]`).tap();

            // act
            const entering = await page.evaluate(async () => {
                const send = window.sendTouch;
                const entering = await window.untilEntering();
                send('touchstart', [4, 400]);
                send('touchmove', [10, 400]);
                send('touchmove', [20, 400]);
                await new Promise((resolve) => setTimeout(resolve, 60));
                send('touchmove', [24, 400]);
                send('touchend');
                return entering;
            });
            await settled(page);

            // assert
            expect(entering).toBe(true);
            await expect(page).toHaveURL(MAIN.url.doc(docs.folder.entry));
            await expect(page.getByTestId('doc').locator('xpath=ancestor::*[@data-screen]')).toHaveCSS('opacity', '1');
        });

        test('a swipe let go goes back only after its copy has started to move', async ({page}) => {
            // arrange
            await asStandalone(page);
            await page.goto(folder());
            await page.locator(`[data-testid=dir-row][data-path="${docs.folder.entry}"]`).tap();
            await expect(page.getByTestId('doc')).toBeVisible();
            await settled(page);
            await addTouchSender(page);
            await page.evaluate(() => {
                window.historyCalls = [];
                for (const name of ['back', 'go', 'pushState']) {
                    const original = history[name].bind(history);
                    history[name] = (...args) => {
                        window.historyCalls.push(name);
                        return original(...args);
                    };
                }
            });

            // act
            const seen = await page.evaluate(async () => {
                const send = window.sendTouch;
                send('touchstart', [4, 400]);
                for (const x of [20, 60, 120, 200]) {
                    await new Promise((resolve) => setTimeout(resolve, 16));
                    send('touchmove', [x, 400]);
                }
                send('touchend');
                const atEnd = [...window.historyCalls];
                await new Promise((resolve) => requestAnimationFrame(resolve));
                const moving = document.querySelector('[data-leaving]')?.getAnimations()
                    .some((animation) => animation.playState === 'running') === true;
                return {atEnd, inFrame: [...window.historyCalls], moving};
            });

            // assert
            expect(seen).toEqual({atEnd: [], inFrame: [], moving: true});
            await expect(page).toHaveURL(folder());
        });

        test('the page let go leaves as a copy over the page gone back to, with no empty screen between', async ({page}) => {
            // arrange
            await asStandalone(page);
            await page.goto(folder());
            await page.locator(`[data-testid=dir-row][data-path="${docs.folder.entry}"]`).tap();
            await expect(page.getByTestId('doc')).toBeVisible();
            await settled(page);
            await page.evaluate(() => {
                window.copyFrames = [];
                let seen = false;
                let after = 0;
                const onTop = (x) => {
                    const hit = document.elementFromPoint(x, 400);
                    const screen = hit?.closest('[data-screen]');
                    if (hit?.closest('[data-leaving]')) {
                        return 'copy';
                    }
                    return screen?.querySelector('[data-testid=dir-row]') && getComputedStyle(screen).visibility === 'visible'
                        ? 'list'
                        : 'nothing';
                };
                const watch = () => {
                    const cover = document.querySelector('[data-leaving]');
                    seen = seen || cover !== null;
                    after += seen && cover === null ? 1 : 0;
                    const edge = cover === null ? 0 : cover.getBoundingClientRect().left;
                    window.copyFrames.push({
                        copy: cover !== null,
                        left: onTop(20),
                        right: onTop(window.innerWidth - 10),
                        seam: edge > 4 ? onTop(edge - 2) : 'none',
                        opaque: cover === null || getComputedStyle(cover).backgroundColor !== 'rgba(0, 0, 0, 0)',
                        catches: cover === null || (!cover.inert && cover.firstElementChild.inert),
                        marks: cover === null ? 0 : cover.querySelectorAll('[id], [data-testid], [data-screen]').length
                            + (cover.matches('[id], [data-testid], [data-screen]') ? 1 : 0),
                    });
                    if (after < 5 && window.copyFrames.length < 600) {
                        requestAnimationFrame(watch);
                    } else {
                        window.watched = true;
                    }
                };
                requestAnimationFrame(watch);
            });

            // act
            await swipe(page, 300);

            // assert
            await expect.poll(() => page.evaluate(() => window.watched === true)).toBe(true);
            const frames = await page.evaluate(() => window.copyFrames);
            const from = frames.findIndex((snap) => snap.copy);
            const under = frames.findIndex((snap) => snap.copy && snap.left === 'list');
            expect(from).toBeGreaterThanOrEqual(0);
            expect(frames.filter((snap) => snap.copy).every((snap) => snap.opaque && snap.catches && snap.marks === 0)).toBe(true);
            expect(frames[from].right).toBe('copy');
            expect(under).toBeGreaterThanOrEqual(0);
            expect(frames.slice(under).filter((snap) => snap.left !== 'list' || snap.seam === 'nothing')).toEqual([]);
            expect(frames.at(-1)).toEqual({copy: false, left: 'list', right: 'list', seam: 'none', opaque: true, catches: true, marks: 0});
            await expect(page).toHaveURL(folder());
        });

        test('a diagram on the page let go keeps its look on the copy', async ({page}) => {
            // arrange
            const note = 'e2e-mobile/copy-diagram.md';
            writeFixture(note, '# Copy diagram\n\n```mermaid\ngraph TD\n  A --> B\n```\n');
            await asStandalone(page);
            await page.goto(MAIN.url.doc(note));
            const drawn = page.locator('[data-screen] .md-diagram[data-state="done"] svg');
            await expect(drawn).toBeVisible();
            await settled(page);
            const original = await drawn.evaluate((svg) => getComputedStyle(svg.querySelector('.node :is(rect, polygon, path)')).fill);
            await page.evaluate(() => {
                window.addEventListener('touchend', () => {
                    const svg = document.querySelector('[data-leaving] svg[id]');
                    window.copied = svg === null
                        ? null
                        : {fill: getComputedStyle(svg.querySelector('.node :is(rect, polygon, path)')).fill, id: svg.id};
                }, {once: true});
            });

            // act
            await swipe(page, 300);

            // assert
            await expect.poll(() => page.evaluate(() => window.copied)).toEqual({
                fill: original,
                id: expect.stringMatching(/^leaving-md-mermaid-/),
            });
            removeFixture(note);
        });

        test('a swipe back while Find is open slides away the line that was being read', async ({page}) => {
            // arrange
            await asStandalone(page);
            await page.goto(MAIN.url.doc(docs.long.path));
            await expect(page.getByTestId('doc')).toBeVisible();
            await settled(page);
            await page.evaluate(() => window.scrollTo({top: 1200, behavior: 'instant'}));
            await page.getByTestId('note-bar-find').tap();
            await expect(page.getByTestId('doc-find')).toBeVisible();
            const read = await readingPlace(page);
            await page.evaluate(() => {
                window.addEventListener('touchend', () => {
                    const top = document.querySelector('header').getBoundingClientRect().bottom;
                    const copy = document.querySelector('[data-leaving] .markdown-document');
                    const block = copy === null ? undefined : [...copy.children].find((child) => child.getBoundingClientRect().bottom > top);
                    window.copied = block === undefined
                        ? null
                        : {text: block.textContent.trim().slice(0, 40), offset: Math.round(block.getBoundingClientRect().top - top)};
                }, {once: true});
            });

            // act
            await swipe(page, 300);

            // assert
            await expect.poll(() => page.evaluate(() => window.copied)).toEqual(read);
        });

        test('a swipe back while Find is open at the top of a note slides away a copy as tall as the screen', async ({page}) => {
            // arrange
            await asStandalone(page);
            await page.goto(MAIN.url.doc(docs.long.path));
            await expect(page.getByTestId('doc')).toBeVisible();
            await settled(page);
            await page.getByTestId('note-bar-find').tap();
            await expect(page.getByTestId('doc-find')).toBeVisible();
            const screen = await page.locator('[data-screen]').evaluate((element) => Math.round(element.getBoundingClientRect().height));
            await page.evaluate(() => {
                window.addEventListener('touchend', () => {
                    const copy = document.querySelector('[data-leaving] > *');
                    window.copiedHeight = copy === null ? null : Math.round(copy.getBoundingClientRect().height);
                }, {once: true});
            });

            // act
            await swipe(page, 300);

            // assert
            await expect.poll(() => page.evaluate(() => window.copiedHeight)).toBe(screen);
        });

        test('a drag from the edge asks for the folder above before the page is let go', async ({page}) => {
            // arrange
            await asStandalone(page);
            await page.goto(MAIN.url.doc(docs.folder.entry));
            await expect(page.getByTestId('doc')).toBeVisible();
            await page.waitForLoadState('networkidle');
            const asked = page.waitForResponse((response) => response.url().includes(`/api/dir/${docs.folder.path}`));
            const cdp = await page.context().newCDPSession(page);
            const y = 400;
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: 4, y}]});
            for (const x of [10, 20, 40, 80]) {
                await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x, y}]});
            }
            await asked;
            const held = await holdRoute(page, /\/api\/dir\//);

            // act
            for (const x of [160, 240, 300]) {
                await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x, y}]});
            }
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});

            // assert
            await expect(page).toHaveURL(folder());
            await expect(page.locator(`[data-screen] [data-testid=dir-row][data-path="${docs.folder.entry}"]`)).toBeVisible();
            await expect(page.getByTestId('dir-loading')).toHaveCount(0);
            held.release();
        });

        test('a drag from the edge while the create sheet is open is no swipe back', async ({page}) => {
            // arrange
            await asStandalone(page);
            await page.goto(folder());
            await page.getByTestId('tab-new').tap();
            await openedMenu(page, 'new-menu');

            // act
            await touchesFrom(page, [[4, 400], [7, 399], [10, 398], [20, 396], [40, 395], [80, 394]]);

            // assert
            expect(await page.evaluate(() => [window.layer, window.shift])).toEqual(['', '']);
            await expect(page.getByTestId('new-menu')).toBeVisible();
            await expect(page).toHaveURL(folder());
        });

        test('a drag from the edge that goes up and down is the page\'s scroll', async ({page}) => {
            // arrange
            await asStandalone(page);
            await page.goto(folder());
            await expect(page.getByTestId('dir-row').first()).toBeVisible();
            await page.evaluate(() => {
                window.moves = [];
                window.addEventListener('touchmove', (event) => window.moves.push(event.defaultPrevented));
            });
            const cdp = await page.context().newCDPSession(page);

            // act
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: 4, y: 400}]});
            for (const y of [380, 350, 300]) {
                await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: 6, y}]});
            }
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});

            // assert
            expect(await page.evaluate(() => window.moves)).toEqual([false, false, false]);
            await expect(page).toHaveURL(folder());
        });

        test('a slow drag from the edge up the page scrolls it', async ({page}) => {
            // arrange
            await asStandalone(page);
            await page.goto(routes.doc(DOC));
            await expect(page.getByTestId('doc')).toBeVisible();
            const cdp = await page.context().newCDPSession(page);

            // act
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: 4, y: 600}]});
            for (let y = 598; y >= 300; y -= 2) {
                await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: 4, y}]});
            }
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});

            // assert
            await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
            await expect(page).toHaveURL(MAIN.url.doc(DOC));
        });

        test('a swipe back saves the name typed in a rename field', async ({page}) => {
            // arrange
            const folder = 'e2e-mobile/swiped';
            const note = `${folder}/swiped.md`;
            const renamed = `${folder}/swiped-saved.md`;
            writeFixture(note, '# Swiped\n');
            await asStandalone(page);
            await page.goto(MAIN.url.dir(folder));
            await page.locator(`[data-testid=dir-row][data-path="${note}"]`).getByTestId('tree-row-menu').tap();
            await page.getByTestId('tree-row-menu-rename').tap();
            await page.getByTestId('dir-rename-input').fill(nameOf(renamed));

            // act
            await swipe(page, 300);

            // assert
            await expect(page).toHaveURL(MAIN.url.dir('e2e-mobile'));
            await expect.poll(() => fs.existsSync(fixtureFile(renamed))).toBe(true);
            expect(fs.existsSync(fixtureFile(note))).toBe(false);
        });

        test('a drag from near the edge back toward it is let go like a scroll', async ({page}) => {
            // arrange
            await asStandalone(page);
            await page.goto(folder());
            await expect(page.getByTestId('dir-row').first()).toBeVisible();

            // act
            const taken = await touchesFrom(page, [[20, 400], [17, 400], [12, 400], [8, 400]], 'touchend');

            // assert
            expect(taken).toEqual([true, false, false]);
            await expect(page).toHaveURL(folder());
        });

        test('a fast flick sends the page off sooner than a slow drag does', async ({page}) => {
            // arrange
            await asStandalone(page);
            await page.addInitScript(() => {
                window.leaves = [];
                const animate = Element.prototype.animate;
                Element.prototype.animate = function (keyframes, options) {
                    if (Array.isArray(keyframes) && keyframes[1]?.transform === 'translateX(100%)') {
                        window.leaves.push(options.duration);
                    }
                    return animate.call(this, keyframes, options);
                };
            });
            const leaves = () => page.evaluate(() => window.leaves);
            const cdp = await page.context().newCDPSession(page);
            const y = 400;

            // act
            await page.goto(routes.doc(DOC));
            await expect(page.getByTestId('doc')).toBeVisible();
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: 4, y}]});
            for (const x of [40, 120, 200, 300]) {
                await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x, y}]});
            }
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
            await expect.poll(leaves).toHaveLength(1);
            const [fast] = await leaves();

            await page.goto(routes.doc(DOC));
            await expect(page.getByTestId('doc')).toBeVisible();
            await swipe(page, 300, 50);
            await expect.poll(leaves).toHaveLength(1);
            const [slow] = await leaves();

            // assert
            expect(fast).toBeLessThan(200);
            expect(fast).toBeGreaterThanOrEqual(120);
            expect(slow).toBe(200);
        });

        test('a finger drawn back toward the edge as it lifts keeps the page', async ({page}) => {
            // arrange
            await asStandalone(page);
            await page.goto(folder());
            await expect(page.getByTestId('dir-row').first()).toBeVisible();
            const cdp = await page.context().newCDPSession(page);
            const y = 400;

            // act
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: 4, y}]});
            for (const x of [40, 120, 200, 280]) {
                await page.waitForTimeout(20);
                await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x, y}]});
            }
            for (const x of [250, 220, 190]) {
                await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x, y}]});
            }
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});

            // assert
            await settled(page);
            await expect(page).toHaveURL(folder());
            await expect(page.locator('[data-screen]')).toHaveCSS('transform', 'none');
        });

        test('a page swiped back to a screen still on its way shows no spinner for a short wait', async ({page}) => {
            // arrange
            await asStandalone(page);
            await page.goto(routes.doc(DOC));
            await expect(page.locator('[data-screen]')).toBeVisible();
            await page.route(/\/api\/(dir|page)\//, async (route) => {
                await new Promise((resolve) => setTimeout(resolve, 2000));
                await route.continue();
            });
            await page.evaluate(() => {
                window.loadingAtStart = new Promise((resolve) => {
                    new MutationObserver((_, observer) => {
                        const shown = document.querySelector('[data-testid="dir-loading"]');
                        if (shown !== null) {
                            observer.disconnect();
                            const delays = shown.getAnimations().map((entry) => entry.effect.getTiming().delay);
                            resolve({opacity: getComputedStyle(shown).opacity, delay: Math.max(0, ...delays)});
                        }
                    }).observe(document.body, {childList: true, subtree: true});
                });
            });

            // act
            await swipe(page, 300);

            // assert
            const atStart = await page.evaluate(() => window.loadingAtStart);
            expect(atStart.opacity).toBe('0');
            expect(atStart.delay).toBeGreaterThan(0);
            const loading = page.getByTestId('dir-loading');
            await expect.poll(() => loading.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
        });

        test('in an app from the home screen goes back, and a short one leaves the page', async ({page}) => {
            // arrange
            await asStandalone(page);
            await page.goto(folder());
            await expect(page.getByTestId('dir-row').first()).toBeVisible();

            // act & assert
            await swipe(page, 60, 40);
            await expect(page.locator('[data-screen]')).toHaveCSS('transform', 'none');
            await expect(page).toHaveURL(folder());

            await swipe(page, 300);
            await expect(page).toHaveURL(atHome());
            await expect(page.locator('[data-screen]')).toHaveCSS('transform', 'none');
        });

        test('goes to the folder above and never back into the editor left', async ({page}) => {
            // arrange
            await asStandalone(page);
            await page.goto(MAIN.url.dir(docs.doc.folder));
            await page.locator(`[data-testid=dir-row][data-path="${DOC}"]`).tap();
            await expect(page.getByTestId('doc')).toBeVisible();
            await page.getByTestId('note-bar-edit').tap();
            await page.getByTestId('editor-cancel').tap();
            await expect(page).toHaveURL(MAIN.url.doc(DOC));
            await expect(page.getByTestId('doc')).toBeVisible();

            // act
            await swipe(page, 300);

            // assert
            await expect(page).toHaveURL(MAIN.url.dir(docs.doc.folder));
            await expect(page.locator(`[data-testid=dir-row][data-path="${DOC}"]`)).toBeVisible();
        });

        test('in a tab of the browser is left to the browser', async ({page}) => {
            // arrange
            await page.goto(folder());
            await expect(page.getByTestId('dir-row').first()).toBeVisible();

            // act
            await swipe(page, 300);

            // assert
            await expect(page.locator('[data-screen]')).toHaveCSS('transform', 'none');
            await expect(page).toHaveURL(folder());
        });

        test('a tab tapped while the swiped page is leaving goes after the way back and stays', async ({page}) => {
            // arrange
            await inStandalone(page);
            await page.goto(folder());
            await expect(page.getByTestId('dir-row').first()).toBeVisible();

            // act
            await swipeAndTap(page, 'tab-profile');

            // assert
            expect(await page.evaluate(() => window.tappedMoving)).toBe(true);
            await expect(page.getByTestId('tab-profile')).toHaveAttribute('data-current', 'true');
            await settled(page);
            await stays(() => page.getByTestId('tab-profile').getAttribute('data-current'), 'true', 500);
            await page.goBack();
            await expect(page).toHaveURL(atHome());
        });

        test('a tab tapped while the swiped page leaves keeps its place while its screen loads', async ({page}) => {
            // arrange
            await inStandalone(page);
            await page.goto(MAIN.url.dir(docs.deep.folder));
            await expect(page.getByTestId('dir-row').first()).toBeVisible();
            await page.route(/\/api\/(dir|page)\//, async (route) => {
                await new Promise((resolve) => setTimeout(resolve, 1000));
                await route.continue();
            });

            // act
            await swipeAndTap(page, 'tab-notes');

            // assert
            expect(await page.evaluate(() => window.tappedMoving)).toBe(true);
            await expect(page).toHaveURL(atHome());
            await expect(page.locator(`[data-testid=dir-row][data-path="${docs.doc.folder}"]`)).toBeVisible();
            await settled(page);
            await expect(page).toHaveURL(atHome());
            await stays(() => page.url(), page.url(), 1500);
        });

        test('a touch at the edge while the copy still leaves starts nothing', async ({page}) => {
            // arrange
            await asStandalone(page);
            await page.goto(MAIN.url.doc(docs.folder.entry));
            await expect(page.getByTestId('doc')).toBeVisible();
            await addTouchSender(page);
            await page.evaluate(() => {
                window.addEventListener('touchend', () => {
                    if (window.second !== undefined) {
                        return;
                    }
                    window.second = new Promise((resolve) => {
                        setTimeout(() => {
                            const leaving = document.querySelector('[data-leaving]') !== null;
                            window.sendTouch('touchstart', [4, 400]);
                            const taken = [20, 60, 200, 300].map((x) => window.sendTouch('touchmove', [x, 400]));
                            window.sendTouch('touchend');
                            resolve({leaving, taken});
                        });
                    });
                });
            });

            // act
            await swipe(page, 300);

            // assert
            expect(await page.evaluate(() => window.second)).toEqual({leaving: true, taken: [false, false, false, false]});
            await expect(page).toHaveURL(folder());
            await settled(page);
            await stays(() => page.url(), page.url(), 500);
        });

        test('a folder swiped back to while its subfolder still loads shows at once', async ({page}) => {
            // arrange
            await asStandalone(page);
            await page.goto(MAIN.url.dir(docs.deep.above));
            const sub = page.locator(`[data-testid=dir-row][data-path="${docs.deep.folder}"]`);
            await expect(sub).toBeVisible();
            const held = await holdRoute(page, new RegExp(`/api/dir/${docs.deep.folder}`));
            await sub.tap();
            await expect(page).toHaveURL(MAIN.url.dir(docs.deep.folder));
            await held.reached;
            await expect(page.locator('[data-leaving]')).toHaveCount(0);
            await expect.poll(() => page.locator('[data-screen]').evaluate((screen) => screen.getAnimations().length)).toBe(0);

            // act
            await swipe(page, 300);

            // assert
            await expect(page).toHaveURL(MAIN.url.dir(docs.deep.above));
            await expect(page.locator('[data-screen]')).toBeVisible({timeout: 1000});
            await expect(sub).toBeVisible();
            held.release();
        });

        test('a second swipe while the bar still names the page before goes up from the address', async ({page}) => {
            // arrange
            await asStandalone(page);
            await page.goto(MAIN.url.doc(docs.deep.path));
            await expect(page.getByTestId('doc')).toBeVisible();
            const held = await holdRoute(page, /\/api\/dir\//);

            // act & assert
            await swipe(page, 300);
            await expect(page).toHaveURL(MAIN.url.dir(docs.deep.folder));
            await expect(page.getByTestId('topbar-up')).toHaveAttribute('aria-label', text.phone.backTo(nameOf(docs.deep.above)));
            await expect(page.locator('[data-leaving]')).toHaveCount(0);
            await swipe(page, 300);
            await expect(page).toHaveURL(MAIN.url.dir(docs.deep.above));
            held.release();
        });

        test('a folder the drag asked for and still on its way is not asked for again, and shows when it comes', async ({page}) => {
            // arrange
            await asStandalone(page);
            await page.goto(MAIN.url.doc(docs.folder.entry));
            await expect(page.getByTestId('doc')).toBeVisible();
            await page.waitForLoadState('networkidle');
            const asked = [];
            page.on('request', (request) => {
                if (request.url().includes(`/api/dir/${docs.folder.path}`)) {
                    asked.push(request.url());
                }
            });
            const held = await holdRoute(page, new RegExp(`/api/dir/${docs.folder.path}`));

            // act
            await swipe(page, 300);
            await expect(page).toHaveURL(folder());
            await held.reached;
            await page.waitForTimeout(300);
            held.release();

            // assert
            await expect(page.locator(`[data-screen] [data-testid=dir-row][data-path="${docs.folder.entry}"]`)).toBeVisible();
            expect(asked).toHaveLength(1);
        });

        test('a folder the drag asked for before a change does not come back from the answers the app keeps', async ({page}) => {
            // arrange
            const above = 'e2e-mobile/asked-before';
            const gone = `${above}/gone.md`;
            const kept = `${above}/kept.md`;
            writeFixture(gone, '# Gone\n');
            writeFixture(kept, '# Kept\n');
            await asStandalone(page);
            await page.goto(MAIN.url.dir(above));
            await page.locator(`[data-testid=dir-row][data-path="${gone}"]`).tap();
            await expect(page.getByTestId('doc')).toBeVisible();
            await page.waitForLoadState('networkidle');
            let answer = () => {};
            const late = new Promise((resolve) => {
                answer = resolve;
            });
            await page.route(new RegExp(`/api/dir/${above}`), async (route) => {
                const response = await route.fetch();
                await late;
                await route.fulfill({response});
            }, {times: 1});
            const cdp = await page.context().newCDPSession(page);
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: 4, y: 400}]});
            for (const x of [10, 20, 40, 80]) {
                await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x, y: 400}]});
            }
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchCancel', touchPoints: []});
            await settled(page);
            await page.getByTestId('note-menu').tap();
            await openedMenu(page, 'note-menu-dropdown');
            await page.getByTestId('note-menu-delete').tap();
            await expect.poll(() => fs.existsSync(fixtureFile(gone))).toBe(false);
            await page.waitForLoadState('networkidle');
            answer();
            await page.waitForTimeout(300);
            await expect(page).toHaveURL(atHome());
            await page.locator('[data-testid=dir-row][data-path="e2e-mobile"]').tap();
            const row = page.locator(`[data-testid=dir-row][data-path="${above}"]`);
            await expect(row).toBeVisible();
            const held = await holdRoute(page, new RegExp(`/api/dir/${above}`));

            // act
            await row.tap();

            // assert
            await expect(page).toHaveURL(MAIN.url.dir(above));
            await stays(() => page.locator(`[data-screen] [data-testid=dir-row][data-path="${gone}"]`).count(), 0, 500);
            held.release();
            await expect(page.locator(`[data-screen] [data-testid=dir-row][data-path="${kept}"]`)).toBeVisible();
        });

        test('a drag held while a folder\'s answer comes keeps the page at the finger', async ({page}) => {
            // arrange
            await asStandalone(page);
            await page.goto(MAIN.url.doc(docs.deep.path));
            await expect(page.getByTestId('doc')).toBeVisible();
            const held = await holdRoute(page, /\/api\/dir\//);
            await swipe(page, 300);
            await expect(page).toHaveURL(MAIN.url.dir(docs.deep.folder));
            await held.reached;
            await expect(page.locator('[data-leaving]')).toHaveCount(0);
            await addTouchSender(page);
            await page.evaluate(async () => {
                window.sendTouch('touchstart', [4, 400]);
                for (const x of [10, 20, 40, 70, 104]) {
                    window.sendTouch('touchmove', [x, 400]);
                    await new Promise((resolve) => setTimeout(resolve, 16));
                }
            });

            // act
            held.release();
            await expect(page.locator(`[data-screen] [data-testid=dir-row][data-path="${docs.deep.path}"]`)).toBeVisible();
            await page.waitForTimeout(100);

            // assert
            const shift = await page.locator('[data-screen]').evaluate((el) => Math.round(new DOMMatrix(getComputedStyle(el).transform).m41));
            await page.evaluate(() => window.sendTouch('touchcancel'));
            expect(shift).toBe(100);
        });

        test('a swipe on the root while it still loads after a swipe to it goes nowhere', async ({page}) => {
            // arrange
            await asStandalone(page);
            await page.goto(folder());
            await expect(page.getByTestId('dir-row').first()).toBeVisible();
            const held = await holdRoute(page, /\/api\/dir\//);
            await swipe(page, 300);
            await expect(page).toHaveURL(atHome());
            await expect(page.locator('[data-leaving]')).toHaveCount(0);
            const length = await page.evaluate(() => history.length);

            // act
            await swipe(page, 300);

            // assert
            await page.waitForTimeout(300);
            expect(await page.evaluate(() => history.length)).toBe(length);
            await expect(page).toHaveURL(atHome());
            held.release();
        });

        test('Recent and Profile, places of the tab bar, have no way up and no swipe', async ({page}) => {
            // arrange
            await asStandalone(page);
            await page.goto(routes.doc(DOC));
            await expect(page.getByTestId('doc')).toBeVisible();

            // act & assert
            await page.goto(routes.recent());
            await expect(page.getByTestId('recent')).toBeVisible();
            await swipe(page, 300);
            await expect(page.getByTestId('topbar-up')).toHaveCount(0);
            await stays(() => new URL(page.url()).pathname, routes.recent(), MOVE_WAIT_MS);

            await page.getByTestId('tab-profile').tap();
            await expect(page.getByTestId('profile-page')).toBeVisible();
            await swipe(page, 300);
            await expect(page.getByTestId('topbar-up')).toHaveCount(0);
            await stays(() => new URL(page.url()).pathname, routes.profile(), MOVE_WAIT_MS);
        });

        test('Recent and Profile at an address with a trailing slash or capitals are their tabs too', async ({page}) => {
            // arrange
            await asStandalone(page);
            const recent = [`${routes.recent()}/`, routes.recent().replace('/recent', '/Recent')];
            const profile = [`${routes.profile()}/`, routes.profile().replace('/profile', '/Profile')];

            // act & assert
            for (const typed of recent) {
                await page.goto(typed);
                await expect(page.getByTestId('recent')).toBeVisible();
                await expect(page.getByTestId('tab-search')).toHaveAttribute('data-current', 'true');
                await expect(page.getByTestId('topbar-up')).toHaveCount(0);
            }
            for (const typed of profile) {
                await page.goto(typed);
                await expect(page.getByTestId('profile-page')).toBeVisible();
                await expect(page.getByTestId('tab-profile')).toHaveAttribute('data-current', 'true');
                await expect(page.getByTestId('topbar-up')).toHaveCount(0);
                const entries = await page.evaluate(() => window.history.length);
                await page.getByTestId('tab-profile').tap();
                await stays(() => page.evaluate(() => window.history.length), entries, MOVE_WAIT_MS);
            }
        });

        test('the search page, no tab, keeps its way up', async ({page}) => {
            // arrange
            await asStandalone(page);

            // act
            await page.goto(routes.search(docs.search.word));

            // assert
            await expect(page.getByTestId('topbar-up')).toBeVisible();
        });

        test('a part of the page scrolled sideways keeps its place on the copy', async ({page}) => {
            // arrange
            const note = 'e2e-mobile/copy-scrolled.md';
            writeFixture(note, `# Copy scrolled\n\n\`\`\`\n${'wide '.repeat(80)}\n\`\`\`\n`);
            await asStandalone(page);
            await page.goto(MAIN.url.doc(note));
            await expect(page.getByTestId('doc')).toBeVisible();
            const scrolled = await page.evaluate(() => {
                const wide = Array.from(document.querySelectorAll('[data-screen] *'))
                    .find((node) => node.scrollWidth > node.clientWidth + 100 && getComputedStyle(node).overflowX !== 'visible');
                wide.scrollLeft = 120;
                wide.dataset.wide = 'true';
                window.addEventListener('touchend', () => {
                    window.copiedScroll = document.querySelector('[data-leaving] [data-wide]')?.scrollLeft;
                }, {once: true});
                return wide.scrollLeft;
            });

            // act
            await swipe(page, 300);

            // assert
            await expect.poll(() => page.evaluate(() => window.copiedScroll)).toBe(scrolled);
            removeFixture(note);
        });

        test('a diagram on a note dragged while it slides in waits for the finger to lift', async ({page}) => {
            // arrange
            const note = 'e2e-mobile/drawn-after-drag.md';
            const warm = 'e2e-mobile/drawn-before-drag.md';
            writeFixture(note, '# Drawn after drag\n\n```mermaid\ngraph TD\n  A --> B\n```\n');
            writeFixture(warm, '# Drawn before drag\n\n```mermaid\ngraph TD\n  C --> D\n```\n');
            await asStandalone(page);
            await page.goto(MAIN.url.doc(warm));
            await expect(page.locator('.md-diagram[data-state="done"]')).toBeVisible();
            await page.getByTestId('topbar-up').tap();
            const row = page.locator(`[data-testid=dir-row][data-path="${note}"]`);
            await expect(row).toBeVisible();
            await settled(page);
            await addTouchSender(page);
            await addEnteringWait(page);

            // act
            await row.tap();
            const during = await page.evaluate(async () => {
                await window.untilEntering();
                window.sendTouch('touchstart', [4, 400]);
                for (const x of [10, 20, 40, 70]) {
                    window.sendTouch('touchmove', [x, 400]);
                    await new Promise((resolve) => setTimeout(resolve, 16));
                }
                await new Promise((resolve) => setTimeout(resolve, 1000));
                return document.querySelector('[data-screen] .md-diagram')?.dataset.state;
            });
            await page.evaluate(() => window.sendTouch('touchcancel'));

            // assert
            expect(during).toBe('drawing');
            await expect(page.locator('[data-screen] .md-diagram[data-state="done"]')).toBeVisible();
            removeFixture(note);
            removeFixture(warm);
        });

        test('a diagram drawn while the finger comes down goes in only after the finger lifts', async ({page}) => {
            // arrange
            const note = 'e2e-mobile/drawn-under-finger.md';
            writeFixture(note, '# Drawn under finger\n\n```plantuml\n@startuml\n!include <C4/C4_Context>\nPerson(reader, "Reader")\n@enduml\n```\n');
            const held = await holdRoute(page, '**/plantuml/c4.min.js');
            await asStandalone(page);
            await page.goto(MAIN.url.doc(note));
            await held.reached;
            await addTouchSender(page);
            await page.evaluate(async () => {
                window.sendTouch('touchstart', [4, 400]);
                for (const x of [10, 20, 40, 70]) {
                    window.sendTouch('touchmove', [x, 400]);
                    await new Promise((resolve) => setTimeout(resolve, 16));
                }
            });

            // act
            held.release();

            // assert
            await stays(() => page.locator('[data-screen] .md-diagram').getAttribute('data-state'), 'drawing', 1500);
            await page.evaluate(() => window.sendTouch('touchcancel'));
            await expect(page.locator('[data-screen] .md-diagram[data-state="done"]')).toBeVisible();
            removeFixture(note);
        });

        test('a folder swiped back to from a folder while it still loads shows the spinner, not an empty screen', async ({page}) => {
            // arrange
            await asStandalone(page);
            await page.goto(MAIN.url.dir(docs.deep.folder));
            await expect(page.locator(`[data-screen] [data-testid=dir-row][data-path="${docs.deep.path}"]`)).toBeVisible();
            await settled(page);
            const held = await holdRoute(page, new RegExp(`/api/dir/${docs.deep.above}$`));

            // act
            await swipe(page, 300);

            // assert
            await expect(page).toHaveURL(MAIN.url.dir(docs.deep.above));
            const loading = page.getByTestId('dir-loading');
            await expect.poll(() => loading.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
            held.release();
            await expect(page.locator(`[data-screen] [data-testid=dir-row][data-path="${docs.deep.folder}"]`)).toBeVisible();
            await expect(loading).toHaveCount(0);
        });

        test('a swipe on a folder opened from the root while it still loads goes back to the root', async ({page}) => {
            // arrange
            await asStandalone(page);
            await page.goto(routes.home());
            const row = page.locator(`[data-testid=dir-row][data-path="${docs.folder.path}"]`);
            await expect(row).toBeVisible();
            await settled(page);
            const held = await holdRoute(page, new RegExp(`/api/dir/${docs.folder.path}$`));
            await row.tap();
            await expect(page).toHaveURL(folder());
            await held.reached;

            // act
            await swipe(page, 300);

            // assert
            await expect(page).toHaveURL(atHome());
            held.release();
        });

        test('of two drags that ask for the folder above, the folder swiped back to shows the answer to the newer one', async ({page}) => {
            // arrange
            await asStandalone(page);
            await page.goto(MAIN.url.doc(docs.folder.entry));
            await expect(page.getByTestId('doc')).toBeVisible();
            await page.waitForLoadState('networkidle');
            const answers = [];
            let asked = 0;
            await page.route(new RegExp(`/api/dir/${docs.folder.path}$`), async (route) => {
                asked += 1;
                if (asked > 2) {
                    await new Promise((resolve) => setTimeout(resolve, 2500));
                    await route.continue();
                    return;
                }
                const older = asked === 1;
                const response = await route.fetch();
                const body = await response.json();
                await new Promise((resolve) => answers.push(resolve));
                const entries = older ? body.entries.filter((entry) => entry.path !== docs.folder.entry) : body.entries;
                await route.fulfill({response, json: {...body, entries}});
            });
            const cdp = await page.context().newCDPSession(page);
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: 4, y: 400}]});
            for (const x of [10, 20, 40, 80]) {
                await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x, y: 400}]});
            }
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchCancel', touchPoints: []});
            await expect.poll(() => answers.length).toBe(1);
            await settled(page);
            await swipe(page, 300);
            await expect(page).toHaveURL(folder());
            await expect.poll(() => answers.length).toBe(2);

            // act
            answers[0]();
            await page.waitForTimeout(300);
            answers[1]();

            // assert
            await expect(page.locator('[data-screen] [data-testid=dir-row]').first()).toBeVisible({timeout: 1000});
            await stays(() => page.locator(`[data-screen] [data-testid=dir-row][data-path="${docs.folder.entry}"]`).count(), 1, 1000);
        });

        test('a drag given up leaves its question for the folder above to no screen opened later', async ({page}) => {
            // arrange
            await asStandalone(page);
            await page.goto(MAIN.url.doc(docs.folder.entry));
            await expect(page.getByTestId('doc')).toBeVisible();
            await page.waitForLoadState('networkidle');
            const asked = [];
            page.on('request', (request) => {
                if (new RegExp(`/api/dir/${docs.folder.path}$`).test(request.url())) {
                    asked.push(request.url());
                }
            });
            const answered = page.waitForResponse((response) => response.url().includes(`/api/dir/${docs.folder.path}`));
            const cdp = await page.context().newCDPSession(page);
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: 4, y: 400}]});
            for (const x of [10, 20, 40, 80]) {
                await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x, y: 400}]});
            }
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchCancel', touchPoints: []});
            await answered;
            await settled(page);

            // act
            await page.getByTestId('topbar-up').tap();

            // assert
            await expect(page).toHaveURL(folder());
            await expect(page.locator(`[data-screen] [data-testid=dir-row][data-path="${docs.folder.entry}"]`)).toBeVisible();
            await expect.poll(() => asked.length).toBe(2);
        });

        test('a drag whose question for the folder above is refused keeps the note and asks for no sign-in', async ({page}) => {
            // arrange
            await asStandalone(page);
            await page.goto(MAIN.url.doc(docs.folder.entry));
            await expect(page.getByTestId('doc')).toBeVisible();
            await page.waitForLoadState('networkidle');
            await page.route(new RegExp(`/api/dir/${docs.folder.path}$`), (route) => route.fulfill({status: 401, json: {error: 'unauthorized'}}), {times: 1});
            const refused = page.waitForResponse((response) => response.url().includes(`/api/dir/${docs.folder.path}`));
            const loads = [];
            page.on('load', () => loads.push(page.url()));
            const cdp = await page.context().newCDPSession(page);

            // act
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: 4, y: 400}]});
            for (const x of [10, 20, 40, 80]) {
                await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x, y: 400}]});
            }
            await refused;
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchCancel', touchPoints: []});

            // assert
            await page.waitForTimeout(500);
            expect(loads).toEqual([]);
            await expect(page).toHaveURL(MAIN.url.doc(docs.folder.entry));
        });

        test('a folder swiped back to from a long folder scrolled down shows its spinner on the screen', async ({page}) => {
            // arrange
            const above = 'e2e-mobile/long-above';
            const long = `${above}/long`;
            for (let index = 0; index < 60; index++) {
                writeFixture(`${long}/note-${String(index).padStart(2, '0')}.md`, `# Note ${index}\n`);
            }
            await asStandalone(page);
            await page.goto(MAIN.url.dir(long));
            await expect(page.locator(`[data-screen] [data-testid=dir-row][data-path="${long}/note-59.md"]`)).toBeVisible();
            await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
            await settled(page);
            const held = await holdRoute(page, new RegExp(`/api/dir/${above}$`));

            // act
            await swipe(page, 300);

            // assert
            await expect(page).toHaveURL(MAIN.url.dir(above));
            await expect(page.getByTestId('dir-loading')).toBeInViewport();
            held.release();
            await expect(page.locator(`[data-screen] [data-testid=dir-row][data-path="${long}"]`)).toBeVisible();
            removeFixture(above);
        });

        test('a swipe while the folder gone back to still loads under the hidden folder left starts nothing', async ({page}) => {
            // arrange
            await asStandalone(page);
            await page.goto(MAIN.url.dir(docs.deep.folder));
            await expect(page.locator(`[data-screen] [data-testid=dir-row][data-path="${docs.deep.path}"]`)).toBeVisible();
            await settled(page);
            const held = await holdRoute(page, new RegExp(`/api/dir/${docs.deep.above}$`));
            await swipe(page, 300);
            await expect(page).toHaveURL(MAIN.url.dir(docs.deep.above));
            await expect(page.locator('[data-leaving]')).toHaveCount(0);

            // act
            await swipe(page, 300);

            // assert
            await expect(page.locator('[data-leaving]')).toHaveCount(0);
            await stays(() => page.url(), MAIN.url.dir(docs.deep.above), 300);
            held.release();
            await expect(page.locator(`[data-screen] [data-testid=dir-row][data-path="${docs.deep.folder}"]`)).toBeVisible();
        });

        test('a drag under which another page opens is put back when let go and stays on that page', async ({page}) => {
            // arrange
            await asStandalone(page);
            await page.goto(folder());
            const row = page.locator(`[data-screen] [data-testid=dir-row][data-path="${docs.folder.entry}"]`);
            await expect(row).toBeVisible();
            await settled(page);
            await addTouchSender(page);
            await page.evaluate(async () => {
                window.sendTouch('touchstart', [4, 400]);
                for (const x of [10, 20, 40, 80]) {
                    window.sendTouch('touchmove', [x, 400]);
                    await new Promise((resolve) => setTimeout(resolve, 16));
                }
            });
            await row.evaluate((element) => element.querySelector('a').click());
            await expect(page).toHaveURL(MAIN.url.doc(docs.folder.entry));
            await expect(page.locator('[data-screen] [data-testid=doc]')).toBeVisible();

            // act
            await page.evaluate(async () => {
                for (const x of [160, 240, 300]) {
                    window.sendTouch('touchmove', [x, 400]);
                    await new Promise((resolve) => setTimeout(resolve, 16));
                }
                window.sendTouch('touchend');
            });

            // assert
            await settled(page);
            await stays(() => page.url(), page.url(), 500);
            await expect(page).toHaveURL(MAIN.url.doc(docs.folder.entry));
            await expect(page.locator('[data-leaving]')).toHaveCount(0);
            await expect(page.locator('[data-screen]')).toHaveCSS('transform', 'none');
        });

        test('a drag whose touch lost its element to the page opened under it is still the finger\'s and is put back', async ({page}) => {
            // arrange
            await asStandalone(page);
            await page.goto(folder());
            const row = page.locator(`[data-screen] [data-testid=dir-row][data-path="${docs.folder.entry}"]`);
            await expect(row).toBeVisible();
            await settled(page);
            await addTouchSender(page);
            await row.evaluate(async (element) => {
                window.touched = element;
                window.sendTouch('touchstart', [4, 400], element);
                for (const x of [10, 20, 40, 80]) {
                    window.sendTouch('touchmove', [x, 400], element);
                    await new Promise((resolve) => setTimeout(resolve, 16));
                }
            });
            await row.evaluate((element) => element.querySelector('a').click());
            await expect(page.locator('[data-screen] [data-testid=doc]')).toBeVisible();

            // act
            const gone = await page.evaluate(async () => {
                const removed = !window.touched.isConnected;
                for (const x of [160, 240, 300]) {
                    window.sendTouch('touchmove', [x, 400], window.touched);
                    await new Promise((resolve) => setTimeout(resolve, 16));
                }
                window.sendTouch('touchend', [300, 400], window.touched);
                return removed;
            });

            // assert
            expect(gone).toBe(true);
            await settled(page);
            await expect(page).toHaveURL(MAIN.url.doc(docs.folder.entry));
            await expect(page.locator('[data-leaving]')).toHaveCount(0);
            await expect(page.locator('[data-screen]')).toHaveCSS('transform', 'none');
        });

        test('a flick of one move goes back', async ({page}) => {
            // arrange
            await asStandalone(page);
            await page.goto(MAIN.url.doc(docs.folder.entry));
            await expect(page.getByTestId('doc')).toBeVisible();
            await settled(page);
            await addTouchSender(page);

            // act
            await page.evaluate(async () => {
                window.sendTouch('touchstart', [4, 400]);
                await new Promise((resolve) => setTimeout(resolve, 16));
                window.sendTouch('touchmove', [100, 400]);
                await new Promise((resolve) => setTimeout(resolve, 16));
                window.sendTouch('touchend');
            });

            // assert
            await expect(page).toHaveURL(folder());
        });

        test('a folder that comes after the copy has left shows in its place with no move', async ({page}) => {
            // arrange
            await asStandalone(page);
            await page.addInitScript(() => {
                window.screenMoves = [];
                const animate = Element.prototype.animate;
                Element.prototype.animate = function (keyframes, options) {
                    if (this.hasAttribute('data-screen') && Array.isArray(keyframes)) {
                        window.screenMoves.push(String(keyframes[0]?.transform));
                    }
                    return animate.call(this, keyframes, options);
                };
            });
            await page.goto(MAIN.url.doc(docs.folder.entry));
            await expect(page.getByTestId('doc')).toBeVisible();
            await settled(page);
            const held = await holdRoute(page, new RegExp(`/api/dir/${docs.folder.path}$`));

            // act
            await swipe(page, 300);
            await held.reached;
            await expect(page.locator('[data-leaving]')).toHaveCount(0);
            held.release();

            // assert
            await expect(page.locator(`[data-screen] [data-testid=dir-row][data-path="${docs.folder.entry}"]`)).toBeVisible();
            await settled(page);
            expect(await page.evaluate(() => window.screenMoves)).toEqual([]);
        });

        test('a folder that comes while the copy leaves starts on the copy\'s clock', async ({page}) => {
            // arrange
            await asStandalone(page);
            await page.goto(MAIN.url.doc(docs.folder.entry));
            await expect(page.getByTestId('doc')).toBeVisible();
            await settled(page);
            await page.route(new RegExp(`/api/dir/${docs.folder.path}$`), async (route) => {
                await new Promise((resolve) => setTimeout(resolve, 100));
                await route.continue();
            });
            await page.evaluate(() => {
                window.clocks = new Promise((resolve) => {
                    const watch = () => {
                        const sheet = document.querySelector('[data-leaving]')?.getAnimations()[0];
                        const under = Array.from(document.querySelectorAll('[data-screen]'))
                            .flatMap((element) => element.getAnimations())
                            .find((animation) => animation.playState === 'running');
                        if (sheet?.startTime != null && under?.startTime != null) {
                            resolve({sheet: sheet.startTime, under: under.startTime});
                            return;
                        }
                        requestAnimationFrame(watch);
                    };
                    requestAnimationFrame(watch);
                });
            });

            // act
            await swipe(page, 300);

            // assert
            const clocks = await page.evaluate(() => window.clocks);
            expect(clocks.under).toBe(clocks.sheet);
            await expect(page).toHaveURL(folder());
        });

        test('with less motion asked for, a swipe let go goes back with no copy left over', async ({page}) => {
            // arrange
            await page.emulateMedia({reducedMotion: 'reduce'});
            await asStandalone(page);
            await page.goto(MAIN.url.doc(docs.folder.entry));
            await expect(page.getByTestId('doc')).toBeVisible();

            // act
            await swipe(page, 300);

            // assert
            await expect(page.locator('[data-leaving]')).toHaveCount(0, {timeout: 500});
            await expect(page).toHaveURL(folder());
            await expect(page.locator('[data-screen] [data-testid=dir-row]').first()).toBeVisible({timeout: 1000});
            await stays(() => page.locator(`[data-screen] [data-testid=dir-row][data-path="${docs.folder.entry}"]`).count(), 1, 1000);
        });

        test('with less motion asked for, a short drag puts the page back with no move', async ({page}) => {
            // arrange
            await page.emulateMedia({reducedMotion: 'reduce'});
            await asStandalone(page);
            await page.goto(folder());
            await expect(page.getByTestId('dir-row').first()).toBeVisible();

            // act
            await swipe(page, 60, 40);

            // assert
            const moving = await page.locator('[data-screen]').evaluate((el) => el.getAnimations()
                .filter((animation) => animation.playState === 'running' && animation.effect.getTiming().duration > 0)
                .length);
            expect(moving).toBe(0);
            await expect(page.locator('[data-screen]')).toHaveCSS('transform', 'none');
        });

        test('a second finger gives the drag up and puts the page back', async ({page}) => {
            // arrange
            await asStandalone(page);
            await page.goto(folder());
            await expect(page.getByTestId('dir-row').first()).toBeVisible();
            const cdp = await page.context().newCDPSession(page);
            const y = 400;
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: 4, y, id: 1}]});
            for (const x of [20, 60, 100]) {
                await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x, y, id: 1}]});
            }

            // act
            await cdp.send('Input.dispatchTouchEvent', {
                type: 'touchStart', touchPoints: [{x: 100, y, id: 1}, {x: 200, y: 500, id: 2}],
            });
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});

            // assert
            await expect(page.locator('[data-screen]')).toHaveCSS('transform', 'none');
            await expect(page).toHaveURL(folder());
        });
    });

    test.describe('a tablet', () => {
        test.use({viewport: {width: 1024, height: 768}});

        test('a touch beside a menu that never became a tap does not close the next one', async ({page}) => {
            // arrange
            await page.goto(routes.home());
            const opener = page.getByTestId('tree-row').first().getByTestId('tree-row-menu');
            const menu = page.getByTestId('tree-row-menu-dropdown');
            const cdp = await page.context().newCDPSession(page);
            await opener.tap();
            await expect(menu).toBeVisible();
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: 900, y: 700}]});
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchCancel', touchPoints: []});
            await page.evaluate(() => window.dispatchEvent(new Event('scroll')));
            await expect(menu).toHaveCount(0);
            await opener.tap();
            await expect(menu).toBeVisible();

            // act
            await page.getByTestId('tap-guard').dispatchEvent('click');

            // assert
            await stays(() => opener.getAttribute('data-opened'), 'true', 400);
            await expect(menu).toBeVisible();
        });

        test('with wrap off the editor scrolls in two boxes in Source and in one in Split', async ({page}) => {
            // arrange
            await page.addInitScript(() => localStorage.setItem('scrawl.editor.wrap', 'false'));
            writeFixture(SCRATCH, '# Планшет\n\nстрока\n');
            await page.goto(routes.edit(SCRATCH));
            const pane = page.getByTestId('editor-source');
            await page.getByTestId('editor-layout-mode').getByTitle('Split').tap();
            await expect(pane).not.toHaveAttribute('data-scroll');

            // act
            await page.getByTestId('editor-layout-mode').getByTitle('Source').tap();

            // assert
            await expect(pane).toHaveAttribute('data-scroll', 'outer');
        });

        test('the Search row of the sidebar shows no key on a touch screen', async ({page}) => {
            // act
            await page.goto(routes.home());

            // assert
            await expect(page.getByTestId('sidebar-search')).toBeVisible();
            await expect(page.getByTestId('sidebar-search-keys')).toHaveCount(0);
        });

        test('the guard under a tree row\'s menu is no part of the row', async ({page}) => {
            // arrange
            await page.goto(routes.home());
            const row = page.getByTestId('tree-row').first();

            // act
            await row.getByTestId('tree-row-menu').tap();

            // assert
            await expect(page.getByTestId('tree-row-menu-dropdown')).toBeVisible();
            expect(await page.getByTestId('tap-guard').evaluate((el) => el.closest('[data-testid=tree-row]'))).toBeNull();
        });

        test('the rename popover of a page keeps a tap in its field, cancels on its ✕ and saves on a tap beside it', async ({page}) => {
            // arrange
            const note = 'e2e-mobile/tablet/popover.md';
            const renamed = 'e2e-mobile/tablet/popover-saved.md';
            writeFixture(note, '# Popover\n\nSome text.\n');
            await page.goto(MAIN.url.doc(note));
            const input = page.getByTestId('page-rename-input');
            const space = page.getByTestId('topbar-crumbs').getByTestId('crumb').first();
            const moves = recordMoves(page);
            const start = async () => {
                await page.getByTestId('note-menu').tap();
                await openedMenu(page, 'note-menu-dropdown');
                await page.getByTestId('note-menu-rename').tap();
                await expect(input).toBeFocused();
            };

            // act & assert
            await start();
            await expect(page.getByTestId('tap-guard')).toBeVisible();
            await input.fill('popover-dropped.md');
            await input.tap();
            await expect(input).toBeFocused();
            await expect(input).toHaveValue('popover-dropped.md');
            await page.getByTestId('page-rename-cancel').tap();
            await expect(page.getByTestId('page-rename')).toHaveCount(0);
            await expect(page.getByTestId('tap-guard')).toHaveCount(0);
            await stays(() => moves, [], MOVE_WAIT_MS);

            await start();
            await input.fill(nameOf(renamed));
            const beneath = await space.boundingBox();
            await page.touchscreen.tap(beneath.x + beneath.width / 2, beneath.y + beneath.height / 2);
            await expect(page).toHaveURL(MAIN.url.doc(renamed));
            await expect(page.getByTestId('page-rename')).toHaveCount(0);
            expect(moves).toEqual([{from: note, to: renamed}]);
            expect([note, renamed].map((path) => fs.existsSync(fixtureFile(path)))).toEqual([false, true]);
        });

        test('after a failed save in the rename popover of a page a tap beside it closes the field and frees the page', async ({page}) => {
            // arrange
            const note = 'e2e-mobile/tablet/popover-fail.md';
            const taken = 'e2e-mobile/tablet/popover-taken.md';
            writeFixture(note, '# Popover fail\n');
            writeFixture(taken, '# Taken\n');
            await page.goto(MAIN.url.doc(note));
            const input = page.getByTestId('page-rename-input');
            const space = page.getByTestId('topbar-crumbs').getByTestId('crumb').first();
            const moves = recordMoves(page);
            const tapSpace = async () => {
                const box = await space.boundingBox();
                await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
            };
            await page.getByTestId('note-menu').tap();
            await openedMenu(page, 'note-menu-dropdown');
            await page.getByTestId('note-menu-rename').tap();
            await expect(input).toBeFocused();
            await input.fill(nameOf(taken));
            await tapSpace();
            await expect(page.locator('[data-testid=toast][data-kind="error"]')).toContainText(text.nameTaken);
            await expect(input).toHaveValue(nameOf(taken));

            // act
            await tapSpace();

            // assert
            await expect(page.getByTestId('page-rename')).toHaveCount(0);
            await expect(page.getByTestId('tap-guard')).toHaveCount(0);
            await expect(page).toHaveURL(MAIN.url.doc(note));
            await tapSpace();
            await expect(page).toHaveURL(atHome());
            expect(moves).toEqual([{from: note, to: taken}]);
            expect([note, taken].map((path) => fs.existsSync(fixtureFile(path)))).toEqual([true, true]);
        });

        for (const [kind, typed, problem] of [['a dot', '.popover.md', text.renameDot], ['a slash', 'a/b.md', text.renameSlash]]) {
            test(`a name with ${kind} refused in the rename popover of a page keeps the field on the tap that saved it`, async ({page}) => {
                // arrange
                const note = `e2e-mobile/tablet/refused-${kind.split(' ')[1]}.md`;
                writeFixture(note, '# Refused\n');
                await page.goto(MAIN.url.doc(note));
                const input = page.getByTestId('page-rename-input');
                const space = page.getByTestId('topbar-crumbs').getByTestId('crumb').first();
                const moves = recordMoves(page);
                const tapSpace = async () => {
                    const box = await space.boundingBox();
                    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
                };
                await page.getByTestId('note-menu').tap();
                await openedMenu(page, 'note-menu-dropdown');
                await page.getByTestId('note-menu-rename').tap();
                await expect(input).toBeFocused();
                await input.fill(typed);

                // act
                await tapSpace();

                // assert
                await expect(page.locator('[data-testid=toast][data-kind="error"]')).toContainText(problem);
                await stays(() => input.inputValue(), typed, MOVE_WAIT_MS);
                await expect(page.getByTestId('tap-guard')).toBeVisible();
                await tapSpace();
                await expect(page.getByTestId('page-rename')).toHaveCount(0);
                await expect(page.getByTestId('tap-guard')).toHaveCount(0);
                await expect(page).toHaveURL(MAIN.url.doc(note));
                expect(moves).toEqual([]);
            });
        }

        test('the name field of a new note saves a name on a tap beside it, and keeps a refused one until the next tap', async ({page}) => {
            // arrange
            const folder = 'e2e-mobile/tablet/new-note';
            fs.mkdirSync(fixtureFile(folder), {recursive: true});
            await page.goto(routes.draft(`${folder}/${text.create.untitled}`));
            const crumb = page.locator('[data-testid=crumb][data-draft="true"]');
            const input = page.getByTestId('draft-name-input');
            const space = page.getByTestId('topbar-crumbs').getByTestId('crumb').first();
            const tapSpace = async () => {
                const box = await space.boundingBox();
                await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
            };
            const start = async (typed) => {
                await crumb.tap();
                await expect(input).toBeFocused();
                await input.fill(typed);
            };

            // act & assert
            await start('a/b.md');
            await tapSpace();
            await expect(page.locator('[data-testid=toast][data-kind="error"]')).toContainText(text.renameSlash);
            await stays(() => input.inputValue(), 'a/b.md', MOVE_WAIT_MS);
            await expect(page.getByTestId('tap-guard')).toBeVisible();
            await tapSpace();
            await expect(page.getByTestId('draft-name-field')).toHaveCount(0);
            await expect(page.getByTestId('tap-guard')).toHaveCount(0);
            await expect(crumb).toHaveText(text.create.untitled);

            await start('tablet-plan.md');
            await tapSpace();
            await expect(page.getByTestId('draft-name-field')).toHaveCount(0);
            await expect(page.getByTestId('tap-guard')).toHaveCount(0);
            await expect(crumb).toHaveText('tablet-plan.md');
            removeFixture(folder);
        });

        test('the RUN of a table row takes a tap over the row\'s height, none of its name, and the press alone', async ({page}) => {
            // arrange
            const folder = 'e2e-mobile/tablet/app';
            const file = `${'a-long-name-of-an-app-'.repeat(8)}index.html`;
            writeFixture(`${folder}/${file}`, '<!doctype html><h1>Tablet app</h1>\n');
            await page.goto(MAIN.url.dir(folder));
            const row = `[data-testid=dir-row][data-path="${folder}/${file}"]`;
            const run = page.locator(`${row} [data-testid=dir-row-run]`);
            await expect(run).toBeVisible();
            const pill = await run.boundingBox();
            const line = await page.locator(row).boundingBox();
            const name = await page.locator(`${row} [data-testid=dir-row-name]`).boundingBox();
            const press = await forcePress(page);
            const rowBackground = () => page.locator(row).evaluate((el) => getComputedStyle(el).backgroundColor);

            // act & assert
            expect(await hitsDown(page, pill.x + pill.width / 2, line)).toEqual(['dir-row-run', 'dir-row-run', 'dir-row-run']);
            expect(Math.round(pill.x - name.x - name.width)).toBe(6);
            expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.dataset.testid,
                [Math.ceil(name.x + name.width) - 1, line.y + line.height / 2])).toBe('dir-row-name');
            await press(row);
            await expect.poll(rowBackground).toBe(rgb(lightTheme.palette.pressed));
            await press(`${row} [data-testid=dir-row-run]`);
            await expect(run).toHaveCSS('background-color', rgb(lightTheme.palette.pressed));
            await expect.poll(rowBackground).toBe(NO_LINE);
            const [tab] = await Promise.all([page.waitForEvent('popup'), page.touchscreen.tap(pill.x + pill.width / 2, pill.y - 3)]);
            await expect(tab.locator('h1')).toHaveText('Tablet app');
            removeFixture(folder);
        });

        test('a tap outside the new row of a folder list keeps a typed name, as a click does', async ({page}) => {
            // arrange
            const folder = 'e2e-mobile/tablet/draft';
            writeFixture(`${folder}/inside.md`, '# Inside\n');
            await page.goto(MAIN.url.dir(folder));
            const draft = page.getByTestId('dir-draft');

            // act & assert
            await page.getByTestId('dir-new-more').tap();
            await expect(page.getByTestId('dir-new-folder')).toBeVisible();
            await page.getByTestId('dir-new-folder').tap();
            await page.getByTestId('dir-draft-input').fill('kept');
            await page.getByTestId('dir-title').tap();
            await expect(draft).toBeVisible();
            await expect(page.getByTestId('dir-draft-input')).toHaveValue('kept');
            expect(fs.existsSync(fixtureFile(`${folder}/kept`))).toBe(false);
            await page.getByTestId('dir-draft-cancel').tap();
            await expect(draft).toHaveCount(0);
        });
    });

    test.describe('the menu of a row in a folder', () => {
        const FOLDER = 'e2e-mobile/menu';
        const rowOf = (page, path) => page.locator(`[data-testid=dir-row][data-path="${path}"]`);

        test('a long press opens the sheet of the row, which names it and its folder, and Delete takes the file away', async ({page}) => {
            // arrange
            const file = `${FOLDER}/drop-me.md`;
            writeFixture(file, '# Drop me\n');
            await page.goto(MAIN.url.dir(FOLDER));
            const sheet = page.getByTestId('tree-row-menu-dropdown');
            const box = await rowOf(page, file).boundingBox();

            // act
            await longPress(page, box.x + 80, box.y + box.height / 2);

            // assert
            await openedMenu(page, 'tree-row-menu-dropdown');
            await expect(sheet).toContainText(nameOf(file));
            await expect(sheet).toContainText(`/ ${FOLDER.split('/').join(' / ')}`);
            await expect(page).toHaveURL(MAIN.url.dir(FOLDER));
            await shot(page, 'mobile-row-menu');
            await page.getByTestId('tree-row-menu-delete').tap();
            await expect(sheet).toHaveCount(0);
            await expect(rowOf(page, file)).toHaveCount(0);
            expect(fs.existsSync(fixtureFile(file))).toBe(false);
        });

        test('a long press opens the same sheet as the row\'s ⋯', async ({page}) => {
            // arrange
            const file = `${FOLDER}/same-sheet.md`;
            writeFixture(file, '# Same sheet\n');
            await page.goto(MAIN.url.dir(FOLDER));
            const sheet = page.getByTestId('tree-row-menu-dropdown');
            const items = sheet.locator('[data-testid^="tree-row-menu-"]');
            await rowOf(page, file).getByTestId('tree-row-menu').tap();
            await openedMenu(page, 'tree-row-menu-dropdown');
            const fromButton = await items.allTextContents();
            await sheet.getByTestId('sheet-close').tap();
            await expect(sheet).toHaveCount(0);
            const box = await rowOf(page, file).boundingBox();

            // act
            await longPress(page, box.x + 80, box.y + box.height / 2);

            // assert
            await openedMenu(page, 'tree-row-menu-dropdown');
            await expect(items).toHaveText(fromButton);
        });

        test('a tap on the scrim of a row\'s sheet closes it and opens nothing', async ({page}) => {
            // arrange
            const file = `${FOLDER}/lift-me.md`;
            writeFixture(file, '# Lift me\n');
            await page.goto(MAIN.url.dir(FOLDER));
            const box = await rowOf(page, file).boundingBox();
            await longPress(page, box.x + 80, box.y + box.height / 2);
            await openedMenu(page, 'tree-row-menu-dropdown');

            // act
            await page.touchscreen.tap(30, 120);

            // assert
            await expect(page.getByTestId('tree-row-menu-dropdown')).toHaveCount(0);
            await expect(page).toHaveURL(MAIN.url.dir(FOLDER));
        });

        async function startRowRename(page, path) {
            await rowOf(page, path).getByTestId('tree-row-menu').tap();
            await openedMenu(page, 'tree-row-menu-dropdown');
            await page.getByTestId('tree-row-menu-rename').tap();
            await expect(page.getByTestId('dir-rename-input')).toBeFocused();
        }

        async function startBarRename(page, menu) {
            await page.getByTestId(menu).tap();
            await openedMenu(page, `${menu}-dropdown`);
            await page.getByTestId(`${menu}-rename`).tap();
            await expect(page.getByTestId('topbar-title').getByTestId('page-rename-input')).toBeFocused();
        }

        test('Rename turns the name of the row into a field with the cursor before the extension, Done saves, a tap outside cancels and ✕ clears', async ({page}) => {
            // arrange
            const file = `${FOLDER}/rename-me.md`;
            const renamed = `${FOLDER}/renamed-here.md`;
            writeFixture(file, '# Rename me\n');
            await page.goto(MAIN.url.dir(FOLDER));
            const input = page.getByTestId('dir-rename-input');
            const moves = recordMoves(page);

            // act & assert
            await startRowRename(page, file);
            await expect(input).toHaveValue(nameOf(file));
            expect(await input.evaluate((field) => [field.selectionStart, field.selectionEnd]))
                .toEqual([nameOf(file).length - '.md'.length, nameOf(file).length - '.md'.length]);
            expect(await input.evaluate((field) => ({
                enterkeyhint: field.getAttribute('enterkeyhint'),
                autocomplete: field.getAttribute('autocomplete'),
                autocorrect: field.getAttribute('autocorrect'),
                autocapitalize: field.getAttribute('autocapitalize'),
                spellcheck: field.getAttribute('spellcheck'),
                name: field.name,
                id: field.id,
                fontSize: getComputedStyle(field).fontSize,
            }))).toEqual({
                enterkeyhint: 'done',
                autocomplete: 'off',
                autocorrect: 'off',
                autocapitalize: 'off',
                spellcheck: 'false',
                name: '',
                id: '',
                fontSize: '17px',
            });
            await expect(rowOf(page, file).getByTestId('tree-row-menu')).toHaveCount(0);
            await expect(page.locator('.mantine-Modal-content')).toHaveCount(0);
            await shot(page, 'mobile-rename');
            await page.getByTestId('dir-rename-clear').tap();
            await expect(input).toHaveValue('');
            await expect(input).toBeFocused();
            await expect(page.getByTestId('dir-rename-clear')).toHaveCount(0);
            await input.fill('dropped.md');
            await page.getByTestId('dir-title').tap();
            await expect(page.getByTestId('dir-rename-field')).toHaveCount(0);
            await stays(() => moves, [], MOVE_WAIT_MS);
            expect(fs.existsSync(fixtureFile(`${FOLDER}/dropped.md`))).toBe(false);

            await startRowRename(page, file);
            await input.fill('escaped.md');
            await input.press('Escape');
            await expect(page.getByTestId('dir-rename-field')).toHaveCount(0);

            await startRowRename(page, file);
            await input.fill(nameOf(renamed));
            await input.press('Enter');
            await expect(rowOf(page, renamed)).toHaveCount(1);
            await expect(page).toHaveURL(MAIN.url.dir(FOLDER));
            expect([file, renamed, `${FOLDER}/escaped.md`].map((path) => fs.existsSync(fixtureFile(path))))
                .toEqual([false, true, false]);
        });

        test('the row being renamed keeps its look and its separators, its name a gray field of 36px with 8px corners', async ({page}) => {
            // arrange
            const folder = `${FOLDER}/band`;
            const files = ['a-first', 'b-middle', 'c-last'].map((name) => `${folder}/${name}.md`);
            files.forEach((path) => writeFixture(path, `# ${nameOf(path)}\n`));
            await page.goto(MAIN.url.dir(folder));
            const look = (row) => row.evaluate((el) => {
                const rect = el.getBoundingClientRect();
                const icon = el.querySelector('svg').getBoundingClientRect();
                return {
                    height: rect.height,
                    iconLeft: icon.left,
                    background: getComputedStyle(el).backgroundColor,
                    separators: [getComputedStyle(el, '::after').display, getComputedStyle(el.nextElementSibling, '::after').display],
                };
            });
            const before = await look(rowOf(page, files[1]));

            // act
            await startRowRename(page, files[1]);

            // assert
            expect(await look(rowOf(page, files[1]))).toEqual(before);
            expect(before.separators).toEqual(['block', 'block']);
            const box = page.getByTestId('dir-rename-input').locator('..');
            expect(await box.evaluate((el) => {
                const style = getComputedStyle(el);
                return {height: el.getBoundingClientRect().height, radius: style.borderRadius, background: style.backgroundColor};
            })).toEqual({height: 36, radius: '8px', background: rgb(lightTheme.palette.groupedField)});
            const clear = await page.getByTestId('dir-rename-clear').locator('svg').boundingBox();
            expect([clear.width, clear.height]).toEqual([17, 17]);
        });

        test('a tap outside cancels the field even when the field keeps the focus', async ({page}) => {
            // arrange
            const file = `${FOLDER}/kept-focus.md`;
            writeFixture(file, '# Kept focus\n');
            await page.goto(MAIN.url.dir(FOLDER));
            const moves = recordMoves(page);
            await startRowRename(page, file);
            await page.getByTestId('dir-rename-input').fill('kept-focus-dropped.md');

            // act
            await page.getByTestId('dir-title').dispatchEvent('click');

            // assert
            await expect(page.getByTestId('dir-rename-field')).toHaveCount(0);
            await stays(() => moves, [], MOVE_WAIT_MS);
            expect(fs.existsSync(fixtureFile(file))).toBe(true);
        });

        test('a field that lost the focus stays open and sends nothing', async ({page}) => {
            // arrange
            const file = `${FOLDER}/blurred.md`;
            writeFixture(file, '# Blurred\n');
            await page.goto(MAIN.url.dir(FOLDER));
            const moves = recordMoves(page);
            await startRowRename(page, file);
            const input = page.getByTestId('dir-rename-input');
            await input.fill('blurred-typed.md');

            // act
            await input.blur();

            // assert
            await stays(() => moves, [], MOVE_WAIT_MS);
            await expect(input).toHaveValue('blurred-typed.md');
        });

        test('after a failed save a tap outside cancels and sends nothing again', async ({page}) => {
            // arrange
            const file = `${FOLDER}/fail-once.md`;
            const taken = `${FOLDER}/fail-taken.md`;
            writeFixture(file, '# Fail once\n');
            writeFixture(taken, '# Taken\n');
            await page.goto(MAIN.url.dir(FOLDER));
            const input = page.getByTestId('dir-rename-input');
            const moves = recordMoves(page);
            await startRowRename(page, file);
            await input.fill(nameOf(taken));
            await input.press('Enter');
            await expect(page.locator('[data-testid=toast][data-kind="error"]')).toContainText(text.nameTaken);

            // act
            await page.getByTestId('dir-title').tap();

            // assert
            await expect(page.getByTestId('dir-rename-field')).toHaveCount(0);
            await stays(() => moves, [{from: file, to: taken}], MOVE_WAIT_MS);
            expect([file, taken].map((path) => fs.existsSync(fixtureFile(path)))).toEqual([true, true]);
        });

        test('Rename from the sheet of a long press closes it at once, and the first tap outside cancels', async ({page}) => {
            // arrange
            const file = `${FOLDER}/lift-rename.md`;
            writeFixture(file, '# Lift rename\n');
            await page.goto(MAIN.url.dir(FOLDER));
            const box = await rowOf(page, file).boundingBox();
            await longPress(page, box.x + 80, box.y + box.height / 2);
            await openedMenu(page, 'tree-row-menu-dropdown');
            const input = page.getByTestId('dir-rename-input');
            const moves = recordMoves(page);

            // act & assert
            await page.getByTestId('tree-row-menu-rename').tap();
            await expect(page.getByTestId('tree-row-menu-dropdown')).toHaveCount(0);
            await expect(input).toBeFocused();
            await input.fill('lift-dropped.md');
            await page.getByTestId('dir-title').tap();
            await expect(page.getByTestId('dir-rename-field')).toHaveCount(0);
            await stays(() => moves, [], MOVE_WAIT_MS);
        });

        test.describe('with the keyboard up', () => {
            const KEYBOARD = 320;

            async function withKeyboard(page) {
                await page.addInitScript(() => {
                    const view = Object.assign(new EventTarget(), {offsetTop: 0, height: window.innerHeight});
                    Object.defineProperty(window, 'visualViewport', {value: view, configurable: true});
                });
            }

            async function raiseKeyboard(page) {
                await page.evaluate((keyboard) => {
                    window.visualViewport.height = window.innerHeight - keyboard;
                    window.visualViewport.dispatchEvent(new Event('resize'));
                }, KEYBOARD);
            }

            test('a row the keyboard leaves free does not scroll the page', async ({page}) => {
                // arrange
                const folder = `${FOLDER}/free`;
                const file = `${folder}/top.md`;
                writeFixture(file, '# Top\n');
                await withKeyboard(page);
                await page.goto(MAIN.url.dir(folder));
                await startRowRename(page, file);

                // act
                await raiseKeyboard(page);

                // assert
                await stays(() => page.evaluate(() => window.scrollY), 0, 300);
            });

            test('a row the keyboard would cover scrolls just above it, 16px over the keys', async ({page}) => {
                // arrange
                const folder = `${FOLDER}/covered`;
                const files = Array.from({length: 9}, (_, index) => `${folder}/row-${index}.md`);
                files.forEach((path) => writeFixture(path, `# ${nameOf(path)}\n`));
                await withKeyboard(page);
                await page.goto(MAIN.url.dir(folder));
                const last = files[files.length - 1];
                await startRowRename(page, last);

                // act
                await raiseKeyboard(page);

                // assert
                await expect.poll(() => rowOf(page, last).evaluate((el, keyboard) =>
                    Math.round(window.innerHeight - keyboard - el.getBoundingClientRect().bottom), KEYBOARD)).toBe(16);
                await expect(page.getByTestId('topbar')).toBeInViewport();
            });
        });

        test('Rename from the menu of an opened note puts the field in the place of the bar\'s title', async ({page}) => {
            // arrange
            const note = `${FOLDER}/bar-rename.md`;
            const renamed = `${FOLDER}/bar-renamed.md`;
            writeFixture(note, '# Bar rename\n\nSome text.\n');
            await page.goto(MAIN.url.doc(note));
            const input = page.getByTestId('topbar-title').getByTestId('page-rename-input');
            const moves = recordMoves(page);

            // act & assert
            await startBarRename(page, 'note-menu');
            await expect(input).toHaveValue(nameOf(note));
            await expect(page.getByTestId('topbar')).toHaveAttribute('data-renaming', 'true');
            await expect(page.getByTestId('topbar-up')).toBeHidden();
            await expect(page.getByTestId('topbar-actions')).toBeHidden();
            await expect(page.getByTestId('note-menu-dropdown')).toHaveCount(0);
            await shot(page, 'mobile-rename-bar');
            await input.fill('bar-dropped.md');
            await page.getByTestId('page-rename-cancel').tap();
            await expect(input).toHaveCount(0);
            await expect(page.getByTestId('topbar-up')).toBeVisible();
            await stays(() => moves, [], MOVE_WAIT_MS);

            await startBarRename(page, 'note-menu');
            await input.fill(nameOf(renamed));
            await input.press('Enter');
            await expect(page).toHaveURL(MAIN.url.doc(renamed));
            expect([note, `${FOLDER}/bar-dropped.md`, renamed].map((path) => fs.existsSync(fixtureFile(path))))
                .toEqual([false, false, true]);
        });

        test('Move to is a sheet as wide as the screen, a tap picks a folder and its button moves the file', async ({page}) => {
            // arrange
            const file = `${FOLDER}/move-me.md`;
            const into = `${FOLDER}/into`;
            writeFixture(file, '# Move me\n');
            fs.mkdirSync(fixtureFile(into), {recursive: true});
            await page.goto(MAIN.url.dir(FOLDER));
            await rowOf(page, file).getByTestId('tree-row-menu').tap();
            await openedMenu(page, 'tree-row-menu-dropdown');
            await page.getByTestId('tree-row-menu-move').tap();
            await expect.poll(async () => Math.round((await page.getByTestId('move-dialog').boundingBox()).width))
                .toBe(page.viewportSize().width);
            await shot(page, 'mobile-move');

            await page.getByTestId('move-input').fill('into');
            await page.locator(`[data-testid=move-place][data-path="${into}"]`).tap();
            await expect(page.getByTestId('move-submit')).toHaveText(`Move to ${nameOf(into)}`);

            // act
            await page.getByTestId('move-submit').tap();

            // assert
            await expect(page.getByTestId('move-dialog')).toHaveCount(0);
            await expect.poll(() => fs.existsSync(fixtureFile(`${into}/move-me.md`))).toBe(true);
            expect(fs.existsSync(fixtureFile(file))).toBe(false);
        });

        test('Move to keeps its button off for the folder the file is in and for a folder that holds its name', async ({page}) => {
            // arrange
            const name = 'twin.md';
            const file = `${FOLDER}/${name}`;
            const other = `${FOLDER}/holds-twin`;
            writeFixture(file, '# Twin\n');
            writeFixture(`${other}/${name}`, '# Other twin\n');
            await page.goto(MAIN.url.dir(FOLDER));
            await rowOf(page, file).getByTestId('tree-row-menu').tap();
            await openedMenu(page, 'tree-row-menu-dropdown');
            await page.getByTestId('tree-row-menu-move').tap();
            await page.getByTestId('move-input').fill(nameOf(FOLDER));
            const here = page.locator(`[data-testid=move-place][data-path="${FOLDER}"]`);
            await expect(here).toHaveAttribute('data-current', 'true');

            // act & assert
            await here.tap({force: true});
            await expect(page.getByTestId('move-submit')).toHaveText('Move');
            await expect(page.getByTestId('move-submit')).toBeDisabled();

            await page.getByTestId('move-input').fill(nameOf(other));
            await page.locator(`[data-testid=move-place][data-path="${other}"]`).tap();
            await expect(page.getByTestId('move-taken')).toHaveText(`${nameOf(other)} already holds ${name}`);
            await expect(page.getByTestId('move-submit')).toBeDisabled();
            removeFixture(other);
            removeFixture(file);
        });

        test('Cancel in Move to closes it and moves nothing', async ({page}) => {
            // arrange
            const file = `${FOLDER}/stay-put.md`;
            writeFixture(file, '# Stay put\n');
            await page.goto(MAIN.url.dir(FOLDER));
            await rowOf(page, file).getByTestId('tree-row-menu').tap();
            await openedMenu(page, 'tree-row-menu-dropdown');
            await page.getByTestId('tree-row-menu-move').tap();
            await expect(page.getByTestId('move-dialog')).toBeVisible();

            // act
            await page.getByTestId('move-dialog').getByTestId('sheet-close').tap();

            // assert
            await expect(page.getByTestId('move-dialog')).toHaveCount(0);
            await expect(page).toHaveURL(MAIN.url.dir(FOLDER));
            expect(fs.existsSync(fixtureFile(file))).toBe(true);
        });

        test('a tap on the folder in the toast of a move opens it and leaves the toast with its Undo', async ({page}) => {
            // arrange
            const file = `${FOLDER}/follow-me.md`;
            const into = `${FOLDER}/into`;
            writeFixture(file, '# Follow me\n');
            fs.mkdirSync(fixtureFile(into), {recursive: true});
            await page.goto(MAIN.url.dir(FOLDER));
            await rowOf(page, file).getByTestId('tree-row-menu').tap();
            await openedMenu(page, 'tree-row-menu-dropdown');
            await page.getByTestId('tree-row-menu-move').tap();
            await page.getByTestId('move-input').fill('into');
            await page.locator(`[data-testid=move-place][data-path="${into}"]`).tap();
            await page.getByTestId('move-submit').tap();
            await expect(page.getByTestId('toast-link')).toBeVisible();

            // act
            await page.getByTestId('toast-link').tap();

            // assert
            await expect(page).toHaveURL(MAIN.url.dir(into));
            await expect(rowOf(page, `${into}/follow-me.md`)).toHaveCount(1);
            await expect(page.getByTestId('toast-action')).toBeVisible();
        });

        test('a tap on Undo in the toast puts the moved file back', async ({page}) => {
            // arrange
            const file = `${FOLDER}/undo-me.md`;
            const into = `${FOLDER}/into`;
            writeFixture(file, '# Undo me\n');
            fs.mkdirSync(fixtureFile(into), {recursive: true});
            await page.goto(MAIN.url.dir(FOLDER));
            await rowOf(page, file).getByTestId('tree-row-menu').tap();
            await openedMenu(page, 'tree-row-menu-dropdown');
            await page.getByTestId('tree-row-menu-move').tap();
            await page.getByTestId('move-input').fill('into');
            await page.locator(`[data-testid=move-place][data-path="${into}"]`).tap();
            await page.getByTestId('move-submit').tap();
            await expect.poll(() => fs.existsSync(fixtureFile(`${into}/undo-me.md`))).toBe(true);
            await shot(page, 'mobile-move-undo');

            // act
            await page.getByTestId('toast-action').tap();

            // assert
            await expect.poll(() => fs.existsSync(fixtureFile(file))).toBe(true);
            expect(fs.existsSync(fixtureFile(`${into}/undo-me.md`))).toBe(false);
        });

        test('offers Edit for a note and not for a picture the editor cannot open', async ({page}) => {
            // arrange
            const note = `${FOLDER}/editable.md`;
            const picture = `${FOLDER}/picture.png`;
            writeFixture(note, '# Editable\n');
            writeFixture(picture, 'not really a png');
            await page.goto(MAIN.url.dir(FOLDER));

            // act & assert
            await rowOf(page, note).getByTestId('tree-row-menu').tap();
            await openedMenu(page, 'tree-row-menu-dropdown');
            await expect(page.getByTestId('tree-row-menu-edit')).toBeVisible();
            await page.touchscreen.tap(30, 120);
            await expect(page.getByTestId('tree-row-menu-dropdown')).toHaveCount(0);

            await rowOf(page, picture).getByTestId('tree-row-menu').tap();
            await openedMenu(page, 'tree-row-menu-dropdown');
            await expect(page.getByTestId('tree-row-menu-rename')).toBeVisible();
            await expect(page.getByTestId('tree-row-menu-edit')).toHaveCount(0);
        });

        test('a tap on a row below an open menu only closes the menu', async ({page}) => {
            // arrange
            const folder = 'e2e-mobile/below';
            const files = ['first', 'second', 'third', 'fourth'].map((name) => `${folder}/below-${name}.md`);
            for (const path of files) {
                writeFixture(path, '# Below\n');
            }
            await page.goto(MAIN.url.dir(folder));
            await rowOf(page, files[0]).getByTestId('tree-row-menu').tap();
            await openedMenu(page, 'tree-row-menu-dropdown');
            const box = await rowOf(page, files[3]).boundingBox();

            // act
            await page.touchscreen.tap(box.x + 20, box.y + box.height / 2);

            // assert
            await expect(page.getByTestId('tree-row-menu-dropdown')).toHaveCount(0);
            await expect(page).toHaveURL(MAIN.url.dir(folder));
            removeFixture(folder);
        });

        test('a finger resting beside an open menu leaves the row of the menu as it is', async ({page}) => {
            // arrange
            const file = `${FOLDER}/rest-beside.md`;
            writeFixture(file, '# Rest beside\n');
            await page.goto(MAIN.url.dir(FOLDER));
            const row = rowOf(page, file);
            await row.getByTestId('tree-row-menu').tap();
            await openedMenu(page, 'tree-row-menu-dropdown');
            const box = await row.boundingBox();
            const cdp = await page.context().newCDPSession(page);

            // act
            await cdp.send('Input.dispatchTouchEvent', {
                type: 'touchStart', touchPoints: [{x: box.x + 20, y: box.y + box.height / 2}],
            });
            await page.waitForTimeout(LONG_PRESS_HOLD);

            // assert
            await expect(row).toHaveAttribute('data-holding', 'false');
            await expect(page.getByTestId('tree-row-menu-dropdown')).toBeVisible();
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchCancel', touchPoints: []});
        });

        test('opens from the row\'s own button, which leaves the row as it is', async ({page}) => {
            // arrange
            const file = `${FOLDER}/keep-me.md`;
            writeFixture(file, '# Keep me\n');
            await page.goto(MAIN.url.dir(FOLDER));

            // act
            await rowOf(page, file).getByTestId('tree-row-menu').tap();

            // assert
            await expect(page.getByTestId('tree-row-menu-dropdown')).toBeVisible();
            await expect(page.getByTestId('tree-row-menu-rename')).toBeVisible();
            expect(await rowOf(page, file).evaluate((el) => getComputedStyle(el, '::before').opacity)).toBe('0');
        });
    });

    test('a long press on the chrome selects nothing, and the text of a note still selects', async ({page}) => {
        // act
        await page.goto(routes.doc(DOC));

        // assert
        await expect(page.getByTestId('note-bar')).toHaveCSS('user-select', 'none');
        await expect(page.getByTestId('topbar')).toHaveCSS('user-select', 'none');
        await expect(page.getByTestId('doc')).toHaveCSS('user-select', 'text');
    });

    test('Recent lists a note opened, keeps it after a reload, and its menu clears it', async ({page}) => {
        // arrange
        await page.goto(routes.doc(DOC));
        await expect(page.getByTestId('doc')).toBeVisible();

        // act
        await page.goto(routes.recent());

        // assert
        await expect(page.getByTestId('tab-search')).toHaveAttribute('data-current', 'true');
        await expect(page.getByTestId('recent-item').first()).toHaveAttribute('data-path', DOC);
        await page.reload();
        await expect(page.getByTestId('recent-item').first()).toHaveAttribute('data-path', DOC);
        await shot(page, 'mobile-recent');

        await page.getByTestId('recent-menu').tap();
        await page.getByTestId('recent-menu-clear').tap();
        await expect(page.getByTestId('recent-item')).toHaveCount(0);
        await expect(page.getByTestId('recent-empty-title')).toHaveText('Nothing opened yet');
    });

    test('the faint name of a new note in the editor bar is a full tap', async ({page}) => {
        // arrange
        const folder = 'e2e-mobile/new-note-tap';
        fs.mkdirSync(fixtureFile(folder), {recursive: true});

        // act
        await page.goto(routes.draft(`${folder}/${text.create.untitled}`));

        // assert
        await expect(page.getByTestId('topbar-draft-name')).toHaveText(text.create.untitled);
        const bar = await page.getByTestId('topbar').boundingBox();
        expect(await hitsDown(page, bar.x + bar.width / 2, bar)).toEqual(['topbar-draft-name', 'topbar-draft-name', 'topbar-draft-name']);
        removeFixture(folder);
    });

    test('New offers a note and a folder, and New note opens a draft named in the bar', async ({page}) => {
        // arrange
        const folder = 'e2e-mobile/new-note';
        const named = `${folder}/Phone-Plan.md`;
        fs.mkdirSync(fixtureFile(folder), {recursive: true});
        await page.goto(routes.dir(folder));
        await expect(page.getByTestId('dir-empty')).toBeVisible();
        const barName = page.getByTestId('topbar-draft-name');
        const nameInput = page.getByTestId('topbar').getByTestId('draft-name-input');

        // act & assert
        await page.getByTestId('tab-new').tap();
        await openedMenu(page, 'new-menu');
        await expect(page.getByTestId('new-menu').locator('[data-testid^=new-menu-]')).toHaveText([text.create.folder, text.create.note]);
        await page.getByTestId('new-menu-note').tap();
        await expect(page).toHaveURL(MAIN.url.draft(`${folder}/${text.create.untitled}`));
        await expect(page.locator('[data-testid=editor-source] .cm-content')).toBeFocused();
        await expect(barName).toHaveText(text.create.untitled);
        await setSource(page, '# Made on a phone\n');
        await expect(barName).toHaveText('made-on-a-phone.md');
        await shot(page, 'mobile-new-draft');

        await barName.tap();
        await expect(nameInput).toBeFocused();
        await nameInput.fill('Phone Plan');
        await nameInput.press('Enter');
        await expect(barName).toHaveText(nameOf(named));
        await page.getByTestId('editor-save').tap();
        await expect(page).toHaveURL(MAIN.url.doc(named));
        expect(readFixture(named)).toBe('# Made on a phone\n');
        removeFixture(folder);
    });

    test('New folder from the create sheet of a missing note shows a row after the folders of its folder, with a ✕ to drop it', async ({page}) => {
        // arrange
        const folder = 'e2e-mobile/new-folder';
        fs.mkdirSync(fixtureFile(`${folder}/inner`), {recursive: true});
        writeFixture(`${folder}/note.md`, '# Note\n');
        await page.goto(routes.doc(`${folder}/missing.md`));
        const draft = page.getByTestId('dir-draft');
        const listed = () => page.getByTestId('dir-table').locator('[data-testid=dir-row], [data-testid=dir-draft]')
            .evaluateAll((rows) => rows.map((el) => el.dataset.path ?? el.dataset.testid));

        // act & assert
        await page.getByTestId('tab-new').tap();
        await page.getByTestId('new-menu-folder').tap();
        await expect(page).toHaveURL(MAIN.url.dir(folder));
        await expect(draft).toHaveAttribute('data-entry', 'dir');
        expect(await listed()).toEqual([`${folder}/inner`, 'dir-draft', `${folder}/note.md`]);
        await shot(page, 'mobile-new-folder');
        await page.getByTestId('dir-draft-cancel').tap();
        await expect(draft).toHaveCount(0);

        await page.getByTestId('tab-new').tap();
        await page.getByTestId('new-menu-folder').tap();
        await page.getByTestId('dir-draft-input').fill('made');
        await page.getByTestId('dir-draft-input').press('Enter');
        await expect(page).toHaveURL(MAIN.url.dir(`${folder}/made`));
        await expect(page.locator('[data-testid=toast][data-kind="ok"]')).toContainText(text.toast.folderCreated);
        removeFixture(folder);
    });

    test('the row of a new folder fills its row of the group in gray, with no separator above or below it', async ({page}) => {
        // arrange
        await page.goto(routes.home());

        // act
        await page.getByTestId('tab-new').tap();
        await page.getByTestId('new-menu-folder').tap();

        // assert
        const draft = page.getByTestId('dir-draft');
        await expect(draft).toBeVisible();
        const {band, group, rowHeight} = await namingBand(draft);
        expect(band).toEqual({
            edges: group,
            background: rgb(lightTheme.palette.hover),
            height: rowHeight,
            separators: ['none', 'none'],
        });
    });

    test('the note menu is a sheet from the bottom: the export tiles, the actions, Delete apart and the word count', async ({page}) => {
        // arrange
        await page.goto(routes.doc(DOC));

        // act
        await page.getByTestId('note-menu').tap();

        // assert
        await openedMenu(page, 'note-menu-dropdown');
        const sheet = page.getByTestId('note-menu-dropdown');
        const menu = await boxOf(page, 'note-menu-dropdown');
        const view = page.viewportSize();
        expect([menu.left, menu.right, menu.bottom].map(Math.round)).toEqual([0, view.width, view.height]);
        expect(await sheet.locator('[data-testid^=doc-export-], [data-testid^=note-menu-]')
            .evaluateAll((items) => items.map((el) => el.dataset.testid))).toEqual([
            'doc-export-md', 'doc-export-html', 'doc-export-pdf',
            'note-menu-copy-link', 'note-menu-rename', 'note-menu-move', 'note-menu-delete', 'note-menu-about',
        ]);
        await expect(sheet.locator('[data-testid^=doc-export-]')).toHaveText(['Markdown', 'HTML', 'PDF']);
        await expect(page.getByTestId('note-menu-about')).toHaveText(/^[\d,]+ words · Last edited /);
        await expect(page.getByTestId('note-menu-delete')).toHaveCSS('color', rgb(lightTheme.blocks.red.text));
        expect(await tooSmall(page, '[data-testid=note-menu-dropdown] :is(button, a)')).toEqual([]);
        await shot(page, 'mobile-note-menu-open');
    });

    test('a tap on Copy link in the note sheet closes it and copies the link of the note', async ({page}) => {
        // arrange
        await page.goto(routes.doc(DOC));
        await page.getByTestId('note-menu').tap();
        await openedMenu(page, 'note-menu-dropdown');

        // act
        await page.getByTestId('note-menu-copy-link').tap();

        // assert
        await expect(page.getByTestId('note-menu-dropdown')).toHaveCount(0);
        await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain(routes.doc(DOC));
    });

    test('the Profile tab opens the profile page with the account, the spaces, the theme and Sign out', async ({page}) => {
        // act
        await openProfile(page);

        // assert
        await expect(page).toHaveURL(routes.profile());
        await expect(page.getByTestId('topbar-tab-title')).toHaveText('Profile');
        await expect(page.getByTestId('tab-profile')).toHaveAttribute('data-current', 'true');
        await expect(page.getByTestId('profile-user')).toHaveText(user);
        await expect(page.getByTestId('profile-account').getByTestId('avatar')).toHaveText(user.charAt(0).toUpperCase());
        await expect(page.getByTestId('profile-space-item').filter({has: page.getByTestId('profile-space-current')}))
            .toHaveText(MAIN.space);
        await expect(page.getByTestId('profile-theme')).toBeVisible();
        await expect(page.getByTestId('profile-signout')).toBeVisible();
        await expect(page.getByTestId('space-menu-shortcuts')).toHaveCount(0);
        await expect(page.getByTestId('topbar-up')).toHaveCount(0);
        await expect(page.locator('main')).toHaveCSS('background-color', rgb(lightTheme.palette.groupedBg));
        expect(await tooSmall(page, '[data-testid=profile-page] :is(a, button)')).toEqual([]);
        await shot(page, 'mobile-profile');
    });

    test('Sign out on the profile page leads to the sign-in screen', async ({page}) => {
        // arrange
        await openProfile(page);

        // act
        await page.getByTestId('profile-signout').tap();

        // assert
        await expect(page).toHaveURL(new RegExp(`^${MAIN.baseURL}/login\\?from=`));
        await expect(page.locator('form.login-box')).toBeVisible();
    });

    test('the profile page of a read-only space names the mode in a row of its own', async ({page}) => {
        // arrange
        await mockMe(page, {}, {read_only: true});

        // act
        await openProfile(page);

        // assert
        await expect(page.getByTestId('profile-readonly')).toHaveText('Read-only mode');
        await expect(page.getByTestId('profile-signout')).toBeVisible();
    });

    test('the profile page of no user offers Sign in, which leads to the sign-in screen', async ({page}) => {
        // arrange
        await mockMe(page, {}, {user: ''});
        await openProfile(page);
        await expect(page.getByTestId('profile-signout')).toHaveCount(0);
        await page.context().clearCookies();

        // act
        await page.getByTestId('profile-signin').tap();

        // assert
        await expect(page).toHaveURL(new RegExp(`^${MAIN.baseURL}/login`));
        await expect(page.locator('form.login-box')).toBeVisible();
    });

    test('Offline access and Sign out are one-line rows of 48px in groups of their own, the icon and the switch centered', async ({page}) => {
        // act
        await openProfile(page);

        // assert
        const geometry = await page.evaluate(() => {
            const middle = (element) => {
                const box = element.getBoundingClientRect();
                return box.top + box.height / 2;
            };
            const device = document.querySelector('[data-testid=profile-device]');
            const offlineGroup = device.firstElementChild;
            const signOut = document.querySelector('[data-testid=profile-signout]');
            return {
                offlineHeight: offlineGroup.getBoundingClientRect().height,
                offlineRows: offlineGroup.childElementCount,
                iconOff: Math.abs(middle(offlineGroup.querySelector('svg')) - middle(offlineGroup)),
                switchOff: Math.abs(middle(offlineGroup.querySelector('.mantine-Switch-track')) - middle(offlineGroup)),
                signOutHeight: signOut.getBoundingClientRect().height,
                signOutRows: signOut.parentElement.childElementCount,
                signOutIconOff: Math.abs(middle(signOut.querySelector('svg')) - middle(signOut)),
                gap: signOut.parentElement.getBoundingClientRect().top - device.getBoundingClientRect().bottom,
            };
        });
        expect(geometry).toEqual({
            offlineHeight: 48,
            offlineRows: 1,
            iconOff: expect.any(Number),
            switchOff: expect.any(Number),
            signOutHeight: 48,
            signOutRows: 1,
            signOutIconOff: expect.any(Number),
            gap: 14,
        });
        expect(Math.max(geometry.iconOff, geometry.switchOff, geometry.signOutIconOff)).toBeLessThanOrEqual(1);
        await expect(page.getByTestId('profile-offline-status')).toHaveCount(0);
        await expect(page.getByTestId('profile-signout')).toHaveCSS('color', rgb(lightTheme.blocks.red.text));
    });

    test('a tap beside an open menu closes it and opens nothing', async ({page}) => {
        // arrange
        await page.goto(routes.dir(docs.folder.path));
        const row = page.locator(`[data-testid=dir-row][data-path="${docs.folder.entry}"]`);
        await expect(row).toBeVisible();
        await page.getByTestId('dir-row').first().getByTestId('tree-row-menu').tap();
        await openedMenu(page, 'tree-row-menu-dropdown');
        const box = await row.boundingBox();

        // act
        await page.touchscreen.tap(box.x + 20, box.y + box.height / 2);

        // assert
        await expect(page.getByTestId('tree-row-menu-dropdown')).toHaveCount(0);
        await expect(page).toHaveURL(MAIN.url.dir(docs.folder.path));
    });

    test('a back from a note left in the editor goes to its folder and not into the editor', async ({page}) => {
        // arrange
        await page.goto(MAIN.url.dir(docs.doc.folder));
        await page.locator(`[data-testid=dir-row][data-path="${DOC}"]`).tap();
        await expect(page.getByTestId('doc')).toBeVisible();
        await page.getByTestId('note-bar-edit').tap();
        await page.getByTestId('editor-cancel').tap();
        await expect(page.getByTestId('doc')).toBeVisible();

        // act
        await page.goBack();

        // assert
        await expect(page).toHaveURL(MAIN.url.dir(docs.doc.folder));
    });

    test('the way up goes back to the folder a note was opened from and leaves the note out of the history', async ({page}) => {
        // arrange
        await page.goto(routes.home());
        await page.locator(`[data-testid=dir-row][data-path="${docs.doc.folder}"]`).tap();
        await page.locator(`[data-testid=dir-row][data-path="${DOC}"]`).tap();
        await expect(page.getByTestId('doc')).toBeVisible();

        // act
        await page.getByTestId('topbar-up').tap();
        await expect(page).toHaveURL(MAIN.url.dir(docs.doc.folder));
        await page.goBack();

        // assert
        await expect(page).toHaveURL(atHome());
    });

    test('the way up leaves the note out of the history for a folder whose name the server and the app encode apart', async ({page}) => {
        // arrange
        const folder = "e2e-mobile-way (up)!'";
        const note = `${folder}/n.md`;
        writeFixture(note, '# N\n');
        await page.goto(routes.home());
        await page.locator(`[data-testid=dir-row][data-path="${folder}"]`).tap();
        await page.locator(`[data-testid=dir-row][data-path="${note}"]`).tap();
        await expect(page.getByTestId('doc')).toBeVisible();

        // act
        await page.getByTestId('topbar-up').tap();
        await expect(page.locator(`[data-testid=dir-row][data-path="${note}"]`)).toBeVisible();
        await page.goBack();

        // assert
        await expect(page).toHaveURL(atHome());
        removeFixture(folder);
    });

    test('Edit in the bar opens the editor', async ({page}) => {
        // arrange
        await page.goto(routes.doc(DOC));
        await expect(page.getByTestId('doc-edit')).toHaveCount(0);

        // act
        await page.getByTestId('note-bar-edit').tap();

        // assert
        await expect(page).toHaveURL(MAIN.url.edit(DOC));
        await expect(page.getByTestId('tab-bar')).toHaveCount(0);
    });

    test('the tab bar stays where it is while the page scrolls', async ({page}) => {
        // arrange
        await page.goto(routes.home());
        await expect(page.getByTestId('dir-row').first()).toBeVisible();
        await page.evaluate(() => {
            const filler = document.createElement('div');
            filler.style.height = '3000px';
            document.querySelector('.mantine-AppShell-main').append(filler);
        });
        const barTop = async () => Math.round((await page.getByTestId('tab-bar').boundingBox()).y);
        const before = await barTop();

        // act
        await page.mouse.wheel(0, 600);
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

        // assert
        expect(await barTop()).toEqual(before);
    });

    test('the reader ends a scroll with the rubber band of an app, and the editor without', async ({page}) => {
        // arrange
        const overscroll = () => page.evaluate(() => getComputedStyle(document.documentElement).overscrollBehaviorY);

        // act & assert
        await page.goto(routes.doc(DOC));
        await expect(page.getByTestId('doc')).toBeVisible();
        expect(await overscroll()).toBe('auto');
        await page.goto(routes.edit(DOC));
        await expect(page.getByTestId('editor')).toBeVisible();
        expect(await overscroll()).toBe('none');
    });

    test('a folder list that fits the screen does not scroll', async ({page}) => {
        // arrange
        const folder = 'e2e-mobile/short';
        const names = ['one', 'two', 'three', 'four', 'five', 'six', 'seven'];
        for (const stem of names) {
            writeFixture(`${folder}/${stem}.md`, `# ${stem}\n`);
        }

        // act
        await page.goto(MAIN.url.dir(folder));
        await expect(page.getByTestId('dir-row')).toHaveCount(names.length);

        // assert
        const room = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
        expect(room).toBeLessThanOrEqual(0);
    });

    test('the search takes the whole screen over the tab bar, its card at the bottom, and Cancel puts it away', async ({page}) => {
        // arrange
        await page.goto(routes.home());
        const {width, height} = page.viewportSize();

        // act
        await page.getByTestId('tab-search').tap();

        // assert
        await expect(page.getByTestId('search-input')).toBeVisible();
        const dialog = await boxOf(page, 'search-dialog');
        expect([dialog.top, dialog.bottom]).toEqual([0, height]);
        const card = await boxOf(page, 'search-card');
        expect([card.left, card.right, card.bottom]).toEqual([8, width - 8, height - 8]);
        const field = await boxOf(page, 'search-input');
        const mode = await boxOf(page, 'search-mode');
        const hint = await boxOf(page, 'search-hint');
        expect(mode.bottom).toBeLessThanOrEqual(hint.top);
        expect(hint.bottom).toBeLessThanOrEqual(field.top);
        await expect(page.getByTestId('search-footer')).toHaveCount(0);
        const titles = await boxOf(page, 'search-titles');
        expect([mode.bottom - mode.top, titles.bottom - titles.top]).toEqual([CHOICE_HEIGHT, CHOICE_HEIGHT]);
        await expect(page.getByTestId('search-titles')).toHaveCSS('border-radius', `${CHOICE_HEIGHT / 2}px`);
        const sizes = [];
        for (const name of ['search-case', 'search-word', 'search-regex', 'search-close']) {
            const box = await boxOf(page, name);
            sizes.push(box.right - box.left >= CHOICE_HEIGHT && box.bottom - box.top >= MIN_TAP);
        }
        expect(sizes).toEqual([true, true, true, true]);
        const covered = await page.evaluate(() => {
            const bar = document.querySelector('[data-testid=tab-bar]')?.getBoundingClientRect();
            return bar === undefined
                || document.querySelector('[data-testid=search-dialog]').contains(document.elementFromPoint(bar.x + bar.width / 2, bar.y + bar.height / 2));
        });
        expect(covered).toBe(true);
        await shot(page, 'mobile-search-open');

        await page.getByTestId('search-close').tap();
        await expect(page.getByTestId('search-dialog')).toHaveCount(0);
        await expect(page).toHaveURL(atHome());
    });

    test('the search lists the notes opened last, the path under the title, and Clear empties the list', async ({page}) => {
        // arrange
        await page.goto(routes.doc(DOC));
        await expect(page.getByTestId('doc')).toBeVisible();
        await page.goto(routes.home());
        await page.getByTestId('tab-search').tap();
        const item = page.getByTestId('search-recent-item').first();
        await expect(item).toHaveAttribute('data-path', DOC);
        const lines = await item.evaluate((el) => Array.from(el.querySelectorAll('span > span'))
            .map((part) => Math.round(part.getBoundingClientRect().top)));
        expect(lines[0]).toBeLessThan(lines[1]);
        await shot(page, 'mobile-search-recent');

        // act
        await page.getByTestId('search-recent-clear').tap();

        // assert
        await expect(page.getByTestId('search-recent-item')).toHaveCount(0);
        await expect(page.getByTestId('search-recent-empty')).toBeVisible();
    });

    test('the bar shows the title of a note once its own has scrolled away', async ({page}) => {
        // arrange
        await page.goto(routes.doc(docs.long.path));
        const title = page.getByTestId('topbar-title');
        await expect(title).toHaveText(docs.long.title);
        await expect(title).toHaveAttribute('data-shown', 'false');

        // act
        await page.mouse.wheel(0, 400);

        // assert
        await expect(title).toHaveAttribute('data-shown', 'true');
        await expect(page.getByTestId('topbar')).toHaveAttribute('data-scrolled', 'true');
    });

    test('the bar hides the title again and drops its line once the note is scrolled back to the top', async ({page}) => {
        // arrange
        await page.goto(routes.doc(docs.long.path));
        const title = page.getByTestId('topbar-title');
        await expect(title).toHaveText(docs.long.title);
        await page.mouse.wheel(0, 400);
        await expect(title).toHaveAttribute('data-shown', 'true');

        // act
        await page.evaluate(() => window.scrollTo(0, 0));

        // assert
        await expect(title).toHaveAttribute('data-shown', 'false');
        await expect(page.getByTestId('topbar')).toHaveAttribute('data-scrolled', 'false');
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
        await expect(page.getByTestId('editor-panes')).toHaveAttribute('data-mode', 'source');
        await expect(page.getByTestId('editor-layout-mode')).toHaveCount(0);
        await shot(page, 'mobile-editor');

        await setSource(page, '# Заметка\n\nновый текст\n');
        await page.getByTestId('editor-hide-keyboard').tap();
        await expect(page.getByTestId('editor-changes-mark')).toBeVisible();
        await page.getByTestId('editor-tab-preview').tap();
        await expect(page.getByTestId('editor-preview')).toContainText('новый текст');
        await expect(page.getByTestId('editor-panes')).toHaveAttribute('data-mode', 'preview');
        await expect(page.getByTestId('editor-source')).toHaveCount(0);
        await shot(page, 'mobile-editor-preview');

        await page.getByTestId('editor-tab-changes').tap();
        await expect(page.getByTestId('editor-panes')).toHaveAttribute('data-mode', 'changes');
        await expect(page.getByTestId('rendered-diff')).toHaveAttribute('data-layout', 'unified');
        await expect(page.locator('[data-testid=diff-row][data-kind=changed] ins')).toHaveText('новый');
        await shot(page, 'mobile-editor-changes');

        await page.getByTestId('editor-tab-source').tap();
        await expect(page.getByTestId('editor-source')).toBeVisible();
        await expectNoHorizontalScroll(page);

        await page.getByTestId('editor-save').tap();
        await expect(page.locator('[data-testid=toast][data-kind="ok"]')).toContainText(text.toast.saved);
        await expect(page).toHaveURL(MAIN.url.doc(SCRATCH));
        await expect(page.getByTestId('doc')).toContainText('новый текст');
    });

    test('the way back of the editor is drawn as the reader\'s, and its layout tabs are a pill 16px from the edges', async ({page}) => {
        // arrange
        writeFixture(SCRATCH, '# Заметка\n\nтекст\n');
        await page.goto(routes.doc(SCRATCH));
        const reader = await wayBack(page, 'topbar-up');
        const {width, height} = page.viewportSize();

        // act
        await page.goto(routes.edit(SCRATCH));

        // assert
        expect(await wayBack(page, 'editor-cancel')).toEqual(reader);
        expect((await textEdges(page, 'editor-save')).right).toBe(width - reader.left);
        const strip = await boxOf(page, 'editor-strip');
        const tabs = await boxOf(page, 'editor-tabs');
        expect(strip.bottom).toBe(height);
        expect([tabs.left, tabs.right, tabs.bottom - tabs.top]).toEqual([16, width - 16, MIN_TAP]);
        await expect(page.getByTestId('editor-tabs')).toHaveCSS('border-radius', '999px');
        const chosen = page.getByTestId('editor-tab-source').locator('xpath=ancestor::label');
        await expect(chosen).toHaveCSS('font-weight', '600');
    });

    test('the draft offer of the editor starts and ends on the line of the reader\'s way back', async ({page}) => {
        // arrange
        const note = 'e2e-mobile/draft-line.md';
        writeFixture(note, '# Черновик\n');
        await page.goto(routes.doc(note));
        const reader = await wayBack(page, 'topbar-up');
        await page.goto(routes.edit(note));
        await expect.poll(() => sourceText(page)).toBe('# Черновик\n');
        await setSource(page, '# Черновик\n\nне сохранено\n');
        await page.waitForTimeout(PAST_DRAFT_DELAY_MS);

        // act
        await page.goto(routes.edit(note));

        // assert
        await expect(page.getByTestId('editor-draft')).toBeVisible();
        const offer = await page.getByTestId('editor-draft').evaluate((el) => Math.round(el.firstElementChild.getBoundingClientRect().left));
        expect(offer).toBe(reader.left);
        expect((await textEdges(page, 'editor-draft-restore')).right).toBe(page.viewportSize().width - reader.left);
        removeFixture(note);
    });

    test('the editor bar holds the back arrow, the name over the state, and a Save that is gray until there is a change', async ({page}) => {
        // arrange
        writeFixture(SCRATCH, '# Заметка\n\nтекст\n');
        await page.goto(routes.edit(SCRATCH));
        const saveButton = page.getByTestId('editor-save');
        const status = page.getByTestId('editor-status');
        const name = page.getByTestId('topbar-edit-name');
        const mark = page.getByTestId('editor-unsaved-mark');

        // act & assert
        await expect(name).toHaveText(nameOf(SCRATCH));
        await expect(status).toHaveText(text.status.saved);
        await expect(mark).toHaveCount(0);
        await expect(saveButton).toBeDisabled();
        await expect(saveButton).toHaveCSS('color', rgb(lightTheme.palette.textFaint));
        await expect(page.getByTestId('editor-cancel')).toHaveCSS('color', rgb(lightTheme.palette.textSecondary));
        await expect(page.getByTestId('sync-control')).toHaveCount(0);
        const width = page.viewportSize().width;
        const back = await page.getByTestId('editor-cancel').boundingBox();
        const nameBox = await name.boundingBox();
        const statusBox = await status.boundingBox();
        const saveBox = await saveButton.boundingBox();
        expect(back.x + back.width).toBeLessThanOrEqual(nameBox.x);
        expect(nameBox.x + nameBox.width).toBeLessThanOrEqual(saveBox.x);
        expect(Math.round(nameBox.x + nameBox.width / 2)).toBe(width / 2);
        expect(Math.round(statusBox.x + statusBox.width / 2)).toBe(width / 2);
        expect(statusBox.y).toBeGreaterThanOrEqual(nameBox.y + nameBox.height);
        expect(Math.round(saveBox.x + saveBox.width)).toBeLessThanOrEqual(width);

        await setSource(page, '# Заметка\n\nновый текст\n');
        await expect(status).toHaveText(text.status.drafted);
        await expect(mark).toBeVisible();
        await expect(saveButton).toBeEnabled();
        await expect(saveButton).toHaveCSS('color', rgb(lightTheme.palette.accent));
        await expect(saveButton).toHaveCSS('font-weight', '600');
        await shot(page, 'mobile-editor-dirty');

        await saveButton.tap();
        await expect(page).toHaveURL(MAIN.url.doc(SCRATCH));
        expect(readFixture(SCRATCH)).toBe('# Заметка\n\nновый текст\n');
    });

    test('a new note left as it opened can be saved at once', async ({page}) => {
        // arrange
        const folder = 'e2e-mobile/new-untouched';
        const created = `${folder}/${text.create.untitled}`;
        fs.mkdirSync(fixtureFile(folder), {recursive: true});
        await page.goto(routes.draft(created));
        const saveButton = page.getByTestId('editor-save');
        await expect(page.getByTestId('editor-status')).toHaveAttribute('data-state', 'new');
        await expect(saveButton).toBeEnabled();

        // act
        await saveButton.tap();

        // assert
        await expect(page).toHaveURL(MAIN.url.doc(created));
        expect(fs.existsSync(fixtureFile(created))).toBe(true);
        removeFixture(folder);
    });

    test('the bottom of the editor is the layout tabs, and the toolbar over the keyboard while typing', async ({page}) => {
        // arrange
        writeFixture(SCRATCH, '# Заметка\n\nтекст\n');
        await page.goto(routes.edit(SCRATCH));
        const tabs = page.getByTestId('editor-tabs');
        const keyboardBar = page.getByTestId('editor-keyboard-bar');
        const height = page.viewportSize().height;

        // act & assert
        await expect(tabs).toBeVisible();
        await expect(keyboardBar).toHaveCount(0);
        await expect(page.getByTestId('editor-lines')).toHaveCount(0);
        await expect(page.getByTestId('editor-changes-mark')).toHaveCount(0);
        expect(await editorFit(page)).toEqual({sourceOverStrip: true, alertOverSource: 'no banner', scroll: 0});
        const stripBox = await page.getByTestId('editor-strip').boundingBox();
        expect(Math.round(stripBox.y + stripBox.height)).toBe(height);

        await page.locator('[data-testid=editor-source] .cm-line').nth(2).tap();
        await expect(keyboardBar).toBeVisible();
        await expect(tabs).toHaveCount(0);
        const barBox = await boxOf(page, 'editor-keyboard-bar');
        expect([barBox.left, barBox.right, barBox.bottom, barBox.bottom - barBox.top])
            .toEqual([8, page.viewportSize().width - 8, height - 8, 50]);
        const hide = await boxOf(page, 'editor-hide-keyboard');
        expect(barBox.right - hide.right).toBeLessThanOrEqual(8);
        await expect(page.getByTestId('editor-wrap')).toBeVisible();
        await expect(page.getByTestId('editor-toolbar-bold')).toHaveCSS('color', rgb(lightTheme.palette.icon));
        await page.keyboard.type('!');
        await page.getByTestId('editor-toolbar-bold').tap();
        await expect(keyboardBar).toBeVisible();
        await expect(page.locator('[data-testid=editor-source] .cm-content')).toBeFocused();
        await shot(page, 'mobile-editor-typing');

        await page.getByTestId('editor-hide-keyboard').tap();
        await expect(keyboardBar).toHaveCount(0);
        await expect(tabs).toBeVisible();
        await expect(page.getByTestId('editor-changes-mark')).toBeVisible();
        await shot(page, 'mobile-editor-tabs');

        await page.getByTestId('editor-tab-preview').tap();
        await expect(page.getByTestId('editor-panes')).toHaveAttribute('data-mode', 'preview');
        await expect(keyboardBar).toHaveCount(0);
    });

    test('the editor takes the visible area, with the toolbar at its bottom, and knows the keyboard is up', async ({page}) => {
        // arrange
        await fakeVisibleArea(page);
        writeFixture(SCRATCH, '# Заметка\n\nтекст\n');
        await page.goto(routes.edit(SCRATCH));
        await page.locator('[data-testid=editor-source] .cm-line').nth(2).tap();
        await expect(page.getByTestId('editor-keyboard-bar')).toBeVisible();
        const height = page.viewportSize().height;
        const placeAt = async (top, visible) => {
            await moveVisibleArea(page, top, visible);
            return page.evaluate(() => {
                const boxOfId = (testId) => document.querySelector(`[data-testid="${testId}"]`).getBoundingClientRect();
                const strip = boxOfId('editor-strip');
                const source = boxOfId('editor-source');
                const bar = boxOfId('editor-keyboard-bar');
                return {
                    top: Math.round(boxOfId('topbar').top),
                    sourceOverStrip: Math.round(source.bottom) <= Math.round(strip.top),
                    bottom: Math.round(strip.bottom),
                    barGap: Math.round(strip.bottom - bar.bottom),
                    barHeight: Math.round(bar.height),
                    keyboard: document.querySelector('[data-testid=editor]').dataset.keyboard,
                    moved: document.querySelector('.mantine-AppShell-main').style.translate !== ''
                        || getComputedStyle(document.querySelector('.mantine-AppShell-main')).translate !== 'none',
                };
            });
        };
        const raisedTop = 120;
        const raisedVisible = 400;

        // act
        const raised = await placeAt(raisedTop, raisedVisible);
        const lowered = await placeAt(0, height);

        // assert
        expect({raised, lowered}).toEqual({
            raised: {top: raisedTop, sourceOverStrip: true, bottom: raisedTop + raisedVisible, barGap: 8, barHeight: 50, keyboard: 'true', moved: true},
            lowered: {top: 0, sourceOverStrip: true, bottom: height, barGap: 8, barHeight: 50, keyboard: 'false', moved: false},
        });
    });

    test('a text file in the editor takes the visible area too', async ({page}) => {
        // arrange
        await fakeVisibleArea(page);
        writeFixture('e2e-mobile/area.txt', 'строка\n');
        await page.goto(routes.edit('e2e-mobile/area.txt'));
        await expect(page.getByTestId('editor')).toHaveAttribute('data-kind', 'text');
        const raisedTop = 120;
        const raisedVisible = 400;

        // act
        await moveVisibleArea(page, raisedTop, raisedVisible);

        // assert
        const placed = await page.evaluate(() => ({
            top: Math.round(document.querySelector('[data-testid=topbar]').getBoundingClientRect().top),
            bottom: Math.round(document.querySelector('[data-testid=editor]').getBoundingClientRect().bottom),
            keyboard: document.querySelector('[data-testid=editor]').dataset.keyboard,
        }));
        expect(placed).toEqual({top: raisedTop, bottom: raisedTop + raisedVisible, keyboard: 'true'});
    });

    test('leaving the editor takes the visible area off the page', async ({page}) => {
        // arrange
        await fakeVisibleArea(page);
        writeFixture(SCRATCH, '# Заметка\n\nтекст\n');
        await page.goto(routes.edit(SCRATCH));
        await expect(page.getByTestId('editor')).toHaveAttribute('data-keyboard', 'false');
        await moveVisibleArea(page, 120, 400);
        const visibleVars = () => page.evaluate(() => {
            const root = document.documentElement.style;
            return [root.getPropertyValue('--scrawl-visible-height'), root.getPropertyValue('--scrawl-visible-top')];
        });
        await expect.poll(visibleVars).toEqual(['400px', '120px']);

        // act
        await page.getByTestId('editor-cancel').tap();

        // assert
        await expect(page.getByTestId('doc')).toBeVisible();
        expect(await visibleVars()).toEqual(['', '']);
    });

    test('a visible area growing while typing keeps the place the text was scrolled to', async ({page}) => {
        // arrange
        await fakeVisibleArea(page);
        const filler = Array.from({length: 80}, (_, index) => `строка ${index}`).join('\n');
        writeFixture(SCRATCH, `# Заметка\n\n${filler}\n`);
        await page.goto(routes.edit(SCRATCH));
        await page.locator('[data-testid=editor-source] .cm-line').nth(20).tap();
        await expect(page.getByTestId('editor-keyboard-bar')).toBeVisible();
        await moveVisibleArea(page, 0, 400);
        const scroller = page.locator('[data-testid=editor-source] .cm-scroller');
        await scroller.evaluate((el) => { el.scrollTop = 0; });

        // act
        await moveVisibleArea(page, 0, 420);

        // assert
        const scrolled = await scroller.evaluate((el) => new Promise((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve(el.scrollTop)));
        }));
        expect(scrolled).toBe(0);
    });

    test('the keyboard opening scrolls the cursor out from under the toolbar over it', async ({page}) => {
        // arrange
        await fakeVisibleArea(page);
        const filler = Array.from({length: 80}, (_, index) => `строка ${index}`).join('\n');
        writeFixture(SCRATCH, `# Заметка\n\n${filler}\n`);
        await page.goto(routes.edit(SCRATCH));
        await expect(page.locator('[data-testid=editor-source] .cm-line').nth(20)).toBeVisible();
        await page.touchscreen.tap(100, 650);
        await expect(page.getByTestId('editor-keyboard-bar')).toBeVisible();
        const cursorClear = () => page.evaluate(() => {
            const cursor = document.querySelector('[data-testid=editor-source] .cm-cursor-primary').getBoundingClientRect();
            const bar = document.querySelector('[data-testid=editor-keyboard-bar]').getBoundingClientRect();
            return Math.round(cursor.bottom) <= Math.round(bar.top) && cursor.top > 0;
        });

        // act
        await moveVisibleArea(page, 0, 400);

        // assert
        await expect.poll(cursorClear).toBe(true);
    });

    test('a draft offer is a row under the bar with Restore in the accent and buttons big enough to tap', async ({page}) => {
        // arrange
        writeFixture(SCRATCH, '# Заметка\n\nтекст\n');
        await page.goto(routes.edit(SCRATCH));
        await expect.poll(() => sourceText(page)).toBe('# Заметка\n\nтекст\n');
        await setSource(page, '# Заметка\n\nчерновик\n');
        await expect.poll(() => page.evaluate(() => Object.keys(localStorage)
            .some((key) => key.startsWith('scrawl.draft:') && localStorage.getItem(key).includes('черновик')))).toBe(true);
        const width = page.viewportSize().width;

        // act
        await page.goto(routes.edit(SCRATCH));

        // assert
        await expect(page.getByTestId('editor-draft')).toContainText(text.editor.draft);
        const barBottom = await page.locator('.mantine-AppShell-header').evaluate((el) => Math.round(el.getBoundingClientRect().bottom));
        const offer = await boxOf(page, 'editor-draft');
        const restore = await boxOf(page, 'editor-draft-restore');
        const discard = await boxOf(page, 'editor-draft-discard');
        expect({
            top: offer.top, left: offer.left, right: offer.right,
            restoreTall: restore.bottom - restore.top >= MIN_TAP, discardTall: discard.bottom - discard.top >= MIN_TAP,
        }).toEqual({top: barBottom, left: 0, right: width, restoreTall: true, discardTall: true});
        await expect(page.getByTestId('editor-draft-restore')).toHaveCSS('color', rgb(lightTheme.palette.accent));
        await expect(page.getByTestId('editor-draft-discard')).toHaveCSS('color', rgb(lightTheme.palette.textSecondary));
        await expect(page.getByTestId('editor-draft')).toHaveCSS('background-color', rgb(lightTheme.palette.draftBg));
        await shot(page, 'mobile-editor-draft');
    });

    test('a tap on the current tab where its page already is scrolls the page to the top', async ({page}) => {
        // arrange
        await page.goto(routes.home());
        await expect(page.getByTestId('tab-notes')).toHaveAttribute('data-current', 'true');
        await page.evaluate(() => {
            const filler = document.createElement('div');
            filler.style.height = '3000px';
            document.querySelector('.mantine-AppShell-main').append(filler);
            window.scrollTo(0, 1200);
        });
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
        const entries = await page.evaluate(() => window.history.length);

        // act
        await page.getByTestId('tab-notes').tap();

        // assert
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
        await expect(page).toHaveURL(atHome());
        expect(await page.evaluate(() => window.history.length)).toBe(entries);
    });

    test('a tap leaves no gray highlight of the browser on a link or a tab', async ({page}) => {
        // arrange
        await page.goto(routes.dir(docs.folder.path));
        await expect(page.getByTestId('topbar-up')).toBeVisible();

        // act
        const colors = await page.evaluate(() => ['topbar-up', 'tab-notes'].map(
            (testId) => getComputedStyle(document.querySelector(`[data-testid="${testId}"]`)).webkitTapHighlightColor,
        ));

        // assert
        expect(colors).toEqual(['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)']);
    });

    test('an upload in progress shows in the state of the save', async ({page}) => {
        // arrange
        const folder = 'e2e-mobile/upload';
        const notePath = `${folder}/picture.md`;
        writeFixture(notePath, '# Картинка\n\n');
        const {release, reached} = await holdRoute(page, '**/api/upload/**');
        await page.goto(routes.edit(notePath));
        await expect.poll(() => sourceText(page)).toBe('# Картинка\n\n');
        const status = page.getByTestId('editor-status');

        // act & assert
        await page.getByTestId('editor-upload-input').setInputFiles({
            name: 'e2e-phone.png',
            mimeType: 'image/png',
            buffer: Buffer.from(PNG_BASE64, 'base64'),
        });
        await reached;
        await expect(status).toHaveAttribute('data-state', 'uploading');
        await expect(status).toHaveText(text.status.uploading);

        release();
        await expect(status).not.toHaveAttribute('data-state', 'uploading');
        removeFixture(folder);
    });

    test('the table menu of the toolbar keeps the toolbar while it is open and after a pick', async ({page}) => {
        // arrange
        writeFixture(SCRATCH, '# Заметка\n\nтекст\n');
        await page.goto(routes.edit(SCRATCH));
        await page.locator('[data-testid=editor-source] .cm-line').nth(2).tap();

        // act & assert
        await page.getByTestId('editor-toolbar-table').tap();
        await openedMenu(page, 'editor-table-menu');
        await expect(page.getByTestId('editor-keyboard-bar')).toBeVisible();

        await page.getByTestId('editor-table-grid').locator('[data-column="2"][data-row="2"]').tap();
        await expect(page.getByTestId('editor-table-menu')).toBeHidden();
        await expect(page.getByTestId('editor-keyboard-bar')).toBeVisible();
        await expect(page.locator('[data-testid=editor-source] .cm-content')).toBeFocused();
    });

    test('a split kept on a wide screen opens on the Text tab of a phone', async ({page}) => {
        // arrange
        writeFixture(SCRATCH, '# Заметка\n');
        await page.addInitScript(() => localStorage.setItem('scrawl.editor.mode', 'split'));

        // act
        await page.goto(routes.edit(SCRATCH));

        // assert
        await expect(page.getByTestId('editor-panes')).toHaveAttribute('data-mode', 'source');
        await expect(page.getByTestId('editor-tabs').getByRole('radio', {name: 'Text'})).toBeChecked();
        await expect(page.getByTestId('editor-source')).toBeVisible();
    });

    test('a tap on the size grid inserts the table and leaves the cursor in its first cell', async ({page}) => {
        // arrange
        writeFixture(SCRATCH, '# Заметка\n\nтекст\n');
        await page.goto(routes.edit(SCRATCH));
        await page.locator('[data-testid=editor-source] .cm-line').nth(2).tap();
        await page.getByTestId('editor-toolbar-table').tap();
        await openedMenu(page, 'editor-table-menu');

        // act
        await page.getByTestId('editor-table-grid').locator('[data-column="3"][data-row="2"]').tap();
        await page.keyboard.type('A');

        // assert
        await expect(page.getByTestId('editor-table-menu')).toBeHidden();
        await expect.poll(() => sourceText(page)).toBe([
            '# Заметка', '', 'текст', '', '| A    |     |     |', '| --- | --- | --- |', '|     |     |     |', '',
        ].join('\n'));
    });

    test('a text file opens in the editor with no Text and Preview tabs', async ({page}) => {
        // arrange
        const filePath = 'e2e-mobile/plain.txt';
        writeFixture(filePath, 'just text\n');

        // act & assert
        await page.goto(routes.edit(filePath));
        await expect(page.getByTestId('editor')).toHaveAttribute('data-kind', 'text');
        await expect(page.getByTestId('editor-source')).toContainText('just text');
        await expect(page.getByTestId('editor-tabs')).toHaveCount(0);
        await expect(page.getByTestId('editor-language')).toHaveText('Plain text');
        await expect(page.getByTestId('editor-lines')).toBeVisible();
        await expect(page.getByTestId('editor-language').locator('..').getByTestId('editor-wrap')).toBeVisible();
        await shot(page, 'mobile-plain-text-editor');
        await page.locator('[data-testid=editor-source] .cm-line').first().tap();
        await expect(page.locator('[data-testid=editor-source] .cm-content')).toBeFocused();
        await stays(() => page.getByTestId('editor-keyboard-bar').count(), 0, 300);
    });

    test('the editor pane takes the width of the screen', async ({page}) => {
        writeFixture(SCRATCH, '# Заметка\n\nтекст\n');
        await page.goto(routes.edit(SCRATCH));

        const box = await page.getByTestId('editor-source').boundingBox();
        expect(box.width).toBeLessThanOrEqual(390);
        expect(box.width).toBeGreaterThan(300);
    });

    for (const wrap of ['true', 'false']) {
        test(`the editor opens with the heading at the top where it was, and comes back to it, with wrap ${wrap}`, async ({page}) => {
        // arrange
        await page.addInitScript((value) => localStorage.setItem('scrawl.editor.wrap', value), wrap);
        const filler = (mark) => Array.from({length: 12}, (_, index) =>
            `Абзац ${mark}-${index}: длинная строка, которая в редакторе на телефоне переносится `
            + 'на несколько рядов, а на странице занимает меньше места.').join('\n\n');
        writeFixture(SCRATCH, `# Начало\n\n${filler('a')}\n\n## Середина\n\n${filler('b')}\n`);
        await page.goto(routes.doc(SCRATCH));
        const heading = page.locator('[data-testid=doc] h2');
        const onPage = () => heading.evaluate((el) =>
            Math.round(el.getBoundingClientRect().top - document.querySelector('header').getBoundingClientRect().bottom));
        await heading.evaluate((el) => window.scrollTo({
            top: el.getBoundingClientRect().top + window.scrollY
                - document.querySelector('header').getBoundingClientRect().bottom - 8,
            behavior: 'instant',
        }));
        const before = await onPage();

        // act
        await page.getByTestId('note-bar-edit').dispatchEvent('click');
        const inEditor = () => page.locator('.cm-line', {hasText: '## Середина'}).evaluate((line) =>
            Math.round(line.getBoundingClientRect().top - line.closest('[data-testid=editor-source]').getBoundingClientRect().top));

        // assert
        await expect.poll(inEditor).toBeGreaterThanOrEqual(0);
        await expect.poll(inEditor).toBeLessThanOrEqual(before + 4);

        // act
        await page.getByTestId('editor-cancel').tap();

        // assert
        await expect.poll(onPage).toBeGreaterThanOrEqual(before - 2);
        await expect.poll(onPage).toBeLessThanOrEqual(before + 2);
    });
    }

    test('with wrap off a touch screen scrolls the text up and down in the pane and sideways in the editor', async ({page}) => {
        // arrange
        await page.addInitScript(() => localStorage.setItem('scrawl.editor.wrap', 'false'));
        const lines = Array.from({length: 80}, (_, index) => `строка ${index} ${'очень длинная '.repeat(12)}`).join('\n');
        writeFixture(SCRATCH, `# Длинные строки\n\n${lines}\n`);

        // act
        await page.goto(routes.edit(SCRATCH));
        await expect(page.locator('[data-testid=editor-source] .cm-line').nth(10)).toBeVisible();

        // assert
        const scrolls = await page.evaluate(() => {
            const pane = document.querySelector('[data-testid=editor-source]');
            const scroller = pane.querySelector('.cm-scroller');
            const across = (el) => el.scrollWidth > el.clientWidth;
            const down = (el) => el.scrollHeight > el.clientHeight;
            return {
                pane: {x: getComputedStyle(pane).overflowX, y: getComputedStyle(pane).overflowY, down: down(pane)},
                scroller: {x: getComputedStyle(scroller).overflowX, y: getComputedStyle(scroller).overflowY, across: across(scroller)},
            };
        });
        expect(scrolls).toEqual({
            pane: {x: 'hidden', y: 'auto', down: true},
            scroller: {x: 'auto', y: 'hidden', across: true},
        });
    });

    test('with wrap off a tap below a short text puts the cursor in the editor', async ({page}) => {
        // arrange
        await page.addInitScript(() => localStorage.setItem('scrawl.editor.wrap', 'false'));
        writeFixture(SCRATCH, '# Коротко\n\nодна строка\n');
        await page.goto(routes.edit(SCRATCH));
        const pane = page.getByTestId('editor-source');
        await expect(pane).toHaveAttribute('data-scroll', 'outer');
        const last = await pane.locator('.cm-line').last().boundingBox();

        // act
        await page.touchscreen.tap(last.x + 40, last.y + last.height + 80);

        // assert
        await expect(pane.locator('.cm-editor')).toHaveClass(/cm-focused/);
    });

    test('a line inside a code block survives the trip to the editor and back', async ({page}) => {
        // arrange
        const code = Array.from({length: 150}, (_, index) => `line_${index} = ${index}`).join('\n');
        writeFixture(SCRATCH, `# Код\n\nВступление.\n\n\`\`\`python\n${code}\n\`\`\`\n\nКонец.\n`);
        await page.goto(routes.doc(SCRATCH));
        const row = page.locator('[data-testid=doc] pre .line', {hasText: 'line_60 ='});
        const onPage = () => row.evaluate((el) =>
            Math.round(el.getBoundingClientRect().top - document.querySelector('header').getBoundingClientRect().bottom));
        await row.evaluate((el) => window.scrollTo({
            top: el.getBoundingClientRect().top + window.scrollY
                - document.querySelector('header').getBoundingClientRect().bottom - 30,
            behavior: 'instant',
        }));
        const before = await onPage();
        const editorLine = page.locator('.cm-line', {hasText: 'line_60 ='});
        const inEditor = () => editorLine.evaluate((line) =>
            Math.round(line.getBoundingClientRect().top - line.closest('.cm-scroller').getBoundingClientRect().top));

        for (let round = 0; round < 2; round++) {
            // act
            await page.getByTestId('note-bar-edit').dispatchEvent('click');

            // assert
            const lineHeight = await editorLine.evaluate((line) => line.getBoundingClientRect().height);
            await expect.poll(inEditor).toBeGreaterThanOrEqual(0);
            await expect.poll(inEditor).toBeLessThanOrEqual(before + lineHeight);

            // act
            await page.getByTestId('editor-cancel').tap();

            // assert
            await expect.poll(onPage).toBeGreaterThanOrEqual(before - 2);
            await expect.poll(onPage).toBeLessThanOrEqual(before + 2);
        }
    });

    test('the back arrow with unsaved changes asks nothing and says the draft is kept', async ({page}) => {
        // arrange
        writeFixture(SCRATCH, '# Заметка\n');
        await page.goto(routes.edit(SCRATCH));
        await setSource(page, '# Заметка\n\nправка\n');

        // act
        await page.getByTestId('editor-cancel').tap();

        // assert
        await expect(page).toHaveURL(MAIN.url.doc(SCRATCH));
        await expect(page.getByTestId('modal')).toHaveCount(0);
        await expect(okToast(page)).toHaveText(text.toast.draftKept);
    });

    test('the discard dialog shares its row between its two buttons in equal parts', async ({page}) => {
        // arrange
        writeFixture(SCRATCH, '# Заметка\n');
        await refuseDrafts(page);
        await page.goto(routes.edit(SCRATCH));
        await setSource(page, '# Заметка\n\nправка\n');

        // act
        await page.getByTestId('editor-cancel').tap();

        // assert
        await expect(page.getByTestId('modal-confirm')).toBeVisible();
        const row = await dialogButtons(page, ['modal-cancel', 'modal-confirm']);
        expect(row.widths[0]).toBe(row.widths[1]);
        expect(row.tops[0]).toBe(row.tops[1]);
        expect(row.heights.every((height) => height >= BUTTON_HEIGHT)).toBe(true);
        await page.getByTestId('modal-cancel').tap();
    });

    test('the conflict dialog stacks its three buttons across the dialog', async ({page}) => {
        // arrange
        writeFixture(SCRATCH, 'original\n');
        await page.goto(routes.edit(SCRATCH));
        await expect.poll(() => sourceText(page)).toBe('original\n');
        writeFixture(SCRATCH, 'written by someone else\n');
        await setSource(page, 'my version\n');

        // act
        await page.getByTestId('editor-save').tap();

        // assert
        await expect(page.getByTestId('editor-conflict-overwrite')).toBeVisible();
        const row = await dialogButtons(page, ['editor-conflict-cancel', 'editor-conflict-copy', 'editor-conflict-overwrite']);
        expect({lefts: row.lefts, widths: row.widths, tall: row.heights.map((height) => height >= BUTTON_HEIGHT)})
            .toEqual({lefts: Array(3).fill(row.lefts[0]), widths: Array(3).fill(row.widths[0]), tall: Array(3).fill(true)});
        expect(row.tops[0]).toBeLessThan(row.tops[1]);
        expect(row.tops[1]).toBeLessThan(row.tops[2]);
        await page.getByTestId('editor-conflict-cancel').tap();
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
            routes.recent(),
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

        const offenders = (await tooSmall(page, '[data-testid=code-copy]')).slice(0, 3);
        expect(offenders, 'controls smaller than the touch minimum').toEqual([]);
    });

    test('the copy button sits above the code and never over it', async ({page}) => {
        // arrange
        const longLine = 'curl -fsSL https://example.com/install.sh | sh -s -- --prefix /usr/local --yes';
        writeFixture(SCRATCH, `# Заметка\n\n\`\`\`sh\n${longLine}\n${longLine}\n\`\`\`\n`);

        // act
        await page.goto(routes.doc(SCRATCH));
        const block = page.getByTestId('doc-code');

        // assert
        const copy = await block.getByTestId('code-copy').boundingBox();
        const code = await block.locator('pre').boundingBox();
        expect(copy.y + copy.height).toBeLessThanOrEqual(code.y + 1);
        await shot(page, 'mobile-code-copy');
    });

    test('a heading shows its link mark after the text without a hover, muted and on its baseline', async ({page}) => {
        // arrange
        await page.goto(routes.doc(DOC));
        const doc = page.getByTestId('doc');
        const anchor = doc.locator('h1').first().getByTestId('doc-heading-anchor');

        // act
        const title = await headingAnchorGeometry(doc.locator('h1').first());
        const section = await headingAnchorGeometry(doc.locator('h2').first());
        const colors = await doc.getByTestId('doc-heading-anchor')
            .evaluateAll((elements) => elements.map((el) => getComputedStyle(el).color));

        // assert
        await expect(anchor).toBeVisible();
        await expect(anchor).toHaveCSS('opacity', '1');
        expect(colors).toEqual(Array(colors.length).fill(rgb(lightTheme.palette.textTertiary)));
        for (const geometry of [title, section]) {
            expect(geometry.markLeft).toBeGreaterThan(geometry.lastRight);
            expect(Math.abs(geometry.markBottom - geometry.lastBottom)).toBeLessThanOrEqual(0.5);
            expect(Math.round(Math.min(geometry.tapWidth, geometry.tapHeight))).toBeGreaterThanOrEqual(MIN_TAP);
        }
        expect(title.markFont).toBeGreaterThan(section.markFont);
        await shot(page, 'mobile-heading-anchor');
    });

    test('the preview in the editor fits the screen', async ({page}) => {
        // arrange
        await page.goto(routes.edit(DOC));
        await expect(page.getByTestId('editor-tabs')).toBeVisible();

        // act
        await page.getByTestId('editor-tab-preview').tap();

        // assert
        const doc = page.getByTestId('editor-preview').getByTestId('doc');
        await expect(doc).toBeVisible();
        const box = await doc.boundingBox();
        expect(Math.round(box.x + box.width)).toBeLessThanOrEqual(page.viewportSize().width - 16);
        expect(await doc.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    });

    test('the editor tabs are big enough to tap', async ({page}) => {
        writeFixture(SCRATCH, '# Заметка\n\nтекст\n');
        await page.goto(routes.edit(SCRATCH));
        await expect(page.getByTestId('editor-tabs')).toBeVisible();

        expect(await tooSmall(page, '[data-testid=editor-tabs] label', BUTTON_HEIGHT)).toEqual([]);
        expect(await tooSmall(page, '[data-testid=topbar] button')).toEqual([]);
        await page.locator('[data-testid=editor-source] .cm-line').first().tap();
        await expect(page.getByTestId('editor-keyboard-bar')).toBeVisible();
        expect(await tooSmall(page, '[data-testid=editor-keyboard-bar] button')).toEqual([]);
    });

    test('the top bar controls are big enough to tap', async ({page}) => {
        await page.goto(routes.doc(DOC));

        const offenders = await tooSmall(page, '[data-testid=topbar] button, [data-testid=topbar] a');
        await shot(page, 'mobile-tap-targets');
        expect(offenders, 'elements smaller than the touch minimum').toEqual([]);
    });

    test('the top bar goes back to the folder and holds one row', async ({page}) => {
        // arrange
        await page.goto(routes.doc(docs.deep.path));
        await expect(page.getByTestId('doc')).toBeVisible();

        // act & assert
        const parent = docs.deep.path.split('/').slice(-2, -1)[0];
        await expect(page.getByTestId('topbar-up')).toHaveText(parent);
        await expect(page.getByTestId('note-menu')).toBeVisible();
        await expect(page.getByTestId('topbar-crumbs')).toHaveCount(0);
        const bar = await page.getByTestId('topbar').boundingBox();
        expect(bar.height, 'the top bar wrapped onto a second line').toBeLessThanOrEqual(ROW_HEIGHT);
        await expectNoHorizontalScroll(page);
        await shot(page, 'mobile-path-row');

        await page.getByTestId('topbar-up').tap();
        await expect(page).toHaveURL(MAIN.url.dir(docs.deep.path.split('/').slice(0, -1).join('/')));
    });

    test('the way back and the page text start on one line, and the text keeps the same room on the right', async ({page}) => {
        // act
        await page.goto(routes.doc(DOC));

        // assert
        const width = page.viewportSize().width;
        const back = await page.getByTestId('topbar-up').locator('svg').boundingBox();
        const heading = await page.getByTestId('doc').locator('h1').first().boundingBox();
        const left = Math.round(back.x);
        expect([Math.round(heading.x), Math.round(width - heading.x - heading.width)]).toEqual([left, left]);
    });

    test('a note at the root goes back to the list of the space', async ({page}) => {
        // arrange
        await page.goto(routes.doc('index.md'));
        await expect(page.getByTestId('doc')).toBeVisible();

        // act
        await page.getByTestId('topbar-up').tap();

        // assert
        await expect(page).toHaveURL(atHome());
        await expect(page.getByTestId('topbar-up')).toHaveCount(0);
    });

    test('a folder and a note start their title on one line, which the bar does not repeat', async ({page}) => {
        // arrange
        const screens = [routes.dir(docs.folder.path), routes.doc(DOC)];
        const heading = page.locator('.mantine-AppShell-main h1').first();
        const tops = [];
        const shown = [];

        // act
        for (const url of screens) {
            await page.goto(url);
            await expect(heading).toBeVisible();
            tops.push(Math.round((await heading.boundingBox()).y));
            shown.push(await page.getByTestId('topbar-title').getAttribute('data-shown'));
        }

        // assert
        expect(tops).toEqual([tops[0], tops[0]]);
        expect(shown).toEqual(['false', 'false']);
    });

    test('the root and Profile start their header on one line, Profile as a large title in the bar', async ({page}) => {
        // arrange
        const middleOf = async (testId) => {
            const box = await page.getByTestId(testId).boundingBox();
            return Math.round(box.y + box.height / 2);
        };
        await page.goto(routes.home());
        const root = await middleOf('topbar-home');

        // act
        await page.getByTestId('tab-profile').tap();

        // assert
        await expect(page.getByTestId('topbar-tab-title')).toHaveText('Profile');
        expect(await middleOf('topbar-tab-title')).toBe(root);
        await expect(page.getByTestId('topbar-tab-title')).toHaveCSS('font-size', '34px');
        await expect(page.locator('.mantine-AppShell-main h1')).toHaveCount(0);
        await expect(page.getByTestId('topbar-title')).toHaveAttribute('data-shown', 'false');
    });

    test('the root names the space in the bar, beside the logo, and has no large title', async ({page}) => {
        // act
        await page.goto(routes.home());

        // assert
        await expect(page.getByTestId('dir-row').first()).toBeVisible();
        await expect(page.getByTestId('dir-title')).toHaveCount(0);
        await expect(page.locator('.mantine-AppShell-main h1')).toHaveCount(0);
        await expect(page.getByTestId('topbar-home')).toHaveText(MAIN.space);
        await expect(page.getByTestId('topbar-home').locator('svg')).toBeVisible();
    });

    test('Copy link copies on a plain http address, where the page has no clipboard api', async ({page}) => {
        // arrange
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'clipboard', {value: undefined});
            window.copied = [];
            document.execCommand = (command) => {
                const field = document.activeElement;
                window.copied.push(`${command}:${field.value.slice(field.selectionStart, field.selectionEnd)}`);
                return true;
            };
        });
        await page.goto(routes.home());
        const row = page.locator(`[data-testid=dir-row][data-path="${docs.folder.path}"]`);

        // act
        await row.getByTestId('tree-row-menu').tap();
        await page.getByTestId('tree-row-menu-copy-link').tap();

        // assert
        await expect(page.locator('[data-testid=toast][data-kind="ok"]')).toContainText(text.toast.linkCopied);
        const copied = await page.evaluate(() => window.copied);
        const toast = await page.getByTestId('toast').boundingBox();
        await expect.poll(async () => {
            const pillBox = await page.getByTestId('toast-box').boundingBox();
            const width = page.viewportSize().width;
            return {
                centered: Math.abs(pillBox.x - (width - pillBox.x - pillBox.width)) < 1,
                hugs: pillBox.x > 16,
                height: pillBox.height,
            };
        }).toEqual({centered: true, hugs: true, height: 48});
        await expect(page.getByTestId('toast-box')).toHaveCSS('background-color', rgb(lightTheme.palette.capsule));
        await expect(page.getByTestId('toast-box')).toHaveCSS('border-radius', '24px');
        const bar = await page.getByTestId('tab-bar').boundingBox();
        await expect.poll(async () => {
            const pill = await page.getByTestId('toast-box').boundingBox();
            return Math.round(bar.y - (pill.y + pill.height));
        }).toBe(8);
        expect(toast.y).toBeGreaterThan(page.viewportSize().height / 2);
        await expect(page.getByTestId('toast').locator('.mantine-Notification-closeButton')).toHaveCount(0);
        expect(copied).toEqual([`copy:${new URL(MAIN.url.dir(docs.folder.path)).href}`]);
    });

    test('a dialog stands in the middle of the screen', async ({page}) => {
        // arrange
        const note = 'e2e-mobile/centered.md';
        writeFixture(note, '# Centered\n');
        await refuseDrafts(page);
        await page.goto(routes.edit(note));
        await setSource(page, '# Centered\n\nedit\n');

        // act
        await page.getByTestId('editor-cancel').tap();

        // assert
        const dialog = page.locator('.mantine-Modal-content');
        await expect(dialog).toBeVisible();
        await expect.poll(async () => {
            const box = await dialog.boundingBox();
            return Math.abs(box.y - (page.viewportSize().height - box.y - box.height));
        }).toBeLessThan(2);
        await page.getByTestId('modal-cancel').tap();
        removeFixture(note);
    });

    test('a context menu on the free space of a folder list opens no menu of the app on a phone', async ({page}) => {
        // arrange
        await page.goto(routes.dir(docs.folder.path));
        await expect(page.getByTestId('dir-table')).toBeVisible();

        // act
        await page.getByTestId('dir').dispatchEvent('contextmenu');

        // assert
        await expect(page.getByTestId('dir-context-menu')).toHaveCount(0);
        await expect(page.getByTestId('dir-draft')).toHaveCount(0);
    });

    test.describe('a toast', () => {
        async function copied(page) {
            await page.goto(routes.home());
            await page.locator(`[data-testid=dir-row][data-path="${docs.folder.path}"]`).getByTestId('tree-row-menu').tap();
            await page.getByTestId('tree-row-menu-copy-link').tap();
            await expect(page.getByTestId('toast-box')).toBeVisible();
        }

        async function noteLinkCopied(page) {
            await page.goto(routes.doc(DOC));
            await page.getByTestId('note-menu').tap();
            await page.getByTestId('note-menu-copy-link').tap();
            await expect(page.getByTestId('toast-box')).toBeVisible();
        }

        const pillLook = (page) => page.getByTestId('toast-box').evaluate((el) => {
            const style = getComputedStyle(el);
            return {
                border: style.borderTopColor,
                shadow: style.boxShadow,
                background: style.backgroundColor,
                color: style.color,
                padding: style.padding,
                icon: getComputedStyle(el.querySelector('svg')).color,
                iconSize: el.querySelector('svg').getBoundingClientRect().width,
            };
        });

        test('on a note it stands in the middle over the note bar, as wide as its content', async ({page}) => {
            // act
            await noteLinkCopied(page);

            // assert
            const width = page.viewportSize().width;
            const bar = await page.getByTestId('note-bar').boundingBox();
            await expect.poll(async () => {
                const pill = await page.getByTestId('toast-box').boundingBox();
                return Math.round(bar.y - (pill.y + pill.height));
            }).toBe(8);
            const pill = await page.getByTestId('toast-box').boundingBox();
            const content = await page.getByTestId('toast-box').evaluate((el) => {
                const icon = el.querySelector('svg').getBoundingClientRect();
                const range = document.createRange();
                range.selectNodeContents(el.querySelector('[data-toast-text]'));
                return {left: icon.left, right: range.getBoundingClientRect().right};
            });
            expect({
                centered: Math.abs(pill.x - (width - pill.x - pill.width)) < 1,
                hugs: pill.x > 16,
                left: Math.round(content.left - pill.x),
                right: Math.round(pill.x + pill.width - content.right),
                height: pill.height,
            }).toEqual({centered: true, hugs: true, left: 15, right: 19, height: 48});
        });

        test('has one look on a list and on a note: a white pill, a green check and its own shadow', async ({page}) => {
            // arrange
            await copied(page);
            const onList = await pillLook(page);

            // act
            await noteLinkCopied(page);

            // assert
            expect(await pillLook(page)).toEqual(onList);
            const shadow = await page.evaluate((value) => {
                const probe = document.createElement('div');
                probe.style.boxShadow = value;
                document.body.append(probe);
                const drawn = getComputedStyle(probe).boxShadow;
                probe.remove();
                return drawn;
            }, lightTheme.shadows.toastPhone);
            expect(onList).toEqual({
                border: rgb(lightTheme.palette.capsuleBorderGrouped),
                shadow,
                background: rgb(lightTheme.palette.capsule),
                color: rgb(lightTheme.palette.text),
                padding: '4px 18px 4px 14px',
                icon: rgb(lightTheme.palette.toastSuccess),
                iconSize: 18,
            });
        });

        test('leaves the bar beside it to take a tap, and goes on its own after one', async ({page}) => {
            // arrange
            await page.goto(routes.doc(DOC));
            await page.getByTestId('note-menu').tap();
            await page.getByTestId('note-menu-copy-link').tap();
            await expect(page.getByTestId('toast-box')).toBeVisible();

            // act
            await page.getByTestId('note-menu').tap();

            // assert
            await expect(page.getByTestId('note-menu-dropdown')).toBeVisible();
            await expect(page.getByTestId('toast')).toHaveCount(0, {timeout: 5000});
        });

        test('with Undo stays past the 2.5 seconds of one without', async ({page}) => {
            // arrange
            const file = 'e2e-mobile/toast-undo.md';
            writeFixture(file, '# Toast undo\n');
            await page.goto(MAIN.url.dir('e2e-mobile'));
            await page.locator(`[data-testid=dir-row][data-path="${file}"]`).getByTestId('tree-row-menu').tap();
            await openedMenu(page, 'tree-row-menu-dropdown');

            // act
            await page.getByTestId('tree-row-menu-delete').tap();

            // assert
            await expect(page.getByTestId('toast-action')).toBeVisible();
            await stays(() => page.getByTestId('toast').count(), 1, 4000);
            await expect(page.getByTestId('toast')).toHaveCount(0, {timeout: 4000});
        });

        test('keeps Undo inside it and on screen for a long name without spaces', async ({page}) => {
            // arrange
            const file = `e2e-mobile/${'unbroken'.repeat(15)}.md`;
            writeFixture(file, '# Unbroken\n');
            await page.goto(MAIN.url.dir('e2e-mobile'));
            await page.locator(`[data-testid=dir-row][data-path="${file}"]`).getByTestId('tree-row-menu').tap();
            await openedMenu(page, 'tree-row-menu-dropdown');

            // act
            await page.getByTestId('tree-row-menu-delete').tap();

            // assert
            await expect(page.getByTestId('toast-action')).toBeVisible();
            await settled(page);
            const box = await page.getByTestId('toast-box').boundingBox();
            const action = await page.getByTestId('toast-action').boundingBox();
            const width = page.viewportSize().width;
            expect([box.x >= 0, box.x + box.width <= width, action.x >= box.x, action.x + action.width <= box.x + box.width])
                .toEqual([true, true, true, true]);
            const icon = await page.getByTestId('toast-box').locator('svg').first().boundingBox();
            const word = await page.getByTestId('toast-action').evaluate((el) => {
                const range = document.createRange();
                range.selectNodeContents(el);
                return range.getBoundingClientRect().right;
            });
            expect(Math.round(box.x + box.width - word)).toBe(Math.round(icon.x - box.x));
            await expect(page.getByTestId('toast-action')).toHaveCSS('color', rgb(lightTheme.palette.accent));
            await expect(page.getByTestId('toast-box')).toContainText(`Deleted “${file.split('/').pop()}”`);
            expect([action.height, Math.round(action.y + action.height / 2), box.width]).toEqual([
                40, Math.round(box.y + box.height / 2), width - 32,
            ]);
            const lines = await page.getByTestId('toast-box').locator('[data-toast-text]').evaluate((el) => ({
                lines: Math.round(el.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(el).lineHeight)),
                cut: el.scrollHeight > el.clientHeight,
            }));
            expect(lines).toEqual({lines: 2, cut: true});
        });

        test('goes at a tap on it', async ({page}) => {
            // arrange
            await copied(page);

            // act
            await page.getByTestId('toast-box').tap();

            // assert
            await expect(page.getByTestId('toast')).toHaveCount(0, {timeout: 1500});
        });

        test('stands over the keyboard while one is up, in the same event', async ({page}) => {
            // arrange
            await page.addInitScript(() => {
                const view = Object.assign(new EventTarget(), {offsetTop: 0, height: window.innerHeight});
                Object.defineProperty(window, 'visualViewport', {value: view, configurable: true});
            });
            await copied(page);
            const keyboard = 300;
            const pan = 40;

            // act
            const placed = await page.evaluate(({keyboard, pan}) => {
                window.visualViewport.height = window.innerHeight - keyboard;
                window.visualViewport.offsetTop = pan;
                window.visualViewport.dispatchEvent(new Event('resize'));
                const box = document.querySelector('[data-testid="toast-box"]').getBoundingClientRect();
                return {bottom: box.bottom, visible: pan + window.innerHeight - keyboard};
            }, {keyboard, pan});

            // assert
            expect(placed.bottom).toBeLessThan(placed.visible);
            expect(placed.bottom).toBeGreaterThan(placed.visible - 150);
        });

        test('goes at a flick down', async ({page}) => {
            // arrange
            await copied(page);
            const box = await page.getByTestId('toast-box').boundingBox();
            const x = box.x + box.width / 2;
            const cdp = await page.context().newCDPSession(page);

            // act
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x, y: box.y + 10}]});
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x, y: box.y + 25}]});
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x, y: box.y + 50}]});
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});

            // assert
            await expect(page.getByTestId('toast')).toHaveCount(0, {timeout: 1500});
        });
    });

    test('the profile page switches the theme on a pill track of Auto, Light and Dark', async ({page}) => {
        // arrange
        await openProfile(page);
        const theme = page.getByTestId('profile-theme');

        // act
        await theme.getByText('Dark', {exact: true}).tap();

        // assert
        await expect(theme.locator('label')).toHaveText(['Auto', 'Light', 'Dark']);
        await expect(theme).toHaveAttribute('data-theme', 'dark');
        await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'dark');
        const box = await theme.boundingBox();
        expect(Math.round(box.height)).toBe(CHOICE_HEIGHT);
        await expect(theme).toHaveCSS('border-radius', `${CHOICE_HEIGHT / 2}px`);
        await shot(page, 'mobile-profile-dark');
    });

    test('the history is a sheet, the picked version holds its change, and Restore is big enough to tap', async ({page}) => {
        // arrange
        const wide = 'x'.repeat(200);
        await signIn(page, {baseURL: HISTORY.baseURL, from: routes.edit(HISTORY_DOC)});
        for (const body of [`# Одна\n\n${wide}\n`, `# Две\n\n${wide}${wide}\n`]) {
            await setSource(page, body);
            await save(page);
        }

        // act
        await page.goto(HISTORY.url.history(HISTORY_DOC));
        await expect(page.getByTestId('version').first()).toBeVisible();

        // assert
        await expectNoHorizontalScroll(page);
        await expect(page.getByTestId('history-dialog')).toBeVisible();
        const picked = page.getByTestId('version').nth(1);
        await picked.tap();
        await expect(page.locator('[data-testid=version][data-selected="true"]')).toHaveAttribute(
            'data-rev', await picked.getAttribute('data-rev'),
        );
        await expect(page.getByTestId('history-version')).toHaveCount(1);
        const head = await picked.boundingBox();
        const version = await page.getByTestId('history-version').boundingBox();
        expect(version.y, 'the change sits under its version').toBeGreaterThanOrEqual(head.y + head.height - 1);
        const viewport = page.viewportSize().width;
        const box = await page.getByTestId('version-restore').boundingBox();
        expect(box.y, 'Restore sits under the change').toBeGreaterThanOrEqual(version.y + version.height - 1);
        expect(box.x + box.width, 'Restore reaches past the right edge').toBeLessThanOrEqual(viewport);
        expect(await tooSmall(page, '[data-testid=version-restore]', BUTTON_HEIGHT)).toEqual([]);
        await expect(page.getByTestId('rendered-diff')).toBeVisible();
        await expectNoHorizontalScroll(page);
        await page.getByTestId('history-diff-view').getByText('Source').tap();
        const diff = page.getByTestId('history-diff');
        await expect(diff).toBeVisible();
        expect(await diff.evaluate((el) => {
            const patch = el.querySelector('pre');
            return {
                box: getComputedStyle(el).overflowX,
                patch: [getComputedStyle(patch).overflowX, getComputedStyle(patch).overflowY],
                across: patch.scrollWidth > patch.clientWidth,
            };
        }), 'the box scrolls down and the patch alone sideways').toEqual({box: 'hidden', patch: ['auto', 'hidden'], across: true});
        await expectNoHorizontalScroll(page);
        await shot(page, 'mobile-history');
    });

    test('Restore in the history sheet asks first and then brings the picked version back', async ({page}) => {
        // arrange
        const note = `${HISTORY_FOLDER}/restored-${Date.now()}.md`;
        const first = '# Первая\n';
        await signIn(page, {baseURL: HISTORY.baseURL, from: routes.edit(note)});
        for (const body of [first, '# Вторая\n']) {
            await setSource(page, body);
            await save(page);
        }
        await page.goto(HISTORY.url.history(note));
        await expect(page.getByTestId('version')).toHaveCount(2);
        await expect(page.getByTestId('history-restore-reason')).toHaveText('Same as the current note');
        await expect(page.getByTestId('version-restore')).toBeDisabled();

        // act
        await page.getByTestId('version').nth(1).tap();
        await page.getByTestId('version-restore').tap();
        await expect(page.locator('.mantine-Modal-title')).toHaveText(text.modal.restore);
        await page.getByTestId('modal-confirm').tap();

        // assert
        await expect(page.locator('[data-testid=toast][data-kind="ok"]')).toContainText(text.toast.restored);
        await expect.poll(() => readFixture(note, HISTORY)).toBe(first);
        await expect(page.getByTestId('version')).toHaveCount(3);
    });

    test('the history sheet of a read-only space lists the versions and offers no Restore', async ({page}) => {
        // act
        await signIn(page, {baseURL: READONLY.baseURL, from: routes.history(DOC)});

        // assert
        await expect(page.getByTestId('history-dialog')).toBeVisible();
        await expect(page.getByTestId('version').first()).toBeVisible();
        await expect(page.getByTestId('version-restore')).toHaveCount(0);
    });

    test('the search field has the focus as soon as the search opens, and keeps it', async ({page}) => {
        // arrange
        await page.goto(routes.home());
        await expect(page.getByTestId('dir-row').first()).toBeVisible();

        // act
        await page.getByTestId('tab-search').tap();

        // assert
        await expect(page.getByTestId('search-input')).toBeFocused();
        await stays(() => page.getByTestId('search-input').evaluate((el) => el === document.activeElement), true, SETTLE_WAIT_MS);
    });

    test('the search opens from its tab on the list and navigates', async ({page}) => {
        // arrange
        await page.goto(routes.home());
        await page.waitForLoadState('networkidle');

        // act & assert
        await page.getByTestId('tab-search').tap();
        await expect(page.getByTestId('search-input')).toBeVisible();
        await page.getByTestId('search-input').fill(docs.search.palette.query);
        await expect(page.getByTestId('search-result').first()).toBeVisible();
        await shot(page, 'mobile-search');

        await page.getByTestId('search-result').first().tap();
        await expect(page).toHaveURL(new RegExp(`${routes.doc(docs.search.palette.path)}\\?q=`));
    });

    test('the outline sheet opens from the bar of the note, its current heading tinted with the accent', async ({page}) => {
        // arrange
        await page.goto(routes.doc(DOC));

        // act
        await page.getByTestId('note-bar-outline').tap();

        // assert
        await expect(page.getByTestId('toc-entry').first()).toBeVisible();
        const current = page.locator('[data-testid=toc-entry][data-active="true"]');
        await expect(current).toHaveCount(1);
        await expect(current).toHaveCSS('color', rgb(lightTheme.palette.accent));
        await expect(current).toHaveCSS('background-color', rgb(lightTheme.palette.accentTint));
        await shot(page, 'mobile-toc-sheet');

        await page.getByTestId('toc-entry').first().tap();
        await expect(page.getByTestId('toc-entry')).toHaveCount(0);
    });

    test('the outline sheet scrolls only up and down, its rows as wide as the sheet', async ({page}) => {
        // arrange
        await page.goto(routes.doc(DOC));

        // act
        await page.getByTestId('note-bar-outline').tap();

        // assert
        await expect(page.getByTestId('toc-entry').first()).toBeVisible();
        const sheet = await page.getByTestId('toc-drawer').boundingBox();
        const row = await page.getByTestId('toc-entry').first().boundingBox();
        expect([row.x, row.width]).toEqual([sheet.x, sheet.width]);
        const sideways = await page.getByTestId('toc-drawer').evaluate((root) => [root, ...root.querySelectorAll('*')]
            .filter((el) => el.scrollWidth > el.clientWidth && getComputedStyle(el).overflowX !== 'visible')
            .map((el) => el.className));
        expect(sideways).toEqual([]);
    });

    test('the outline sheet keeps the room of a focus ring under its title, and is as tall there as a dialog', async ({page}) => {
        // arrange
        await page.goto(routes.doc(DOC));

        // act
        await page.getByTestId('note-bar-outline').tap();
        await expect(page.getByTestId('toc-entry').first()).toBeVisible();

        // assert
        expect(await titleRoom(page.getByTestId('toc'))).toEqual(DIALOG_TITLE);
    });

    test('Find in note opens from the bar of the note as a card at the bottom, and the bar is hidden while it is open', async ({page}) => {
        // arrange
        await page.goto(routes.doc(DOC));
        const view = page.viewportSize();

        // act
        await page.getByTestId('note-bar-find').tap();

        // assert
        await expect(page.getByTestId('doc-find-input')).toBeFocused();
        await expect(page.getByTestId('note-bar')).toHaveCount(0);
        const card = await boxOf(page, 'doc-find');
        expect([card.left, view.width - card.right, view.height - card.bottom]).toEqual([8, 8, 8]);
        expect(await tooSmall(page, '[data-testid=doc-find] button')).toEqual([]);
        await shot(page, 'mobile-find-card');
        await page.getByTestId('doc-find-close').tap();
        await expect(page.getByTestId('doc-find')).toHaveCount(0);
        await expect(page.getByTestId('note-bar')).toBeVisible();
    });

    test('Find in note keeps the place being read, scrolls the note instead of the page, and gives the place back when closed', async ({page}) => {
        // arrange
        await page.goto(routes.doc(docs.long.path));
        await expect(page.getByTestId('doc')).toBeVisible();
        await page.evaluate(() => window.scrollTo({top: 1200, behavior: 'instant'}));
        const read = await readingPlace(page);

        // act
        await page.getByTestId('note-bar-find').tap();
        await expect(page.getByTestId('doc-find')).toBeVisible();
        const opened = {place: await readingPlace(page), pageY: await page.evaluate(() => window.scrollY)};
        await page.locator('[data-screen]').evaluate((screen) => screen.scrollBy({top: 300, behavior: 'instant'}));
        const moved = await readingPlace(page);
        await page.getByTestId('doc-find-close').tap();
        await expect(page.getByTestId('doc-find')).toHaveCount(0);

        // assert
        expect(opened).toEqual({place: read, pageY: 0});
        expect(await readingPlace(page)).toEqual(moved);
        expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(1200);
    });

    test('a match found on a phone stands in the middle of the note, above the find card', async ({page}) => {
        // arrange
        await page.goto(routes.doc(docs.long.path));
        await page.getByTestId('note-bar-find').tap();

        // act
        await page.getByTestId('doc-find-input').fill('awk');

        // assert
        const active = page.locator('[data-testid=find-hit][data-active="true"]');
        await expect(active).toBeVisible();
        const place = await active.evaluate((hit) => {
            const note = hit.closest('[data-screen]').getBoundingClientRect();
            const box = hit.getBoundingClientRect();
            const card = document.querySelector('[data-testid=doc-find]').getBoundingClientRect();
            return {
                centered: Math.abs(box.top + box.height / 2 - (note.top + note.height / 2)) <= 1,
                aboveCard: box.bottom <= card.top,
                pageY: window.scrollY,
            };
        });
        expect(place).toEqual({centered: true, aboveCard: true, pageY: 0});
    });

    test('with the keyboard up, the note scrolls under a find card that stays over the keyboard', async ({page}) => {
        // arrange
        await fakeVisibleArea(page);
        await page.goto(routes.doc(docs.long.path));
        await page.getByTestId('note-bar-find').tap();
        await expect(page.getByTestId('doc-find')).toBeVisible();
        const {height} = page.viewportSize();
        await moveVisibleArea(page, 120, height - 300);
        const card = await boxOf(page, 'doc-find');

        // act
        await page.locator('[data-screen]').evaluate((screen) => screen.scrollBy({top: 400, behavior: 'instant'}));

        // assert
        const after = {card: await boxOf(page, 'doc-find'), pageY: await page.evaluate(() => window.scrollY)};
        expect({...after, bottom: card.bottom}).toEqual({card, pageY: 0, bottom: 120 + height - 300 - 8});
    });

    test('the steps and the toggles of the find card leave the field focused, so the keyboard stays up', async ({page}) => {
        // arrange
        await page.goto(routes.doc(docs.long.path));
        await page.getByTestId('note-bar-find').tap();
        await page.getByTestId('doc-find-input').fill('awk');
        const counter = page.getByTestId('doc-find-count');
        await expect(counter).toHaveAttribute('data-position', '1');

        // act
        await page.getByTestId('doc-find-next').tap();
        await expect(counter).toHaveAttribute('data-position', '2');
        const stepped = await page.evaluate(() => document.activeElement?.dataset.testid);
        await page.getByTestId('doc-find-case').tap();
        await expect(page.getByTestId('doc-find-case')).toHaveAttribute('data-on', 'true');
        const toggled = await page.evaluate(() => document.activeElement?.dataset.testid);

        // assert
        expect({stepped, toggled}).toEqual({stepped: 'doc-find-input', toggled: 'doc-find-input'});
    });

    test('closing Find with the keyboard up gives back the line being read, not one moved by the keyboard', async ({page}) => {
        // arrange
        await fakeVisibleArea(page);
        await page.goto(routes.doc(docs.long.path));
        await page.getByTestId('note-bar-find').tap();
        await expect(page.getByTestId('doc-find')).toBeVisible();
        const {height} = page.viewportSize();
        await moveVisibleArea(page, 120, height - 300);
        await page.locator('[data-screen]').evaluate((screen) => screen.scrollBy({top: 1200, behavior: 'instant'}));
        const read = await readingPlace(page);

        // act
        await page.getByTestId('doc-find-close').tap();
        await expect(page.getByTestId('doc-find')).toHaveCount(0);

        // assert
        expect(await readingPlace(page)).toEqual(read);
    });

    test('a link followed while Find is open gives the page the line being read before it leaves, and opens the next page at its top', async ({page}) => {
        // arrange
        await page.goto(routes.doc(docs.linked.path));
        await page.getByTestId('note-bar-find').tap();
        await expect(page.getByTestId('doc-find')).toBeVisible();
        const link = page.locator(`[data-testid=doc] a[href$="/${docs.linked.missing}"]`);
        await link.evaluate((anchor) => anchor.scrollIntoView({block: 'center', behavior: 'instant'}));
        const read = await readingPlace(page);
        await page.evaluate(() => {
            window.addEventListener('click', () => {
                const top = document.querySelector('header').getBoundingClientRect().bottom;
                const block = [...document.querySelector('[data-testid=doc]').children].find((child) => child.getBoundingClientRect().bottom > top);
                window.leftAt = {
                    place: {text: block.textContent.trim().slice(0, 40), offset: Math.round(block.getBoundingClientRect().top - top)},
                    pageScrolled: window.scrollY > 0,
                };
            }, {once: true});
        });

        // act
        await link.tap();
        await expect(page.getByTestId('doc-missing')).toBeVisible();

        // assert
        expect({left: await page.evaluate(() => window.leftAt), opened: await page.evaluate(() => window.scrollY)})
            .toEqual({left: {place: read, pageScrolled: true}, opened: 0});
    });

    test('a match found before the keyboard comes up stays in view above the card', async ({page}) => {
        // arrange
        await fakeVisibleArea(page);
        await page.goto(`${routes.doc(docs.long.path)}?q=awk`);
        const active = page.locator('[data-testid=find-hit][data-active="true"]');
        await expect(active).toBeVisible();
        const {height} = page.viewportSize();

        // act
        await moveVisibleArea(page, 0, height - 300);

        // assert
        await expect.poll(() => active.evaluate((hit) => {
            const box = hit.getBoundingClientRect();
            const note = hit.closest('[data-screen]').getBoundingClientRect();
            const card = document.querySelector('[data-testid=doc-find]').getBoundingClientRect();
            return box.top >= note.top && box.bottom <= card.top;
        })).toBe(true);
    });

    test('a note printed while Find is open on a phone prints whole', async ({page}) => {
        // arrange
        await page.goto(routes.doc(docs.long.path));
        await page.getByTestId('note-bar-find').tap();
        await expect(page.getByTestId('doc-find')).toBeVisible();

        // act
        await page.emulateMedia({media: 'print'});

        // assert
        const printed = await page.locator('[data-screen]').evaluate((screen) => ({
            note: getComputedStyle(screen).overflowY,
            root: getComputedStyle(document.documentElement).overflowY,
            whole: screen.scrollHeight === screen.clientHeight,
        }));
        expect(printed).toEqual({note: 'visible', root: 'visible', whole: true});
    });

    test('the find card stays right over a phone keyboard while the visible area shrinks and pans, in the same event', async ({page}) => {
        // arrange
        await page.addInitScript(() => {
            const view = Object.assign(new EventTarget(), {offsetTop: 0, height: window.innerHeight});
            Object.defineProperty(window, 'visualViewport', {value: view, configurable: true});
        });
        await page.goto(routes.doc(DOC));
        await page.getByTestId('note-bar-find').tap();
        await expect(page.getByTestId('doc-find')).toBeVisible();
        const keyboard = 300;
        const pan = 120;

        // act
        const placed = await page.evaluate(({keyboard, pan}) => {
            window.visualViewport.height = window.innerHeight - keyboard;
            window.visualViewport.offsetTop = pan;
            window.visualViewport.dispatchEvent(new Event('resize'));
            const bottom = document.querySelector('[data-testid="doc-find"]').getBoundingClientRect().bottom;
            return {bottom: Math.round(bottom), visible: pan + window.innerHeight - keyboard};
        }, {keyboard, pan});

        // assert
        expect(placed.bottom).toBe(placed.visible - 8);
    });

    test.describe('with a home indicator', () => {
        const indicator = 34;
        const keyboard = 300;

        test.beforeEach(async ({page}) => {
            const cdp = await page.context().newCDPSession(page);
            await cdp.send('Emulation.setSafeAreaInsetsOverride', {insets: {bottom: indicator}});
            await fakeVisibleArea(page);
        });

        for (const [shrinks, way] of [[false, 'the window keeps its height'], [true, 'the window shrinks and the visible area is panned to the bottom']]) {
        for (const [name, open, card] of [
            ['the search card', async (page) => {
                await page.goto(routes.home());
                await page.getByTestId('tab-search').tap();
            }, 'search-card'],
            ['the find card', async (page) => {
                await page.goto(routes.doc(DOC));
                await page.getByTestId('note-bar-find').tap();
            }, 'doc-find'],
        ]) {
            test(`${name} stands 8px over the keyboard, with no room for the home indicator under it, when ${way}`, async ({page}) => {
                // arrange
                if (shrinks) {
                    await page.addInitScript(() => {
                        Object.defineProperty(window, 'innerHeight', {
                            get: () => window.visualViewport.height,
                            configurable: true,
                        });
                    });
                }
                await open(page);
                await expect(page.getByTestId(card)).toBeVisible();
                await settled(page);
                const {height} = page.viewportSize();
                await moveVisibleArea(page, 0, height);
                const restingGap = height - (await boxOf(page, card)).bottom;

                // act
                const pan = shrinks ? keyboard : 0;
                await moveVisibleArea(page, pan, height - keyboard);
                const overKeyboard = pan + height - keyboard - (await boxOf(page, card)).bottom;
                await moveVisibleArea(page, 0, height);

                // assert
                await expect.poll(async () => height - (await boxOf(page, card)).bottom).toBe(restingGap);
                expect({overKeyboard, restingGap: restingGap >= indicator}).toEqual({overKeyboard: 8, restingGap: true});
            });
        }
        }
    });

    test('the menu of a file is a sheet with Download, and the top bar of the file keeps no action', async ({page}) => {
        // arrange
        const file = 'e2e-mobile/file-sheet/plain.txt';
        writeFixture(file, 'just text\n');
        await page.goto(routes.doc(file));
        await expect(page.getByTestId('file')).toBeVisible();

        // act
        await page.getByTestId('file-menu').tap();

        // assert
        await openedMenu(page, 'file-menu-dropdown');
        expect(await page.getByTestId('file-menu-dropdown').locator('[data-testid^=file-]')
            .evaluateAll((items) => items.map((el) => el.dataset.testid))).toEqual([
            'file-download', 'file-menu-copy-link', 'file-menu-rename', 'file-menu-move', 'file-menu-delete',
        ]);
        await expect(page.getByTestId('file-download')).toHaveAttribute('download', nameOf(file));
        await expect(page.getByTestId('topbar-actions').locator('a, button')).toHaveCount(0);
        await shot(page, 'mobile-file-sheet');
        removeFixture('e2e-mobile/file-sheet');
    });

    test('a sheet that closed leaves the page live behind it', async ({page}) => {
        await page.goto(routes.doc(docs.illustrated.doc));
        await page.getByTestId('doc-image').first().tap();
        await expect(page.getByTestId('doc-lightbox-image')).toBeVisible();

        await page.keyboard.press('Escape');
        await expect(page.getByTestId('doc-lightbox-image')).toHaveCount(0);

        const stuck = await page.evaluate(() => Array.from(
            document.querySelectorAll('[inert]')).map((el) => el.className));
        expect(stuck, 'the sheet left the page inert behind it').toEqual([]);

        await page.getByTestId('doc-image').first().tap();
        await expect(page.getByTestId('doc-lightbox-image')).toBeVisible();
    });

    test.describe('a sheet dragged down by its head', () => {
        async function openNoteSheet(page) {
            await page.goto(routes.doc(DOC));
            await page.getByTestId('note-menu').tap();
            await openedMenu(page, 'note-menu-dropdown');
            return page.getByTestId('note-menu-dropdown').boundingBox();
        }

        test('slowly past a quarter of its height closes it', async ({page}) => {
            // arrange
            const box = await openNoteSheet(page);
            const head = {x: box.x + box.width / 2, y: box.y + 24};

            // act
            await touchDrag(page, head, {x: head.x, y: head.y + box.height * 0.4}, {steps: 20, pauseMs: 40});

            // assert
            await expect(page.getByTestId('note-menu-dropdown')).toHaveCount(0);
        });

        test('a little and let go slowly comes back and stays open', async ({page}) => {
            // arrange
            const sheet = page.getByTestId('note-menu-dropdown');
            const box = await openNoteSheet(page);
            const head = {x: box.x + box.width / 2, y: box.y + 24};

            // act
            await touchDrag(page, head, {x: head.x, y: head.y + 40}, {steps: 4, pauseMs: 40});

            // assert
            await expect.poll(() => sheet.evaluate((el) => getComputedStyle(el).translate)).toBe('none');
            await stays(() => sheet.isVisible(), true, SETTLE_WAIT_MS);
            expect(await sheet.boundingBox()).toEqual(box);
        });

        test('by a fast flick closes it', async ({page}) => {
            // arrange
            const box = await openNoteSheet(page);
            const head = {x: box.x + box.width / 2, y: box.y + 24};

            // act
            await touchDrag(page, head, {x: head.x, y: head.y + box.height * 0.2}, {steps: 3});

            // assert
            await expect(page.getByTestId('note-menu-dropdown')).toHaveCount(0);
        });

        test('fast, then held still and let go, comes back and stays open', async ({page}) => {
            // arrange
            const sheet = page.getByTestId('note-menu-dropdown');
            const box = await openNoteSheet(page);
            const head = {x: box.x + box.width / 2, y: box.y + 24};
            const cdp = await page.context().newCDPSession(page);

            // act
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [head]});
            for (const step of [20, 40, 60]) {
                await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: head.x, y: head.y + step}]});
            }
            await page.waitForTimeout(MOVE_WAIT_MS);
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});

            // assert
            await expect.poll(() => sheet.evaluate((el) => getComputedStyle(el).translate)).toBe('none');
            await stays(() => sheet.isVisible(), true, SETTLE_WAIT_MS);
        });

        test('closes the outline too', async ({page}) => {
            // arrange
            await page.goto(routes.doc(DOC));
            await page.getByTestId('note-bar-outline').tap();
            await expect(page.getByTestId('toc-entry').first()).toBeVisible();
            const box = await page.getByTestId('toc-drawer').boundingBox();
            const head = {x: box.x + box.width / 2, y: box.y + 24};

            // act
            await touchDrag(page, head, {x: head.x, y: head.y + box.height * 0.4}, {steps: 20, pauseMs: 40});

            // assert
            await expect(page.getByTestId('toc-entry')).toHaveCount(0);
        });

        test('a drag down on a long outline scrolled to its end scrolls it back and leaves it open', async ({page}) => {
            // arrange
            const doc = 'e2e-mobile/long-outline/note.md';
            const sections = Array.from({length: 40}, (_, index) => `## Part ${index + 1}\n\ntext\n`).join('\n');
            writeFixture(doc, `# Long outline\n\n${sections}`);
            await page.goto(routes.doc(doc));
            await page.getByTestId('note-bar-outline').tap();
            await expect(page.getByTestId('toc-entry').first()).toBeVisible();
            const list = page.getByTestId('toc-drawer').locator('.mantine-Drawer-body');
            const end = await list.evaluate((el) => {
                el.scrollTop = el.scrollHeight;
                return el.scrollTop;
            });
            expect(end).toBeGreaterThan(0);
            const box = await list.boundingBox();
            const middle = {x: box.x + box.width / 2, y: box.y + box.height / 3};

            // act
            await touchDrag(page, middle, {x: middle.x, y: middle.y + box.height / 2}, {steps: 20, pauseMs: 40});

            // assert
            await stays(() => page.getByTestId('toc-entry').first().isVisible(), true, SETTLE_WAIT_MS);
            await expect(page.getByTestId('toc-drawer')).toHaveCSS('translate', 'none');
            await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeLessThan(end);
        });

        test('a little leaves the outline open', async ({page}) => {
            // arrange
            await page.goto(routes.doc(DOC));
            await page.getByTestId('note-bar-outline').tap();
            await expect(page.getByTestId('toc-entry').first()).toBeVisible();
            const box = await page.getByTestId('toc-drawer').boundingBox();
            const head = {x: box.x + box.width / 2, y: box.y + 24};

            // act
            await touchDrag(page, head, {x: head.x, y: head.y + 40}, {steps: 4, pauseMs: 40});

            // assert
            await stays(() => page.getByTestId('toc-entry').first().isVisible(), true, SETTLE_WAIT_MS);
        });
    });

    test('the image viewer stays on a tap on the picture and closes on a tap beside it', async ({page}) => {
        // arrange
        await page.goto(routes.doc(docs.illustrated.doc));
        const image = page.getByTestId('doc-image').first();
        await expect(image).toBeVisible();
        await image.tap();
        const picture = page.getByTestId('doc-lightbox-image');
        await expect(picture).toBeVisible();
        await shot(page, 'mobile-lightbox');

        // act
        await picture.tap();

        // assert
        await expect(picture).toBeVisible();
        await expect(picture).toHaveAttribute('data-zoomed', 'false');
        await page.touchscreen.tap(8, page.viewportSize().height - 8);
        await expect(picture).toHaveCount(0);
    });

    test('a picture of the space keeps its room on the page before it loads', async ({page}) => {
        // arrange
        await page.route('**/raw/**', () => undefined);

        // act
        await page.goto(routes.doc(docs.illustrated.doc));

        // assert
        const image = page.getByTestId('doc-image').first();
        await expect(image).toHaveAttribute('width', /^\d+$/);
        const box = await image.evaluate((el) => {
            const rect = el.getBoundingClientRect();
            return {ratio: Number(el.getAttribute('width')) / Number(el.getAttribute('height')), shown: rect.width / rect.height};
        });
        expect(Math.abs(box.ratio - box.shown)).toBeLessThan(0.02);
    });

    test('the fields that find something start in lower case with no autocorrect', async ({page}) => {
        // arrange
        const traits = (testId) => page.getByTestId(testId)
            .evaluate((el) => [el.getAttribute('autocapitalize'), el.getAttribute('autocorrect'), el.spellcheck, el.enterKeyHint]);
        const found = {};
        await page.goto(routes.home());

        // act
        await page.getByTestId('tab-search').tap();
        await expect(page.getByTestId('search-input')).toBeVisible();
        found.search = await traits('search-input');
        await page.goto(`${routes.doc(DOC)}?q=${docs.search.word}`);
        await expect(page.getByTestId('doc-find-input')).toBeVisible();
        found.find = await traits('doc-find-input');
        await page.goto(MAIN.url.dir(docs.folder.path));
        await page.locator(`[data-testid=dir-row][data-path="${docs.folder.entry}"]`).getByTestId('tree-row-menu').tap();
        await openedMenu(page, 'tree-row-menu-dropdown');
        await page.getByTestId('tree-row-menu-move').tap();
        await expect(page.getByTestId('move-input')).toBeVisible();
        found.move = await traits('move-input');
        await page.setViewportSize({width: 1280, height: 800});
        await page.goto(routes.home());
        await expect(page.getByTestId('sidebar-filter')).toBeVisible();
        found.filter = await traits('sidebar-filter');

        // assert
        const lower = ['off', 'off', false];
        expect(found).toEqual({
            search: [...lower, 'search'], find: [...lower, 'search'], move: [...lower, 'go'], filter: [...lower, 'search'],
        });
    });

    test('a picture pulled down far enough closes the viewer', async ({page}) => {
        // arrange
        await page.goto(routes.doc(docs.illustrated.doc));
        await page.getByTestId('doc-image').first().tap();
        const picture = page.getByTestId('doc-lightbox-image');
        await expect(picture).toBeVisible();
        const box = await picture.boundingBox();
        const centre = {x: box.x + box.width / 2, y: box.y + box.height / 2};

        // act
        await touchDrag(page, centre, {x: centre.x, y: centre.y + 220});

        // assert
        await expect(page.getByTestId('doc-lightbox')).toHaveCount(0);
        await expect(page.getByTestId('doc-image').first()).toBeVisible();
    });

    test('a picture pulled a little and let go slowly comes back and the viewer stays', async ({page}) => {
        // arrange
        await page.goto(routes.doc(docs.illustrated.doc));
        await page.getByTestId('doc-image').first().tap();
        const picture = page.getByTestId('doc-lightbox-image');
        await expect(picture).toBeVisible();
        const box = await picture.boundingBox();
        const centre = {x: box.x + box.width / 2, y: box.y + box.height / 2};

        // act
        await touchDrag(page, centre, {x: centre.x, y: centre.y + 50}, {pauseMs: 30});

        // assert
        await expect(picture).toBeVisible();
        await expect.poll(() => picture.evaluate((el) => el.style.transform)).toBe('');
        await expect(page.getByTestId('doc-lightbox')).not.toHaveAttribute('data-pull');
    });

    test.describe('a picture pulled in the viewer', () => {
        async function openPicture(page) {
            await page.goto(routes.doc(docs.illustrated.doc));
            await page.getByTestId('doc-image').first().tap();
            const picture = page.getByTestId('doc-lightbox-image');
            await expect(picture).toBeVisible();
            const box = await picture.boundingBox();
            return {picture, centre: {x: box.x + box.width / 2, y: box.y + box.height / 2}};
        }

        async function pullBy(cdp, from, dy, steps) {
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [from]});
            for (let index = 1; index <= steps; index += 1) {
                await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: from.x, y: from.y + (dy * index) / steps}]});
            }
            return {x: from.x, y: from.y + dy};
        }

        test('up far enough closes the viewer', async ({page}) => {
            // arrange
            const {centre} = await openPicture(page);

            // act
            await touchDrag(page, centre, {x: centre.x, y: centre.y - 220});

            // assert
            await expect(page.getByTestId('doc-lightbox')).toHaveCount(0);
        });

        test('by a short fast flick closes the viewer', async ({page}) => {
            // arrange
            const {centre} = await openPicture(page);

            // act
            await touchDrag(page, centre, {x: centre.x, y: centre.y + 60}, {steps: 3});

            // assert
            await expect(page.getByTestId('doc-lightbox')).toHaveCount(0);
        });

        test('fast, then held still and let go, comes back and the viewer stays', async ({page}) => {
            // arrange
            const {picture, centre} = await openPicture(page);
            const cdp = await page.context().newCDPSession(page);
            await pullBy(cdp, centre, 60, 3);
            await page.waitForTimeout(300);

            // act
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});

            // assert
            await expect.poll(() => picture.evaluate((el) => el.style.transform)).toBe('');
            await stays(() => page.getByTestId('doc-lightbox').count(), 1, 400);
        });

        test('and canceled by the browser comes back and the viewer stays', async ({page}) => {
            // arrange
            const {picture, centre} = await openPicture(page);
            const cdp = await page.context().newCDPSession(page);
            await pullBy(cdp, centre, 150, 10);

            // act
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchCancel', touchPoints: []});

            // assert
            await expect.poll(() => picture.evaluate((el) => el.style.transform)).toBe('');
            await stays(() => page.getByTestId('doc-lightbox').count(), 1, 400);
        });

        test('with a second finger landing stops and the viewer stays when both let go', async ({page}) => {
            // arrange
            const {centre} = await openPicture(page);
            const cdp = await page.context().newCDPSession(page);
            const pulled = await pullBy(cdp, centre, 150, 10);

            // act
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [pulled, {x: pulled.x + 60, y: pulled.y}]});
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});

            // assert
            await expect(page.getByTestId('doc-lightbox')).not.toHaveAttribute('data-pull');
            await stays(() => page.getByTestId('doc-lightbox').count(), 1, 400);
        });
    });

    test('a double tap zooms the picture in the viewer and another fits it back', async ({page}) => {
        // arrange
        await page.goto(routes.doc(docs.illustrated.doc));
        await page.getByTestId('doc-image').first().tap();
        const picture = page.getByTestId('doc-lightbox-image');
        await expect(picture).toBeVisible();
        const box = await picture.boundingBox();
        const centre = {x: box.x + box.width / 2, y: box.y + box.height / 2};

        // act
        await page.touchscreen.tap(centre.x, centre.y);
        await page.touchscreen.tap(centre.x, centre.y);

        // assert
        await expect(picture).toHaveAttribute('data-zoomed', 'true');
        await page.touchscreen.tap(centre.x, centre.y);
        await page.touchscreen.tap(centre.x, centre.y);
        await expect(picture).toHaveAttribute('data-zoomed', 'false');
    });

    test('a note with a diagram draws it only after the note has slid in', async ({page}) => {
        // arrange
        const note = 'e2e-mobile/drawn-after.md';
        const warm = 'e2e-mobile/drawn-first.md';
        writeFixture(note, '# Drawn after\n\n```mermaid\ngraph TD\n  A --> B\n```\n');
        writeFixture(warm, '# Drawn first\n\n```mermaid\ngraph TD\n  C --> D\n```\n');
        await page.goto(MAIN.url.doc(warm));
        await expect(page.locator('.md-diagram[data-state="done"]')).toBeVisible();
        await page.getByTestId('topbar-up').tap();
        const row = page.locator(`[data-testid=dir-row][data-path="${note}"]`);
        await expect(row).toBeVisible();
        await settled(page);
        await page.evaluate(() => {
            window.drawnAt = undefined;
            window.settledAt = undefined;
            let seen = false;
            const watch = () => {
                const moving = document.getAnimations()
                    .some((animation) => animation.effect?.target?.matches?.('[data-screen]') && animation.playState === 'running');
                if (moving) {
                    seen = true;
                } else if (seen && window.settledAt === undefined) {
                    window.settledAt = performance.now();
                }
                if (window.drawnAt === undefined && document.querySelector('.md-diagram[data-state="done"]') !== null) {
                    window.drawnAt = performance.now();
                }
                if (window.drawnAt === undefined || window.settledAt === undefined) {
                    requestAnimationFrame(watch);
                }
            };
            requestAnimationFrame(watch);
        });

        // act
        await row.tap();

        // assert
        await expect(page.locator('.md-diagram[data-state="done"]')).toBeVisible();
        await expect.poll(() => page.evaluate(() => window.settledAt !== undefined)).toBe(true);
        const times = await page.evaluate(() => ({drawn: window.drawnAt, settled: window.settledAt}));
        expect(times.drawn).toBeGreaterThanOrEqual(times.settled);
        removeFixture(note);
        removeFixture(warm);
    });

    test('a tap on a diagram opens it in the viewer, where a double tap zooms it', async ({page}) => {
        // arrange
        writeFixture(DIAGRAM_NOTE, '# Diagram\n\n```plantuml\nAlice -> Bob : hello\nBob --> Alice : ok\n```\n');
        await page.goto(routes.doc(DIAGRAM_NOTE));
        const frame = page.getByTestId('diagram-frame');
        await expect(frame).toBeVisible();
        await expect(frame.getByTestId('diagram-open')).toBeHidden();

        // act
        await frame.tap();

        // assert
        const diagram = page.getByTestId('doc-lightbox-diagram');
        await expect(diagram).toBeVisible();
        const box = await diagram.boundingBox();
        const centre = {x: box.x + box.width / 2, y: box.y + box.height / 2};
        await page.touchscreen.tap(centre.x, centre.y);
        await page.touchscreen.tap(centre.x, centre.y);
        await expect(diagram).toHaveAttribute('data-zoomed', 'true');
        await shot(page, 'mobile-diagram-viewer');
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

    test('the rows of every menu are big enough to tap', async ({page}) => {
        // act & assert
        await page.goto(routes.doc(DOC));
        await page.getByTestId('note-menu').tap();
        await openedMenu(page, 'note-menu-dropdown');
        await shot(page, 'mobile-note-menu');
        expect(await tooSmall(page, '[data-testid=note-menu-dropdown] :is(button, a)'), 'the note menu').toEqual([]);
    });

    test('the editor toolbar moves along one axis and shows where it goes on', async ({page}) => {
        // arrange
        writeFixture(SCRATCH, '# Заметка\n\nтекст\n');
        await page.goto(routes.edit(SCRATCH));
        await page.locator('[data-testid=editor-source] .cm-line').first().tap();
        const toolbar = page.getByTestId('editor-toolbar');
        await expect(toolbar).toBeVisible();

        // act & assert
        const motion = await toolbar.evaluate((el) => {
            const style = getComputedStyle(el);
            return {
                vertical: style.overflowY,
                touch: style.touchAction,
                bounce: style.overscrollBehaviorX,
                page: getComputedStyle(document.documentElement).overscrollBehaviorY,
                taller: el.scrollHeight > el.clientHeight,
                wider: el.scrollWidth > el.clientWidth,
            };
        });
        expect(motion).toEqual({
            vertical: 'hidden', touch: 'pan-x', bounce: 'none', page: 'none', taller: false, wider: true,
        });
        await expect(toolbar).toHaveAttribute('data-more-start', 'false');
        await expect(toolbar).toHaveAttribute('data-more-end', 'true');

        await toolbar.evaluate((el) => el.scrollTo({left: el.scrollWidth}));
        await expect(toolbar).toHaveAttribute('data-more-start', 'true');
        await expect(toolbar).toHaveAttribute('data-more-end', 'false');
        await expect(page.getByTestId('editor-toolbar-image')).toBeInViewport({ratio: 1});
    });

    test('an empty folder offers a new note and a new folder, on buttons big enough to tap', async ({page}) => {
        // arrange
        fs.mkdirSync(fixtureFile(EMPTY_FOLDER), {recursive: true});
        await page.goto(routes.dir(EMPTY_FOLDER));
        await expect(page.getByTestId('dir-empty-title')).toHaveText(text.dir.empty);
        await shot(page, 'mobile-empty-folder');

        // act & assert
        expect(await tooSmall(page, '[data-testid=dir-empty] button', BUTTON_HEIGHT)).toEqual([]);
        await expect(page.getByTestId('dir-empty').getByRole('button')).toHaveText([text.create.note, text.create.folder]);

        await page.getByTestId('dir-empty-new-folder').tap();
        await expect(page.getByTestId('dir-draft-input')).toBeInViewport();
        await page.getByTestId('dir-draft-cancel').tap();
        await expect(page.getByTestId('dir-empty')).toBeVisible();

        await page.getByTestId('dir-empty-new-note').tap();
        await expect(page).toHaveURL(MAIN.url.draft(`${EMPTY_FOLDER}/${text.create.untitled}`));
        await expect(page.getByTestId('topbar-draft-name')).toHaveText(text.create.untitled);
    });

    test('the search is usable with the phone turned sideways', async ({page}) => {
        // arrange
        await page.setViewportSize({width: 844, height: 390});
        await page.goto(routes.doc(DOC));

        // act & assert
        await page.getByTestId('sidebar-search').tap();
        await expect(page.getByTestId('search-input')).toBeVisible();
        await page.getByTestId('search-input').fill(docs.search.palette.query);
        await expect(page.getByTestId('search-result').first()).toBeVisible();
        await shot(page, 'mobile-landscape-search');
        await expectNoHorizontalScroll(page);

        await page.getByTestId('search-result').first().tap();
        await expect(page).toHaveURL(new RegExp(`${routes.doc(docs.search.palette.path)}\\?q=`));
    });
});

test.describe('mobile sync state', () => {
    const WIKI = MULTI.spaces.wiki;
    const wiki = MULTI.extra.find((extra) => extra.name === 'wiki');
    const SYNC_DOC = 'e2e-mobile-sync.md';
    const SYNC_FOLDER = 'e2e-mobile-folder';

    test.beforeEach(async ({page}) => {
        restoreOrigin(wiki.origin);
        fs.writeFileSync(`${wiki.dir}/${SYNC_DOC}`, '# Mobile sync\n\nstarting point.\n', 'utf8');
        await signIn(page, {baseURL: MULTI.baseURL, from: WIKI.doc(SYNC_DOC)});
        await inStep(page, WIKI);
    });

    test.afterEach(async ({page}) => {
        await page.unrouteAll({behavior: 'ignoreErrors'});
        restoreOrigin(wiki.origin);
        fs.rmSync(`${wiki.dir}/${SYNC_DOC}`, {force: true});
        fs.rmSync(`${wiki.dir}/${SYNC_FOLDER}`, {recursive: true, force: true});
        await inStep(page, WIKI);
    });

    async function saveStuck(page, contentPath, source) {
        await page.goto(WIKI.edit(contentPath));
        await setSource(page, `${source}\nsaved at ${Date.now()}.\n`);
        await save(page);
    }

    test('the control and the banner reach a phone, which has no tree', async ({page}) => {
        // arrange
        breakOrigin(wiki.origin);
        await saveStuck(page, SYNC_DOC, '# Mobile sync\n\nstuck.\n');

        // act
        await page.goto(WIKI.doc(SYNC_DOC));

        // assert
        await expect(page.getByTestId('sync-control')).toHaveAttribute('data-state', 'warning');
        await expect(page.getByTestId('sync-control')).toHaveText('');
        await expect(page.getByTestId('sync-control')).toHaveAttribute('data-here', 'true');
        await expect(page.getByTestId('space-alert')).toBeVisible();
        await expect(page.getByTestId('sidebar')).toHaveCount(0);
        await shot(page, 'mobile-sync-control');

        await page.getByTestId('sync-control').tap();
        await expect(page.getByTestId('sync-details')).toBeVisible();
        await expect(page.getByTestId('sync-popover-here')).toBeVisible();
        await shot(page, 'mobile-sync-sheet');
    });

    test('the Sync group of the profile page names the files not sent, and a tap on one opens it', async ({page}) => {
        // arrange
        breakOrigin(wiki.origin);
        await saveStuck(page, SYNC_DOC, '# Mobile sync\n\nstuck.\n');
        await page.goto(WIKI.home());

        // act
        await page.getByTestId('tab-profile').tap();

        // assert
        await expect(page).toHaveURL(WIKI.profile());
        await expect(page.getByTestId('profile-sync-status')).toBeVisible();
        await expect(page.getByTestId('profile-sync-path')).toHaveText([SYNC_DOC]);
        await expect(page.getByTestId('tab-profile')).toHaveAttribute('data-current', 'true');
        await expect(page.getByTestId('space-alert')).toHaveCount(0);
        await expect(page.getByTestId('sync-control')).toHaveAttribute('data-state', 'warning');
        await shot(page, 'mobile-sync-profile');

        await page.getByTestId('profile-sync-path').tap();
        await expect(page).toHaveURL(WIKI.doc(SYNC_DOC));
    });

    test('an index note reaches the control on a phone too', async ({page}) => {
        breakOrigin(wiki.origin);
        await saveStuck(page, 'index.md', '# Remote page\n\nthe root index on a phone, stuck.\n');
        await saveStuck(page, `${SYNC_FOLDER}/index.md`, '# Guide\n\nthe folder index, stuck.\n');

        await page.goto(WIKI.doc('index.md'));
        await expect(page.getByTestId('space-alert')).toBeVisible();
        await expect(page.getByTestId('sync-control')).toHaveAttribute('data-here', 'true');

        await page.goto(WIKI.doc(`${SYNC_FOLDER}/index.md`));
        await expect(page.getByTestId('sync-control')).toHaveAttribute('data-here', 'true');
        await shot(page, 'mobile-sync-folder-index');
    });

    test('the top bar still fits with the control up', async ({page}) => {
        breakOrigin(wiki.origin);
        await saveStuck(page, SYNC_DOC, '# Mobile sync\n\nstuck.\n');

        await page.goto(WIKI.doc(SYNC_DOC));
        await expect(page.getByTestId('sync-control')).toBeVisible();
        await expect(page.getByTestId('note-menu')).toBeInViewport({ratio: 1});
        await expectNoHorizontalScroll(page);

        const offenders = await tooSmall(page, '[data-testid=topbar] button, [data-testid=topbar] a');
        await shot(page, 'mobile-sync-tap-targets');
        expect(offenders, 'elements smaller than the touch minimum').toEqual([]);
    });

    test('the editor has no control, and the banner stays over the text with the tabs still on screen', async ({page}) => {
        // arrange
        breakOrigin(wiki.origin);
        await saveStuck(page, SYNC_DOC, '# Mobile sync\n\nstuck.\n');

        // act
        await page.goto(WIKI.edit(SYNC_DOC));

        // assert
        await expect(page.getByTestId('space-alert')).toBeVisible();
        expect(await editorFit(page)).toEqual({sourceOverStrip: true, alertOverSource: true, scroll: 0});
        await expect(page.getByTestId('sync-control')).toHaveCount(0);
        await expect(page.getByTestId('editor-cancel')).toBeInViewport({ratio: 1});
        await expect(page.getByTestId('editor-save')).toBeInViewport({ratio: 1});
        await shot(page, 'mobile-sync-editor');
    });

    test('a rename of the page keeps the control in the bar', async ({page}) => {
        // arrange
        await mockMe(page, {pushing: true});
        await page.goto(WIKI.doc(SYNC_DOC));
        await expect(page.getByTestId('sync-control')).toHaveAttribute('data-state', 'sending');

        // act
        await page.getByTestId('note-menu').tap();
        await openedMenu(page, 'note-menu-dropdown');
        await page.getByTestId('note-menu-rename').tap();

        // assert
        await expect(page.getByTestId('page-rename-input')).toBeFocused();
        await expect(page.getByTestId('sync-control')).toBeInViewport({ratio: 1});
        const field = await page.getByTestId('page-rename-field').boundingBox();
        const sync = await page.getByTestId('sync-control').boundingBox();
        expect(field.x + field.width).toBeLessThanOrEqual(sync.x);
        await expectNoHorizontalScroll(page);
    });

    test('a diverged space shows its sign and names the conflicting files in the popover', async ({page}) => {
        // arrange
        await mockMe(page, {
            unpublished: true,
            diverged: true,
            sync_error: 'merge: the branch has diverged from origin/main',
            unsynced: {paths: [SYNC_DOC], many: false},
        });
        await page.goto(WIKI.doc(SYNC_DOC));
        const sync = page.getByTestId('sync-control');

        // act
        await expect(sync).toHaveAttribute('data-state', 'blocked');
        await sync.tap();

        // assert
        await expect(sync).toHaveText('');
        await expect(sync).toHaveAttribute('aria-label', 'Conflict. This note is not sent yet');
        const details = page.getByTestId('sync-details');
        await expect(details).toContainText('Conflict');
        await expect(details).toContainText('Conflicting files:');
        await expect(details.getByTestId('sync-popover-paths')).toHaveText(SYNC_DOC);
        await expect(details.getByTestId('sync-reset')).toHaveCount(0);
        await shot(page, 'mobile-sync-diverged');
    });

    test('the profile page of a diverged space names the conflicting files and offers the reset', async ({page}) => {
        // arrange
        await mockMe(page, {
            unpublished: true,
            diverged: true,
            sync_error: 'merge: the branch has diverged from origin/main',
            unsynced: {paths: [SYNC_DOC], many: false},
        });
        await page.goto(WIKI.home());

        // act
        await page.getByTestId('tab-profile').tap();

        // assert
        await expect(page).toHaveURL(WIKI.profile());
        const details = page.getByTestId('profile-sync');
        await expect(details.getByTestId('profile-sync-status')).toContainText('Conflict with the remote repository');
        await expect(details).toContainText('Conflicting files');
        await expect(details.getByTestId('profile-sync-facts')).toBeVisible();
        await expect(details.getByTestId('profile-sync-path')).toHaveText([SYNC_DOC]);
        await expect(details.getByTestId('sync-reset')).toBeVisible();
        await expect(page.getByTestId('space-alert')).toHaveCount(0);
        await shot(page, 'mobile-sync-diverged-profile');
    });

    test('a narrow phone with a long title still fits the control', async ({page}) => {
        // arrange
        await page.setViewportSize({width: 320, height: 640});
        fs.writeFileSync(`${wiki.dir}/${SYNC_DOC}`, `# ${'A rather long title for a narrow phone '.repeat(3)}\n\n${'text\n\n'.repeat(80)}`, 'utf8');
        await mockMe(page, {unpublished: true, retrying: true, sync_error: 'push: the remote is down'});

        await page.goto(WIKI.doc(SYNC_DOC));
        await expect(page.getByTestId('doc')).toBeVisible();

        // act
        await page.mouse.wheel(0, 2000);

        // assert
        await expect(page.getByTestId('topbar-title')).toHaveAttribute('data-shown', 'true');
        await expect(page.getByTestId('sync-control')).toHaveAttribute('data-state', 'warning');
        await expect(page.getByTestId('sync-control')).toBeInViewport({ratio: 1});
        await expect(page.getByTestId('note-menu')).toBeInViewport({ratio: 1});
        await expectNoHorizontalScroll(page);
        const offenders = await tooSmall(page, '[data-testid=topbar] button, [data-testid=topbar] a');
        expect(offenders, 'elements smaller than the touch minimum').toEqual([]);
        await shot(page, 'mobile-sync-narrow');
    });

    test('a change on its way does not spin under reduced motion', async ({page}) => {
        // arrange
        await page.emulateMedia({reducedMotion: 'reduce'});
        await mockMe(page, {pushing: true});

        // act
        await page.goto(WIKI.doc(SYNC_DOC));

        // assert
        await expect(page.getByTestId('sync-control')).toHaveAttribute('data-state', 'sending');
        await expect(page.getByTestId('sync-spinner')).toHaveCount(0);
        await expect(page.getByTestId('sync-control').getByTestId('sync-still')).toBeVisible();
    });
});

test.describe('mobile offline access', () => {
    const FOLDER = 'e2e-mobile-offline';
    const NOTE = `${FOLDER}/carried.md`;

    test.beforeEach(async ({page}) => {
        writeFixture(NOTE, '# Carried note\n\nread on the metro.\n');
        await signIn(page);
    });

    test.afterEach(() => {
        removeFixture(FOLDER);
    });

    test('the switch is on the profile page and the mark sits in the bar on top', async ({page, context}) => {
        // arrange
        await openProfile(page);
        await page.getByTestId('profile-offline').tap();
        await expect(page.getByTestId('profile-offline')).toBeChecked();
        await expect(page.getByTestId('profile-offline-status')).toContainText(text.offline.updated, {timeout: 60_000});
        await expect(page.getByTestId('profile-offline-status')).toHaveCSS('font-size', '13px');
        await expect(page.getByTestId('profile-offline-status')).toHaveCSS('padding', '6px 16px 0px');
        expect(await page.getByTestId('profile-offline-status').evaluate((footer) => ({
            under: footer.previousElementSibling.contains(document.querySelector('[data-testid=profile-offline]')),
            height: footer.previousElementSibling.getBoundingClientRect().height,
        }))).toEqual({under: true, height: 48});
        await shot(page, 'mobile-offline-row');
        await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state),
            {timeout: 60_000}).toBe('activated');

        // act
        await context.setOffline(true);
        await page.goto(routes.doc(NOTE));

        // assert
        await expect(page.getByTestId('doc').locator('h1').first()).toContainText('Carried note');
        await expect(page.getByTestId('topbar').getByTestId('offline-mark')).toBeVisible();
        await shot(page, 'mobile-offline-mark');
    });

    test('offline the Search tab stays and opens the notes opened last, with the field off', async ({page, context}) => {
        // arrange
        await openProfile(page);
        await page.getByTestId('profile-offline').tap();
        await expect(page.getByTestId('profile-offline-status')).toContainText(text.offline.updated, {timeout: 60_000});
        await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state),
            {timeout: 60_000}).toBe('activated');
        await page.goto(routes.doc(NOTE));
        await expect(page.getByTestId('doc')).toBeVisible();
        await context.setOffline(true);
        await page.goto(routes.home());
        await expect(page.getByTestId('tab-search')).toBeVisible();

        // act
        await page.getByTestId('tab-search').tap();

        // assert
        await expect(page.getByTestId('search-offline')).toHaveText(text.search.offline);
        await expect(page.getByTestId('search-input')).toBeDisabled();
        await expect(page.getByTestId('search-mode')).toHaveCount(0);
        await expect(page.getByTestId('search-case')).toHaveCount(0);
        await expect(page.getByTestId('search-recent-item').first()).toHaveAttribute('data-path', NOTE);
        await shot(page, 'mobile-offline-search');
        await page.getByTestId('search-recent-item').first().tap();
        await expect(page.getByTestId('doc').locator('h1').first()).toContainText('Carried note');
    });
});
