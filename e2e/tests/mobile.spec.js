const {expect, test} = require('../support/test');

const fs = require('fs');

const docs = require('../support/docs');
const {breakOrigin, restoreOrigin} = require('../support/git');
const {
    HISTORY, MAIN, MULTI, atHome, expectNoHorizontalScroll, fixtureFile, inStep, routes, save, setSource, shot,
    signIn, sourceText, writeFixture,
} = require('../support/helpers');
const text = require('../support/text');

// an icon and a menu row take a fingertip; a labelled button and a choice of
// a few are a little lower, one height each wherever they stand
const MIN_TAP = 44;
const BUTTON_HEIGHT = 40;
const CHOICE_HEIGHT = 36;
const ROW_HEIGHT = 48;
const DOC = docs.doc.path;
const SCRATCH = 'e2e-mobile/zametka.md';
const EMPTY_FOLDER = 'e2e-mobile/pusto';
const HISTORY_FOLDER = 'e2e-mobile-history';
const HISTORY_DOC = `${HISTORY_FOLDER}/versions.md`;

// tooSmall reports every element of a selector that is under the minimum touch
// size, so a failure names the offender instead of giving a bare count
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

// openSpaceMenu opens the menu of the space, which on a phone heads the root
// list in the top bar
async function openSpaceMenu(page) {
    await page.goto(routes.home());
    await page.getByTestId('space-menu').tap();
    await expect(page.getByTestId('space-menu-dropdown')).toBeVisible();
}

// boxOf is where an element sits on the screen, in whole pixels
async function boxOf(page, testId) {
    const box = await page.getByTestId(testId).boundingBox();
    return {
        left: Math.round(box.x), top: Math.round(box.y),
        right: Math.round(box.x + box.width), bottom: Math.round(box.y + box.height),
    };
}

test.describe('mobile', () => {
    test.beforeEach(async ({page}) => {
        await signIn(page);
    });

    test.afterAll(() => {
        fs.rmSync(fixtureFile('e2e-mobile'), {recursive: true, force: true});
        fs.rmSync(fixtureFile(HISTORY_FOLDER, HISTORY), {recursive: true, force: true});
    });

    // every control a thumb needs sits at the bottom of a phone: the tabs, and
    // on a note the round Edit button above them
    test('the tab bar sits at the bottom with Notes, Search, Recent and New', async ({page}) => {
        // act
        await page.goto(routes.doc(DOC));

        // assert
        const bar = page.getByTestId('tab-bar');
        await expect(bar.locator('button')).toHaveText(['Notes', 'Search', 'Recent', 'New']);
        const box = await bar.boundingBox();
        expect(Math.round(box.y + box.height)).toBe(page.viewportSize().height);
        await expect(page.getByTestId('sidebar')).toHaveCount(0);
        await expect(page.getByTestId('topbar-burger')).toHaveCount(0);
        expect(await tooSmall(page, '[data-testid=tab-bar] button')).toEqual([]);
        await shot(page, 'mobile-tab-bar');
    });

    // a phone has no tree: the folder list is the way through the space, one
    // level at a time, the way the Files app on iOS has it
    test('Notes opens the root list, a folder opens its list, and the back link goes up', async ({page}) => {
        // arrange
        await page.goto(routes.doc(DOC));

        // act & assert
        await page.getByTestId('tab-notes').tap();
        await expect(page).toHaveURL(atHome());
        const folder = page.locator(`[data-testid=dir-row][data-path="${docs.folder.path}"]`);
        await expect(folder.getByTestId('dir-row-meta')).toHaveText(/^\d+ items?$/);
        await folder.tap();
        await expect(page).toHaveURL(MAIN.url.dir(docs.folder.path));
        await expect(page.getByTestId('dir-up')).toHaveCount(0);
        await expect(page.getByTestId('dir-new')).toHaveCount(0);
        await expect(page.locator(`[data-testid=dir-row][data-path="${docs.folder.entry}"] [data-testid=dir-row-meta]`))
            .toHaveText(/ · /);
        await shot(page, 'mobile-folder-list');

        await page.getByTestId('topbar-up').tap();
        await expect(page).toHaveURL(atHome());
    });

    test('a screen opened slides in from the right, one gone back to from the left, a tab not at all', async ({page}) => {
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
        await page.getByTestId('tab-recent').tap();
        await expect(page.getByTestId('tab-recent')).toHaveAttribute('data-current', 'true');
        await page.getByTestId('tab-notes').tap();
        await expect(page).toHaveURL(atHome());
        expect(await moves()).toEqual(['translateX(28%)', 'translateX(-28%)']);
    });

    test.describe('a swipe from the left edge', () => {
        // swipe drags a finger from the left edge of the screen across to x, resting
        // between its steps the way a slow finger does
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

        test('in an app from the home screen goes back, and a short one leaves the page', async ({page}) => {
            // arrange
            await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', {value: true}));
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
    });

    test('a long press on the chrome selects nothing, and the text of a note still selects', async ({page}) => {
        // act
        await page.goto(routes.doc(DOC));

        // assert
        await expect(page.getByTestId('tab-bar')).toHaveCSS('user-select', 'none');
        await expect(page.getByTestId('topbar')).toHaveCSS('user-select', 'none');
        await expect(page.getByTestId('doc')).toHaveCSS('user-select', 'text');
    });

    test('Recent lists a note opened, keeps it after a reload, and its menu clears it', async ({page}) => {
        // arrange
        await page.goto(routes.doc(DOC));
        await expect(page.getByTestId('doc')).toBeVisible();

        // act
        await page.getByTestId('tab-recent').tap();

        // assert
        await expect(page.getByTestId('tab-recent')).toHaveAttribute('data-current', 'true');
        await expect(page.getByTestId('recent-item').first()).toHaveAttribute('data-path', DOC);
        await page.reload();
        await expect(page.getByTestId('recent-item').first()).toHaveAttribute('data-path', DOC);
        await shot(page, 'mobile-recent');

        await page.getByTestId('recent-menu').tap();
        await page.getByTestId('recent-menu-clear').tap();
        await expect(page.getByTestId('recent-item')).toHaveCount(0);
        await expect(page.getByTestId('recent-empty-title')).toHaveText('Nothing opened yet');
    });

    test('New makes a note in the folder on screen and opens the editor', async ({page}) => {
        // arrange
        fs.mkdirSync(fixtureFile(EMPTY_FOLDER), {recursive: true});
        await page.goto(routes.dir(EMPTY_FOLDER));
        await expect(page.getByTestId('dir-empty')).toBeVisible();

        // act
        await page.getByTestId('tab-new').tap();
        await page.getByTestId('new-menu-note').tap();
        await expect(page.getByTestId('new-entry-name')).toBeFocused();
        await page.getByTestId('new-entry-name').fill('made on a phone');
        await shot(page, 'mobile-new-entry');
        await page.getByTestId('new-entry-create').tap();

        // assert
        await expect(page).toHaveURL(MAIN.url.edit(`${EMPTY_FOLDER}/made-on-a-phone.md`));
        expect(fs.existsSync(fixtureFile(`${EMPTY_FOLDER}/made-on-a-phone.md`))).toBe(true);
    });

    // a menu opens beside the control that opened it, the way a phone's own
    // menus do, and stays on the screen
    test('the note menu opens under its button, on the screen', async ({page}) => {
        // arrange
        await page.goto(routes.doc(DOC));

        // act
        await page.getByTestId('note-menu').tap();

        // assert
        await expect(page.getByTestId('note-menu-dropdown')).toBeVisible();
        const button = await boxOf(page, 'note-menu');
        const menu = await boxOf(page, 'note-menu-dropdown');
        expect(menu.top).toBeGreaterThanOrEqual(button.bottom);
        expect(menu.top - button.bottom).toBeLessThan(16);
        expect([menu.left >= 0, menu.right <= page.viewportSize().width]).toEqual([true, true]);
        await expect(page.getByTestId('note-menu-find')).toBeVisible();
        await expect(page.getByTestId('note-menu-outline')).toBeVisible();
        await shot(page, 'mobile-note-menu-open');
    });

    test('the space button opens the space menu under it', async ({page}) => {
        // act
        await openSpaceMenu(page);

        // assert
        const button = await boxOf(page, 'space-menu');
        const menu = await boxOf(page, 'space-menu-dropdown');
        expect(menu.top).toBeGreaterThanOrEqual(button.bottom);
        expect(menu.left).toBeLessThan(page.viewportSize().width / 2);
        await expect(page.getByTestId('space-menu-shortcuts')).toHaveCount(0);
    });

    // the tap that put a menu away went on to the row under it and opened
    // the file there
    test('a tap beside an open menu closes it and opens nothing', async ({page}) => {
        // arrange
        await page.goto(routes.dir(docs.folder.path));
        const row = page.locator(`[data-testid=dir-row][data-path="${docs.folder.entry}"]`);
        await expect(row).toBeVisible();
        await page.getByTestId('folder-menu').tap();
        await expect(page.getByTestId('folder-menu-dropdown')).toBeVisible();
        const box = await row.boundingBox();

        // act
        await page.touchscreen.tap(box.x + 20, box.y + box.height / 2);

        // assert
        await expect(page.getByTestId('folder-menu-dropdown')).toHaveCount(0);
        await expect(page).toHaveURL(MAIN.url.dir(docs.folder.path));
    });

    test('the Edit button opens the editor', async ({page}) => {
        // arrange
        await page.goto(routes.doc(DOC));
        await expect(page.getByTestId('doc-edit')).toHaveCount(0);

        // act
        await page.getByTestId('edit-button').tap();

        // assert
        await expect(page).toHaveURL(MAIN.url.edit(DOC));
        await expect(page.getByTestId('tab-bar')).toHaveCount(0);
    });

    test('scrolling down puts the tab bar away and scrolling up brings it back', async ({page}) => {
        // arrange
        await page.goto(routes.doc(docs.long.path));
        await expect(page.getByTestId('doc')).toBeVisible();
        const bottom = async () => Math.round((await page.getByTestId('tab-bar').boundingBox()).y);
        const height = page.viewportSize().height;

        // act & assert
        await page.mouse.wheel(0, 600);
        await expect.poll(bottom).toBeGreaterThanOrEqual(height);
        await page.mouse.wheel(0, -200);
        await expect.poll(bottom).toBeLessThan(height);
    });

    // the search takes the screen the way a phone's own does, its field at the
    // bottom where the thumb is, and Cancel is the way back
    test('the search takes the whole screen, its field at the bottom, and Cancel puts it away', async ({page}) => {
        // arrange
        await page.goto(routes.doc(DOC));

        // act
        await page.getByTestId('tab-search').tap();

        // assert
        await expect(page.getByTestId('search-input')).toBeVisible();
        const dialog = await boxOf(page, 'search-dialog');
        expect([dialog.top, dialog.bottom]).toEqual([0, page.viewportSize().height]);
        // the field sits at the bottom, under the thumb, and the results above it
        const field = await boxOf(page, 'search-input');
        expect(field.top).toBeGreaterThan(page.viewportSize().height * 0.75);
        await expect(page.getByTestId('search-footer')).not.toContainText('Select');
        // the mode and the titles chip beside it are one height, not two
        const mode = await boxOf(page, 'search-mode');
        const titles = await boxOf(page, 'search-titles');
        expect([mode.bottom - mode.top, titles.bottom - titles.top]).toEqual([CHOICE_HEIGHT, CHOICE_HEIGHT]);
        await shot(page, 'mobile-search-open');

        await page.getByTestId('search-close').tap();
        await expect(page.getByTestId('search-dialog')).toHaveCount(0);
        await expect(page).toHaveURL(MAIN.url.doc(DOC));
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

    // taken a quarter down the screen, the position kept what was above it at
    // its rendered height, and in the wrapped source the heading went off screen
    test('the editor opens with the heading at the top where it was, and comes back to it', async ({page}) => {
        // arrange
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
        // the button left with the tab bar on the way down, and a tap on it
        // would have to scroll back up first
        await page.getByTestId('edit-button').dispatchEvent('click');
        const inEditor = () => page.locator('.cm-line', {hasText: '## Середина'}).evaluate((line) =>
            Math.round(line.getBoundingClientRect().top - line.closest('.cm-scroller').getBoundingClientRect().top));

        // assert
        await expect.poll(inEditor).toBeGreaterThanOrEqual(0);
        await expect.poll(inEditor).toBeLessThanOrEqual(before + 4);

        // act
        await page.getByTestId('editor-cancel').tap();

        // assert
        await expect.poll(onPage).toBeGreaterThanOrEqual(before - 2);
        await expect.poll(onPage).toBeLessThanOrEqual(before + 2);
    });

    // a fence renders a row per source line and pads its box besides, so a
    // position taken as a fraction of the box crept a line on every round trip
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
            await page.getByTestId('edit-button').dispatchEvent('click');

            // assert
            // the anchor may be the row above, and a source line is taller than a row
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

        // the page holds dozens, so report the first few by name
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

    // the heading link icon lives in a 20px gutter left of the heading, and a
    // phone keeps 16px at the edge: it hung off the screen over the first letter
    test('a heading carries no link icon on a phone', async ({page}) => {
        await page.goto(routes.doc(DOC));
        await expect(page.getByTestId('doc').locator('h1').first()).toBeVisible();

        await expect(page.getByTestId('doc-heading-anchor').first()).toBeHidden();
    });

    // the preview alone sat in a column as wide as its longest line, and the
    // text ran off the right edge of the screen
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

    // the path once shared the top bar with nine controls and got about 25px of
    // it, and its crumbs fell over the note. On a phone the bar holds the way
    // back, the title once the note's own has gone, and the note's menu.
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

    // the icons and the note share one line 16px from either edge, the way
    // GitHub keeps 15px on a phone
    test('the top bar icons and the page text share both edges', async ({page}) => {
        await page.goto(routes.doc(DOC));

        const width = page.viewportSize().width;
        const back = await page.getByTestId('topbar-up').locator('svg').boundingBox();
        const dots = await page.getByTestId('note-menu').locator('svg').boundingBox();
        const heading = await page.getByTestId('doc').locator('h1').first().boundingBox();
        const left = Math.round(back.x);
        const right = Math.round(width - dots.x - dots.width);
        expect(right).toBe(left);
        expect([Math.round(heading.x), Math.round(width - heading.x - heading.width)]).toEqual([left, right]);
    });

    test('a note at the root goes back to the list of the space', async ({page}) => {
        // arrange
        await page.goto(routes.doc('index.md'));
        await expect(page.getByTestId('doc')).toBeVisible();

        // act
        await page.getByTestId('topbar-up').tap();

        // assert
        await expect(page).toHaveURL(atHome());
        await expect(page.getByTestId('space-menu')).toBeVisible();
    });

    test('the menu switches the theme and names the account', async ({page}) => {
        await openSpaceMenu(page);
        await shot(page, 'mobile-more-menu');

        const theme = page.getByTestId('space-menu-theme');
        await theme.getByText('Dark', {exact: true}).tap();
        await expect(theme).toHaveAttribute('data-theme', 'dark');
        await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'dark');
        await expect(page.getByTestId('space-menu-signout')).toBeVisible();
    });

    // the diff is a nowrap pre, so a bare track takes the width of the longest
    // patch line: the page stretched far past the viewport and Restore sat off
    // screen
    test('the history fills the screen, the versions under the version, Restore big enough to tap', async ({page}) => {
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
        const version = await page.getByTestId('history-version').boundingBox();
        const list = await page.getByTestId('history-list').boundingBox();
        expect(list.y, 'the versions sit under the version').toBeGreaterThanOrEqual(version.y + version.height - 1);
        const viewport = page.viewportSize().width;
        const box = await page.getByTestId('version-restore').boundingBox();
        expect(box.x + box.width, 'Restore reaches past the right edge').toBeLessThanOrEqual(viewport);
        expect(await tooSmall(page, '[data-testid=version-restore]', BUTTON_HEIGHT)).toEqual([]);

        await page.getByTestId('version').nth(1).tap();
        await expect(page.locator('[data-testid=version][data-selected="true"]')).toHaveAttribute(
            'data-rev', await page.getByTestId('version').nth(1).getAttribute('data-rev'),
        );
        await expect(page.getByTestId('rendered-diff')).toBeVisible();
        await expectNoHorizontalScroll(page);
        await page.getByTestId('history-diff-view').getByText('Source').tap();
        const diff = page.getByTestId('history-diff');
        await expect(diff).toBeVisible();
        // the patch scrolls inside its own box rather than taking the page with it
        expect(await diff.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
        await expectNoHorizontalScroll(page);
        await shot(page, 'mobile-history');
    });

    test('the search opens from its tab and navigates', async ({page}) => {
        await page.goto(routes.doc(DOC));
        await page.waitForLoadState('networkidle');
        await page.getByTestId('tab-search').tap();

        await expect(page.getByTestId('search-input')).toBeVisible();
        await page.getByTestId('search-input').fill(docs.search.palette.query);
        await expect(page.getByTestId('search-result').first()).toBeVisible();
        await shot(page, 'mobile-search');

        await page.getByTestId('search-result').first().tap();
        await expect(page).toHaveURL(new RegExp(`${routes.doc(docs.search.palette.path)}\\?q=`));
    });

    // an entry is reached by a hash, which react router replaces rather than
    // pushes, and that still has to close the sheet
    test('the outline sheet opens from the note menu', async ({page}) => {
        await page.goto(routes.doc(DOC));
        await page.getByTestId('note-menu').tap();
        await page.getByTestId('note-menu-outline').tap();

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

    // a menu kept mantine's desktop rows on a phone: 26px tall in 14px text,
    // so the theme and the space sat three to a fingertip
    test('the rows of every menu are big enough to tap', async ({page}) => {
        // act & assert
        await openSpaceMenu(page);
        await expect(page.getByTestId('space-menu-theme')).toBeVisible();
        expect(await tooSmall(page, '[role=menuitem]'), 'the space menu').toEqual([]);
        const themes = await page.getByTestId('space-menu-theme').boundingBox();
        expect(Math.round(themes.height), 'the theme picker').toBe(CHOICE_HEIGHT);
        await page.keyboard.press('Escape');

        await page.goto(routes.doc(DOC));
        await page.getByTestId('note-menu').tap();
        await expect(page.getByTestId('note-menu-dropdown')).toBeVisible();
        await shot(page, 'mobile-note-menu');
        expect(await tooSmall(page, '[role=menuitem]'), 'the note menu').toEqual([]);
    });

    // the strip of formatting buttons followed a finger in every direction:
    // past its ends sideways, and up and down together with the page behind it
    test('the editor toolbar moves along one axis and shows where it goes on', async ({page}) => {
        // arrange
        writeFixture(SCRATCH, '# Заметка\n\nтекст\n');
        await page.goto(routes.edit(SCRATCH));
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

    // a phone has no room for a name row, so a file started from the page is
    // named in a small dialog
    test('a file started from an empty folder is named in a dialog', async ({page}) => {
        // arrange
        fs.mkdirSync(fixtureFile(EMPTY_FOLDER), {recursive: true});
        await page.goto(routes.dir(EMPTY_FOLDER));
        await expect(page.getByTestId('dir-empty-title')).toHaveText(text.dir.empty);
        await shot(page, 'mobile-empty-folder');
        expect(await tooSmall(page, '[data-testid=dir-empty] button', BUTTON_HEIGHT)).toEqual([]);

        // act
        await page.getByTestId('dir-empty-new-page').tap();

        // assert
        await expect(page.getByTestId('new-entry-name')).toBeInViewport();
        await expect(page.getByTestId('new-entry-name')).toBeFocused();
        expect(await tooSmall(page, '[data-testid=new-entry-cancel], [data-testid=new-entry-create]', BUTTON_HEIGHT))
            .toEqual([]);
    });

    test('the search is usable with the phone turned sideways', async ({page}) => {
        await page.setViewportSize({width: 844, height: 390});
        await page.goto(routes.doc(DOC));
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

// a phone has no tree and the document body carries
// no badge, so the topbar control is the one surface that answers "is this
// note at risk". These drive the remote space for that reason.
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
        restoreOrigin(wiki.origin);
        fs.rmSync(`${wiki.dir}/${SYNC_DOC}`, {force: true});
        fs.rmSync(`${wiki.dir}/${SYNC_FOLDER}`, {recursive: true, force: true});
        await inStep(page, WIKI);
    });

    // saveStuck writes one note through the editor with the origin already
    // broken, which is what puts its path in the unsynced set.
    async function saveStuck(page, contentPath, source) {
        await page.goto(WIKI.edit(contentPath));
        await setSource(page, source);
        await save(page);
    }

    test('the control and the banner reach a phone, which has no tree', async ({page}) => {
        breakOrigin(wiki.origin);
        await saveStuck(page, SYNC_DOC, '# Mobile sync\n\nstuck.\n');

        await page.goto(WIKI.doc(SYNC_DOC));
        await expect(page.getByTestId('sync-control')).toHaveAttribute('data-here', 'true');
        await expect(page.getByTestId('space-alert')).toBeVisible();
        // a phone has no tree, which is what makes the control the one surface
        // that speaks for this note
        await expect(page.getByTestId('sidebar')).toHaveCount(0);
        await shot(page, 'mobile-sync-control');

        await page.getByTestId('sync-control').tap();
        await expect(page.getByTestId('sync-details')).toBeVisible();
        await expect(page.getByTestId('sync-popover-here')).toBeVisible();
        await shot(page, 'mobile-sync-sheet');
    });

    // the root index and a folder index, each under its own address
    test('an index note reaches the control on a phone too', async ({page}) => {
        breakOrigin(wiki.origin);
        // the root index belongs to the corpus and cannot be deleted between
        // runs, so the text carries a stamp: a save that writes the bytes the
        // file already holds stages nothing, commits nothing and is missing
        // from the very path set this asserts on
        await saveStuck(page, 'index.md', `# Remote page\n\nthe root index on a phone, stuck at ${Date.now()}.\n`);
        await saveStuck(page, `${SYNC_FOLDER}/index.md`, '# Guide\n\nthe folder index, stuck.\n');

        await page.goto(WIKI.doc('index.md'));
        await expect(page.getByTestId('space-alert')).toBeVisible();
        await expect(page.getByTestId('sync-control')).toHaveAttribute('data-here', 'true');

        await page.goto(WIKI.doc(`${SYNC_FOLDER}/index.md`));
        await expect(page.getByTestId('sync-control')).toHaveAttribute('data-here', 'true');
        await shot(page, 'mobile-sync-folder-index');
    });

    // the row is as full as it gets: every control keeps its size and the
    // title gives way
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
});
