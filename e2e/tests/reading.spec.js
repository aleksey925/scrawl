const zlib = require('node:zlib');

const {expect, test} = require('../support/test');

const docs = require('../support/docs');
const {
    MAIN, chooseTheme, modifier, openSpaceMenu, pressShortcut, removeFixture, rgb, routes, shot, showOutline,
    signIn, writeFixture,
} = require('../support/helpers');
const text = require('../support/text');
const darkTheme = require('../../theme/themes/dark.json');
const lightTheme = require('../../theme/themes/light.json');

const DOC = docs.doc;
const ANCHORS = 'e2e-anchors.md';
const ANCHOR_SOURCE = 'e2e-anchor-source.md';
const OUTLINE = 'e2e-outline.md';
const EMPHASIS = 'e2e-emphasis.md';
const DIAGRAM = 'e2e-diagram.md';
const DIAGRAM_VIEWER = 'e2e-diagram-viewer.md';
const LOOK = 'e2e-look.md';
const TALL = 'e2e-tall.md';
const TALL_PICTURE = 'e2e-tall.png';

function pngChunk(type, data) {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const named = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(named));
    return Buffer.concat([head, named, crc]);
}

function grayPng(width, height) {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    const rows = Buffer.alloc((width + 1) * height, 128);
    for (let row = 0; row < height; row++) {
        rows[row * (width + 1)] = 0;
    }
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk('IHDR', header),
        pngChunk('IDAT', zlib.deflateSync(rows)),
        pngChunk('IEND', Buffer.alloc(0)),
    ]);
}

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

    test.afterEach(() => {
        removeFixture(DIAGRAM_VIEWER);
        removeFixture(TALL);
        removeFixture(TALL_PICTURE);
    });

    test('the root page lists the root folder, its index a row tagged as the folder page', async ({page}) => {
        // assert
        await expect(page.getByTestId('dir')).toBeVisible();
        const index = page.locator('[data-testid=dir-row][data-path="index.md"]');
        await expect(index.getByTestId('dir-folder-page')).toBeVisible();
        await expect(page.getByTestId('dir-folder-page')).toHaveCount(1);
        await shot(page, 'reading-root');
    });

    test('Home opens the root index note', async ({page}) => {
        // act
        await page.getByTestId('sidebar-home').click();

        // assert
        await expect(page).toHaveURL(MAIN.url.doc('index.md'));
        await expect(page.getByTestId('doc').locator('h1').first()).toContainText(docs.home.title);
        await expect(page.getByTestId('sidebar-home')).toHaveAttribute('data-current', 'true');
    });

    test('a click on a row of a folder opens it', async ({page}) => {
        // act & assert
        await page.locator(`[data-testid=dir-row][data-path="${DOC.folder}"]`).click({position: {x: 400, y: 10}});
        await expect(page).toHaveURL(MAIN.url.dir(DOC.folder));
        await page.locator(`[data-testid=dir-row][data-path="${DOC.path}"] td`).last().click();
        await expect(page).toHaveURL(MAIN.url.doc(DOC.path));
    });

    test('a note whose name a url has to escape opens', async ({page}) => {
        for (const [name, title] of [['e2e-100%.md', 'Percent'], ['e2e-a%20b.md', 'Escaped']]) {
            // arrange
            writeFixture(name, `# ${title}\n`);

            // act
            await page.goto(routes.doc(name));

            // assert
            await expect(page.getByTestId('doc').locator('h1')).toHaveText(title);
            removeFixture(name);
        }
    });

    test('a link to a heading of the same note by its file lands on the heading', async ({page}) => {
        // arrange
        const filler = Array.from({length: 40}, () => 'line '.repeat(12)).join('\n\n');
        writeFixture('e2e-self.md', `# Self\n\n[jump](e2e-self.md#second)\n\n${filler}\n\n## Second\n\n${filler}\n`);
        await page.goto(routes.doc('e2e-self.md'));

        // act
        await page.getByTestId('doc').getByRole('link', {name: 'jump'}).click();

        // assert
        await expect(page).toHaveURL(/#second$/);
        await expect.poll(() => page.locator('[data-testid=doc] h2#second').evaluate((el) => Math.round(el.getBoundingClientRect().top)))
            .toBeLessThan(170);
        removeFixture('e2e-self.md');
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

    test('a space that records no versions offers no History', async ({page}) => {
        // act
        await page.goto(routes.doc(DOC.path));

        // assert
        await expect(page.getByTestId('note-menu')).toBeVisible();
        await expect(page.getByTestId('doc-history')).toHaveCount(0);
        await page.getByTestId('note-menu').click();
        await expect(page.getByTestId('doc-export-md')).toBeVisible();
        await expect(page.getByTestId('note-menu-history')).toHaveCount(0);
    });

    test('a folder label opens the folder page and expands the row', async ({page}) => {
        await page.locator(`[data-testid=tree-row][data-path="${DOC.folder}"] [data-testid=tree-link]`).click();

        await expect(page).toHaveURL(MAIN.url.dir(DOC.folder));
        await expect(page.getByTestId('dir')).toBeVisible();
        await expect(page.locator(`[data-testid=tree-row][data-path="${DOC.folder}"] [data-testid=tree-twisty]`))
            .toHaveAttribute('data-open', 'true');
        await shot(page, 'reading-folder-page');
    });

    test('a right click on a tree row opens its menu and stays on the page', async ({page}) => {
        // arrange
        await page.goto(routes.doc(DOC.path));
        const other = page.locator('[data-testid=tree-row][data-current="false"][data-dir="false"]').first();

        // act
        await other.getByTestId('tree-link').click({button: 'right'});

        // assert
        await expect(page.getByTestId('tree-row-menu-dropdown')).toBeVisible();
        await expect(other.getByTestId('tree-row-menu')).toHaveAttribute('data-opened', 'true');
        await expect(page).toHaveURL(MAIN.url.doc(DOC.path));
    });

    test('an open folder label opens its page first and folds the folder on its page', async ({page}) => {
        // arrange
        await page.goto(routes.doc(DOC.path));
        const folder = page.locator(`[data-testid=tree-row][data-path="${DOC.folder}"]`);
        await expect(folder.getByTestId('tree-twisty')).toHaveAttribute('data-open', 'true');

        // act & assert
        await folder.getByTestId('tree-link').click();
        await expect(page).toHaveURL(MAIN.url.dir(DOC.folder));
        await expect(folder.getByTestId('tree-twisty')).toHaveAttribute('data-open', 'true');

        await folder.getByTestId('tree-link').click();
        await expect(folder.getByTestId('tree-twisty')).toHaveAttribute('data-open', 'false');
        await expect(page.locator(`[data-testid=tree-row][data-path="${DOC.path}"]`)).toHaveCount(0);
        await expect(page).toHaveURL(MAIN.url.dir(DOC.folder));
    });

    test('the sidebar filter narrows the tree and highlights the match', async ({page}) => {
        const filter = page.getByTestId('sidebar-filter');
        await filter.fill(docs.filter.term);

        await expect(page.locator(`[data-testid=tree-row][data-path="${docs.filter.path}"] mark`))
            .toHaveText(docs.filter.term);
        const shown = () => page.getByTestId('tree-row').evaluateAll(
            (rows) => rows.map((row) => row.dataset.path));
        await expect.poll(shown).toContain(docs.filter.path);
        await expect.poll(async () => (await shown()).length).toBeLessThan(4);
        await shot(page, 'reading-tree-filter');

        await page.getByTestId('sidebar-filter-clear').click();
        await expect(filter).toHaveValue('');
        await expect.poll(async () => (await shown()).length).toBeGreaterThan(4);
    });

    for (const theme of [lightTheme, darkTheme]) {
        test(`a field in focus is drawn with the focus ring of the theme, ${theme.scheme}`, async ({page}) => {
            // arrange
            await page.emulateMedia({colorScheme: theme.scheme});
            await page.goto(routes.home());
            const filter = page.getByTestId('sidebar-filter');

            // act
            await filter.focus();

            // assert
            const [inner, outer] = [rgb(theme.palette.focusRing), rgb(theme.palette.focusRingOuter)];
            await expect(filter).toHaveCSS('box-shadow', `${inner} 0px 0px 0px 1px inset, ${outer} 0px 0px 0px 1px`);
            await shot(page, `reading-field-focus-${theme.scheme}`);
        });
    }

    test('a filter that matches nothing offers the full text search instead', async ({page}) => {
        await page.getByTestId('sidebar-filter').fill('zzzznotinthetreezzzz');

        await expect(page.getByTestId('sidebar-empty')).toHaveText(text.sidebar.nothingMatches);
        await expect(page.getByTestId('tree-row')).toHaveCount(0);
    });

    test('the page does not stretch past its ends beside the sidebar', async ({page}) => {
        // act
        await page.goto(routes.doc(DOC.path));

        // assert
        await expect(page.getByTestId('doc')).toBeVisible();
        expect(await page.evaluate(() => getComputedStyle(document.documentElement).overscrollBehaviorY)).toBe('none');
    });

    test('a deeply nested document renders', async ({page}) => {
        await page.goto(routes.doc(docs.deep.path));

        await expect(page.getByTestId('doc').locator('h1').first()).toContainText(docs.deep.title);
        await expect(page.getByTestId('doc').locator('h2')).not.toHaveCount(0);
        await expect(page.getByTestId('topbar-crumbs').getByTestId('crumb')).toContainText(docs.deep.crumbs);
        await expect(page.locator('[data-testid=crumb][data-current="true"]')).toHaveCount(1);
        await shot(page, 'reading-deep-document');
    });

    test('an in page anchor scrolls to its heading', async ({page}) => {
        writeFixture(ANCHORS, anchorDocument());
        await page.goto(routes.doc(ANCHORS));
        await expect(page.getByTestId('doc').locator('h2')).toHaveCount(1);
        expect(await page.evaluate(() => window.scrollY)).toBe(0);

        await page.getByTestId('doc').getByRole('link', {name: 'разделу'}).click();

        await expect
            .poll(() => page.getByTestId('doc').locator('h2').first().evaluate(
                (el) => el.getBoundingClientRect().top))
            .toBeLessThan(250);
        expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
        await shot(page, 'reading-anchor');

        removeFixture(ANCHORS);
    });

    test('an anchor written in another case than its slug still resolves', async ({page}) => {
        writeFixture(ANCHORS, anchorDocument().replace('(#раздел)', '(#Раздел)'));
        await page.goto(routes.doc(ANCHORS));

        await page.getByTestId('doc').getByRole('link', {name: 'разделу'}).click();
        await expect
            .poll(() => page.getByTestId('doc').locator('h2').first().evaluate(
                (el) => el.getBoundingClientRect().top))
            .toBeLessThan(250);
        expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(200);

        removeFixture(ANCHORS);
    });

    test('a page opened with a fragment lands on its heading, and again after a reload', async ({page}) => {
        // arrange
        writeFixture(ANCHORS, anchorDocument());
        const heading = page.getByTestId('doc').locator('h2').first();
        const headingTop = () => heading.evaluate((el) => el.getBoundingClientRect().top);

        // act
        await page.goto(`${routes.doc(ANCHORS)}#${encodeURIComponent('раздел')}`);

        // assert
        await expect.poll(headingTop).toBeLessThan(250);
        expect(await headingTop()).toBeGreaterThan(0);

        // act
        await page.reload();

        // assert
        await expect.poll(headingTop).toBeLessThan(250);
        expect(await headingTop()).toBeGreaterThan(0);
        await shot(page, 'reading-fragment-reload');

        removeFixture(ANCHORS);
    });

    test('coming back from the editor lands where the editing was, not on the fragment', async ({page}) => {
        // arrange
        writeFixture(ANCHORS, anchorDocument());
        const heading = page.getByTestId('doc').locator('h2').first();
        const headingTop = () => heading.evaluate((el) => el.getBoundingClientRect().top);
        await page.goto(`${routes.doc(ANCHORS)}#${encodeURIComponent('раздел')}`);
        await expect.poll(headingTop).toBeLessThan(250);
        await page.getByTestId('doc-edit').click();
        const source = await page.getByTestId('editor-source').boundingBox();
        await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
        await page.mouse.wheel(0, -100000);
        await page.getByTestId('editor-source').locator('.cm-line').first().click();
        await page.keyboard.type('x');
        await page.getByTestId('editor-save').click();
        await expect(page.getByRole('alert').filter({hasText: 'Saved'})).toBeVisible();

        // act
        await page.goBack();

        // assert
        await expect(page).toHaveURL(/#/);
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(200);
        expect(await headingTop()).toBeGreaterThan(250);

        removeFixture(ANCHORS);
    });

    test('a link to a heading of another document lands on that heading', async ({page}) => {
        // arrange
        writeFixture(ANCHORS, anchorDocument());
        writeFixture(ANCHOR_SOURCE, `# Источник\n\n[в раздел](${ANCHORS}#раздел)\n`);
        await page.goto(routes.doc(ANCHOR_SOURCE));
        const heading = page.getByTestId('doc').locator('h2').first();

        // act
        await page.getByTestId('doc').getByRole('link', {name: 'в раздел'}).click();

        // assert
        await expect.poll(() => heading.evaluate((el) => el.getBoundingClientRect().top)).toBeLessThan(250);
        expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(200);

        removeFixture(ANCHOR_SOURCE);
        removeFixture(ANCHORS);
    });

    test('a relative link between documents navigates', async ({page}) => {
        await page.getByTestId('sidebar-home').click();
        await page.getByTestId('doc').locator(
            `a[href="${routes.contentHref(docs.linked.path)}"]`).first().click();

        await expect(page).toHaveURL(MAIN.url.doc(docs.linked.path));
        await expect(page.getByTestId('doc').locator('h1').first()).toContainText(docs.linked.title);
    });

    test('an image loads through /raw/', async ({page}) => {
        await page.goto(routes.doc(docs.illustrated.doc));
        const image = page.getByTestId('doc').locator(`img[src^="${routes.raw('')}"]`).first();

        await expect(image).toBeVisible();
        const size = await image.evaluate((el) => ({w: el.naturalWidth, h: el.naturalHeight}));
        expect(size.w).toBeGreaterThan(0);
        expect(size.h).toBeGreaterThan(0);
        await shot(page, 'reading-image');
    });

    test('the image opens in the viewer and closes again', async ({page}) => {
        await page.goto(routes.doc(docs.illustrated.doc));
        await page.getByTestId('doc-image').first().click();

        await expect(page.getByTestId('doc-lightbox-image')).toBeVisible();
        await expect(page.getByTestId('doc-lightbox-caption')).toBeVisible();
        await shot(page, 'reading-lightbox');

        await page.getByTestId('doc-lightbox-close').click();
        await expect(page.getByTestId('doc-lightbox-image')).toHaveCount(0);
    });

    test('a click beside the image closes the viewer', async ({page}) => {
        // arrange
        await page.goto(routes.doc(docs.illustrated.doc));
        await page.getByTestId('doc-image').first().click();
        await expect(page.getByTestId('doc-lightbox-image')).toBeVisible();
        const size = page.viewportSize();

        // act
        await page.mouse.click(8, size.height - 8);

        // assert
        await expect(page.getByTestId('doc-lightbox')).toHaveCount(0);
        await expect(page.getByTestId('doc-image').first()).toBeFocused();
    });

    test('the viewer counts the zoom of a narrow, tall picture in fractions of a pixel', async ({page}) => {
        // arrange
        const natural = {width: 120, height: 3000};
        writeFixture(TALL_PICTURE, grayPng(natural.width, natural.height));
        writeFixture(TALL, `# Tall\n\n![tall](${TALL_PICTURE})\n`);
        await page.goto(routes.doc(TALL));
        await page.getByTestId('doc-image').first().click();
        const picture = page.getByTestId('doc-lightbox-image');
        const percent = page.getByTestId('doc-lightbox-zoom');
        await expect.poll(() => picture.evaluate((el) => el.complete && el.naturalHeight)).toBe(natural.height);
        await expect(percent).toHaveText(/^\d+%$/);
        const drawnHeight = () => picture.evaluate((el) => el.getBoundingClientRect().height);
        const fitted = Number.parseInt(await percent.textContent(), 10);
        const fittedHeight = await picture.evaluate((el) => Number.parseFloat(getComputedStyle(el).height));

        // act
        await page.keyboard.press('1');

        // assert
        expect(fitted).toBeLessThan(100);
        expect(Math.abs(fitted - (fittedHeight * 100) / natural.height)).toBeLessThanOrEqual(1);
        await expect(percent).toHaveText('100%');
        await expect.poll(async () => Math.abs(await drawnHeight() - natural.height)).toBeLessThanOrEqual(3);
    });

    test('the viewer zooms a picture with its buttons', async ({page}) => {
        // arrange
        await page.goto(routes.doc(docs.illustrated.doc));
        await page.getByTestId('doc-image').first().click();
        const percent = page.getByTestId('doc-lightbox-zoom');
        await expect(percent).toHaveText(/^\d+%$/);
        const fitted = await percent.textContent();

        // act & assert
        await expect(page.getByTestId('doc-lightbox-fit')).toBeDisabled();
        await page.getByTestId('doc-lightbox-zoom-in').click();
        await expect(percent).not.toHaveText(fitted);
        await expect(page.getByTestId('doc-lightbox-image')).toHaveAttribute('data-zoomed', 'true');
        await page.getByTestId('doc-lightbox-fit').click();
        await expect(percent).toHaveText(fitted);
        await expect(page.getByTestId('doc-lightbox-image')).toHaveAttribute('data-zoomed', 'false');
    });

    test('a diagram wider than the note is shown at its width and opens in the viewer at the size of the screen', async ({page}) => {
        // arrange
        const nodes = Array.from({length: 14}, (_, i) => `N${i}[Step number ${i}]`).join(' --> ');
        writeFixture(DIAGRAM_VIEWER, `# Wide\n\n\`\`\`mermaid\nflowchart LR\n  ${nodes}\n\`\`\`\n`);
        await page.goto(routes.doc(DIAGRAM_VIEWER));
        const frame = page.getByTestId('diagram-frame');
        await expect(frame).toBeVisible();
        const width = (locator) => locator.evaluate((el) => el.getBoundingClientRect().width);

        // act
        await frame.getByTestId('diagram-open').click();

        // assert
        expect(await width(frame)).toBeLessThanOrEqual(await width(page.getByTestId('doc')) + 1);
        await expect(page.getByTestId('doc-lightbox-diagram')).toBeVisible();
        const fitted = Number.parseInt(await page.getByTestId('doc-lightbox-zoom').textContent(), 10);
        expect(fitted).toBeLessThan(100);
        expect(await width(page.getByTestId('doc-lightbox-diagram'))).toBeLessThanOrEqual(page.viewportSize().width);
        await shot(page, 'reading-diagram-viewer');
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('doc-lightbox')).toHaveCount(0);
    });

    test('a mermaid diagram that mermaid sizes to the page is drawn at its own width, and the viewer knows that width', async ({page}) => {
        // arrange
        const events = Array.from({length: 8}, (_, i) => `    ${2000 + i} : Event number ${i}`).join('\n');
        writeFixture(DIAGRAM_VIEWER, `# Timeline\n\n\`\`\`mermaid\ntimeline\n    title History\n${events}\n\`\`\`\n`);
        await page.goto(routes.doc(DIAGRAM_VIEWER));
        const svg = page.getByTestId('diagram-frame').locator(':scope > svg');
        await expect(svg).toBeVisible();
        const natural = Number(await svg.getAttribute('width'));
        const shown = await svg.evaluate((el) => el.getBoundingClientRect().width);
        const room = await page.getByTestId('doc').evaluate((el) => el.getBoundingClientRect().width);

        // act
        await page.getByTestId('diagram-frame').click();
        await expect(page.getByTestId('doc-lightbox-zoom')).toHaveText(/^\d+%$/);
        await page.keyboard.press('1');

        // assert
        expect(natural).toBeGreaterThan(300);
        expect(Math.abs(shown - Math.min(natural, room))).toBeLessThanOrEqual(1);
        await expect(page.getByTestId('doc-lightbox-zoom')).toHaveText('100%');
        const actual = () => page.getByTestId('doc-lightbox-diagram').locator('svg')
            .evaluate((el) => el.getBoundingClientRect().width);
        await expect.poll(async () => Math.abs(await actual() - natural)).toBeLessThanOrEqual(1);
    });

    test('the viewer\'s copy of a diagram shares no id with the note', async ({page}) => {
        // arrange
        writeFixture(DIAGRAM_VIEWER, '# Ids\n\n```mermaid\nflowchart LR\n  A --> B\n```\n');
        await page.goto(routes.doc(DIAGRAM_VIEWER));
        const ids = (root) => root.evaluate((el) => Array.from(el.querySelectorAll('[id]'), (node) => node.id));
        await expect(page.getByTestId('diagram-frame')).toBeVisible();

        // act
        await page.getByTestId('diagram-frame').click();
        const copy = page.getByTestId('doc-lightbox-diagram');
        await expect(copy).toBeVisible();

        // assert
        const inNote = await ids(page.getByTestId('doc'));
        const inViewer = await ids(copy);
        expect(inViewer.length).toBeGreaterThan(0);
        expect(inViewer.filter((id) => inNote.includes(id))).toEqual([]);
        const fill = (root) => root.locator('.node rect').first().evaluate((el) => getComputedStyle(el).fill);
        expect(await fill(copy), 'the copy keeps the look its own stylesheet gives it').toBe(
            await fill(page.getByTestId('diagram-frame')));
    });

    test('the viewer zooms a diagram with its keys and shows that diagram alone', async ({page}) => {
        // arrange
        const nodes = Array.from({length: 10}, (_, i) => `N${i}[Step ${i}]`).join(' --> ');
        writeFixture(DIAGRAM_VIEWER, `# Two\n\n\`\`\`mermaid\nflowchart LR\n  ${nodes}\n\`\`\`\n\n\`\`\`plantuml\nA -> B : second\n\`\`\`\n`);
        await page.goto(routes.doc(DIAGRAM_VIEWER));
        await expect(page.getByTestId('diagram-frame')).toHaveCount(2);
        await page.getByTestId('diagram-frame').first().click();
        const percent = page.getByTestId('doc-lightbox-zoom');
        await expect(percent).toHaveText(/^\d+%$/);
        const fitted = await percent.textContent();

        // act & assert
        await page.keyboard.press('1');
        await expect(percent).toHaveText('100%');
        await page.keyboard.press('+');
        await expect(percent).toHaveText('150%');
        await page.keyboard.press('-');
        await expect(percent).toHaveText('100%');
        await page.keyboard.press('0');
        await expect(percent).toHaveText(fitted);
        await expect(page.getByTestId('doc-lightbox-count')).toHaveCount(0);
        await expect(page.getByTestId('doc-lightbox-next')).toHaveCount(0);
        await page.keyboard.press('ArrowRight');
        await expect(page.getByTestId('doc-lightbox-diagram')).toContainText('Step 0');
        await expect(page.getByTestId('doc-lightbox-diagram')).not.toContainText('second');
    });

    test('in the viewer the wheel moves a zoomed diagram, and a pinch zooms it', async ({page}) => {
        // arrange
        const nodes = Array.from({length: 10}, (_, i) => `N${i}[Step ${i}]`).join(' --> ');
        writeFixture(DIAGRAM_VIEWER, `# Pinch\n\n\`\`\`mermaid\nflowchart LR\n  ${nodes}\n\`\`\`\n`);
        await page.goto(routes.doc(DIAGRAM_VIEWER));
        await page.getByTestId('diagram-frame').click();
        const diagram = page.getByTestId('doc-lightbox-diagram');
        const percent = page.getByTestId('doc-lightbox-zoom');
        await expect(percent).toHaveText(/^\d+%$/);
        const level = async () => Number.parseInt(await percent.textContent(), 10);
        const fitted = await level();
        const send = (type, fields) => page.getByTestId('doc-lightbox').evaluate((dialog, [name, init]) => {
            const event = name === 'wheel'
                ? new WheelEvent('wheel', {bubbles: true, cancelable: true, clientX: innerWidth / 2, clientY: innerHeight / 2, ...init})
                : Object.assign(new Event(name, {bubbles: true, cancelable: true}), {clientX: innerWidth / 2, clientY: innerHeight / 2, ...init});
            dialog.dispatchEvent(event);
        }, [type, fields]);

        // act & assert
        await send('wheel', {deltaY: 120});
        expect(await level()).toBe(fitted);
        await send('wheel', {deltaY: -40, ctrlKey: true});
        await expect.poll(level).toBeGreaterThan(fitted);
        await page.keyboard.press('0');
        await send('gesturestart', {scale: 1});
        await send('gesturechange', {scale: 2});
        await expect.poll(async () => Math.abs(await level() - fitted * 2)).toBeLessThanOrEqual(1);
        const before = await diagram.boundingBox();
        await send('wheel', {deltaX: 30});
        const after = await diagram.boundingBox();
        expect(after.x).toBeLessThan(before.x);
        await send('wheel', {shiftKey: true, deltaY: 40});
        expect((await diagram.boundingBox()).x).toBeLessThan(after.x);
        expect(Math.abs(await level() - fitted * 2)).toBeLessThanOrEqual(1);
    });

    test('the copy button copies a code block', async ({page}) => {
        await page.goto(routes.doc(DOC.path));
        const block = page.getByTestId('doc-code').first();

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
        await showOutline(page);

        await page.locator(`[data-testid=doc] h2#${DOC.heading.id}`).evaluate((el) => {
            window.scrollTo({top: el.getBoundingClientRect().top + window.scrollY - 100, behavior: 'instant'});
        });

        const active = page.locator('[data-testid=toc-entry][data-active="true"]');
        await expect(active).toHaveCount(1);
        await expect(active).toContainText(DOC.heading.text);
        await shot(page, 'reading-toc-active');
    });

    test('the outline follows into a section taller than the reading band', async ({page}) => {
        const filler = (word) => Array.from({length: 40}, () => `${word} `.repeat(12)).join('\n\n');
        writeFixture(
            OUTLINE,
            ['# Outline probe', '', '## First', filler('one'), '## Second', filler('two'), '## Third', filler('three')]
                .join('\n\n'),
        );
        await page.goto(routes.doc(OUTLINE));
        await showOutline(page);

        await page.evaluate(() => {
            const second = document.querySelectorAll('[data-testid=doc] h2')[1];
            window.scrollTo({top: second.getBoundingClientRect().top + window.scrollY + 900, behavior: 'instant'});
        });

        const active = page.locator('[data-testid=toc-entry][data-active="true"]');
        await expect(active).toHaveText('Second');

        const visible = await page.evaluate(() => {
            const entry = document.querySelector('[data-testid=toc-entry][data-active="true"]');
            const rail = document.querySelector('[data-testid=mini-outline-panel]');
            if (entry === null || rail === null) {
                return null;
            }
            const box = entry.getBoundingClientRect();
            const host = rail.getBoundingClientRect();
            return box.top >= host.top - 1 && box.bottom <= host.bottom + 1;
        });
        expect(visible, 'the marked entry is inside the panel').toBe(true);

        removeFixture(OUTLINE);
    });

    test('the outline reaches the short sections at the end of a note', async ({page}) => {
        // arrange
        const filler = Array.from({length: 40}, () => 'long '.repeat(12)).join('\n\n');
        const tail = ['Fourth', 'Fifth', 'Sixth'].flatMap((name) => [`## ${name}`, 'A short section.']);
        writeFixture(OUTLINE, ['# Outline tail', '', '## First', filler, ...tail].join('\n\n'));
        await page.goto(routes.doc(OUTLINE));
        const active = page.locator('[data-testid=toc-entry][data-active="true"]');
        const entry = (name) => page.locator('[data-testid=toc-entry]', {hasText: name});
        const scrollTo = (top) => page.evaluate((y) => window.scrollTo({top: y, behavior: 'instant'}), top);

        // act & assert
        await showOutline(page);
        await entry('Fifth').click();
        await expect(page).toHaveURL(/#fifth$/);
        await expect(active).toHaveText('Fifth');

        await page.reload();
        await showOutline(page);
        await expect(active).toHaveText('Fifth');

        await page.mouse.wheel(0, -100000);
        await expect(active).toHaveText('First');

        const bottom = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
        const seen = [];
        for (let top = bottom - 800; top <= bottom; top += 20) {
            await scrollTo(top);
            await page.waitForTimeout(50);
            seen.push(await active.textContent());
        }
        expect([...new Set(seen)]).toEqual(['First', 'Fourth', 'Fifth', 'Sixth']);

        removeFixture(OUTLINE);
    });

    test('? opens the shortcuts, grouped by where they work', async ({page}) => {
        // act
        await page.keyboard.press('?');

        // assert
        await expect(page.getByTestId('shortcuts')).toBeVisible();
        await expect(page.getByTestId('shortcuts-group')).toHaveText([
            /^General/, /^Note/, /^Search/, /^Editor/,
        ]);
    });

    test('the space menu opens the shortcuts', async ({page}) => {
        // arrange
        await openSpaceMenu(page);

        // act
        await page.getByTestId('space-menu-shortcuts').click();

        // assert
        await expect(page.getByTestId('shortcuts')).toBeVisible();
    });

    test('E on a note opens the editor', async ({page}) => {
        // arrange
        await page.goto(routes.doc(DOC.path));
        await expect(page.getByTestId('doc')).toBeVisible();

        // act
        await page.keyboard.press('e');

        // assert
        await expect(page).toHaveURL(new RegExp(`${routes.edit(DOC.path)}$`));
        await expect(page.getByTestId('editor-source')).toBeVisible();
    });

    test('the bar color and the home screen icon follow the theme picker', async ({page}) => {
        // arrange
        await page.goto(routes.doc(DOC.path));
        const icons = () => page.locator('link[rel="apple-touch-icon"]').evaluateAll(
            (links) => links.map((el) => [el.getAttribute('href').replace(/^.*\/icons\/|\?.*$/g, ''), el.media]));
        const bars = () => page.locator('meta[name="theme-color"]').evaluateAll(
            (metas) => metas.map((el) => [el.content, el.media]));
        await expect.poll(icons).toEqual([
            ['apple-touch-icon.png', '(prefers-color-scheme: light)'],
            ['apple-touch-icon-dark.png', '(prefers-color-scheme: dark)'],
        ]);

        // act
        await openSpaceMenu(page);
        await chooseTheme(page, 'dark');

        // assert
        await expect.poll(icons).toEqual([['apple-touch-icon-dark.png', '']]);
        await expect.poll(bars).toEqual([[darkTheme.palette.bg, '']]);

        await chooseTheme(page, 'light');
        await expect.poll(icons).toEqual([['apple-touch-icon.png', '']]);
        await expect.poll(bars).toEqual([[lightTheme.palette.bg, '']]);
    });

    test('the code colours follow the theme picker, not the system', async ({page}) => {
        await page.goto(routes.doc(DOC.path));
        const contrast = () => page.locator('[data-testid=doc] .chroma .p').first().evaluate((el) => {
            const sum = (color) => color.match(/\d+/g).slice(0, 3).reduce((a, b) => a + Number(b), 0);
            return sum(getComputedStyle(el).color) - sum(getComputedStyle(document.body).backgroundColor);
        });

        expect(await contrast()).toBeLessThan(0);

        await openSpaceMenu(page);
        await chooseTheme(page, 'light');
        await chooseTheme(page, 'dark');

        await expect.poll(contrast).toBeGreaterThan(0);
    });

    test('bold is heavier in the dark theme than in the light one', async ({page}) => {
        // arrange
        writeFixture(EMPHASIS, '# Emphasis\n\nPlain **bold** text.\n');
        await page.goto(routes.doc(EMPHASIS));
        const weight = () => page.getByTestId('doc').locator('p strong').evaluate(
            (el) => Number(getComputedStyle(el).fontWeight));
        await openSpaceMenu(page);
        await chooseTheme(page, 'light');
        const light = await weight();

        // act
        await chooseTheme(page, 'dark');

        // assert
        await expect.poll(weight).toBeGreaterThan(light);

        removeFixture(EMPHASIS);
    });

    test('emphasis is brighter than the text around it in the dark', async ({page}) => {
        // arrange
        writeFixture(EMPHASIS, '# Emphasis\n\nPlain **bold** and *italic*.\n\n> Quoted **bold**.\n');
        await page.goto(routes.doc(EMPHASIS));
        await openSpaceMenu(page);
        await chooseTheme(page, 'dark');
        const doc = page.getByTestId('doc');
        const brightness = (selector) => doc.locator(selector).first().evaluate((el) =>
            getComputedStyle(el).color.match(/\d+/g).slice(0, 3).reduce((a, b) => a + Number(b), 0));

        // act
        const plain = await brightness('p');
        const emphasis = [await brightness('p strong'), await brightness('p em'), await brightness('h1')];
        const quote = [await brightness('blockquote p'), await brightness('blockquote strong')];

        // assert
        expect(emphasis.map((value) => value - plain > 30)).toEqual([true, true, true]);
        expect(quote[1] - quote[0]).toBeGreaterThan(30);

        removeFixture(EMPHASIS);
    });

    test('a diagram label sits in the middle of its box', async ({page}) => {
        // arrange
        writeFixture(DIAGRAM, '# Diagram\n\n```mermaid\nflowchart TD\n    A[Запрос] --> B[Сервер]\n```\n');
        await page.goto(routes.doc(DIAGRAM));
        const node = page.getByTestId('doc').locator('.md-diagram[data-state="done"] svg .node').first();

        // act
        const offset = await node.evaluate((el) => {
            const box = el.querySelector('.label-container').getBoundingClientRect();
            const label = el.querySelector('.nodeLabel').getBoundingClientRect();
            return Math.abs((box.top + box.bottom) / 2 - (label.top + label.bottom) / 2);
        });

        // assert
        expect(offset).toBeLessThan(2);

        removeFixture(DIAGRAM);
    });

    test('the sidebar hides on demand and stays hidden', async ({page}) => {
        // arrange
        const burger = page.getByTestId('topbar-burger');
        const sidebar = page.getByTestId('sidebar');
        const left = () => page.getByTestId('doc').evaluate((el) => el.getBoundingClientRect().left);
        await page.goto(routes.doc(DOC.path));
        await expect(sidebar).toBeVisible();
        await expect(burger).toHaveCount(0);
        const beside = await left();

        // act & assert
        await sidebar.hover();
        await page.getByTestId('sidebar-hide').click();
        await expect(sidebar).toHaveCount(0);
        await expect(burger).toBeVisible();
        expect(await left()).toBeLessThan(beside);
        await shot(page, 'reading-sidebar-hidden');

        await page.reload();
        await expect(sidebar).toHaveCount(0);
        await burger.click();
        await expect(sidebar).toBeVisible();
        await expect(burger).toHaveCount(0);

        await pressShortcut(page, `${await modifier(page)}+b`);
        await expect(sidebar).toHaveCount(0);
        await pressShortcut(page, `${await modifier(page)}+b`);
        await expect(sidebar).toBeVisible();
    });

    test('the sidebar is a flush 240px panel on its own ground', async ({page}) => {
        // arrange
        const sidebar = page.getByTestId('sidebar');

        // act
        await page.goto(routes.doc(DOC.path));

        // assert
        await expect(sidebar).toBeVisible();
        expect(Math.round((await sidebar.boundingBox()).width)).toBe(240);
        await expect(page.locator('.mantine-AppShell-navbar')).toHaveCSS('background-color', rgb(lightTheme.palette.sidebar));
        await expect(page.getByTestId('note')).toHaveCSS('border-top-width', '0px');
    });

    test('a note is read at one width the reader picks, and the choice is kept', async ({page}) => {
        // arrange
        const doc = page.getByTestId('doc');
        const width = async (locator) => Math.round((await locator.boundingBox()).width);
        const pick = async (label) => {
            await page.getByTestId('note-menu').click();
            await page.getByTestId('page-width').getByText(label, {exact: true}).click();
            await page.keyboard.press('Escape');
        };
        await page.goto(routes.doc(docs.linked.path));
        await expect(doc.locator('table').first()).toBeVisible();

        // act & assert
        expect(await width(doc)).toBe(720);
        expect(await width(doc.locator('table').first())).toBeLessThanOrEqual(720);

        await pick('Wide');
        await expect.poll(() => width(doc)).toBe(960);

        await pick('Full');
        const room = page.viewportSize().width - 240;
        await expect.poll(() => width(doc)).toBe(room - 2 * 96);

        await page.reload();
        await expect.poll(() => width(doc)).toBe(room - 2 * 96);
        await pick('Normal');
        await expect.poll(() => width(doc)).toBe(720);
    });

    test('the topbar names the note by its title and a folder by its name', async ({page}) => {
        // arrange
        const crumbs = page.getByTestId('topbar-crumbs').getByTestId('crumb');

        // act & assert
        await page.goto(routes.doc(docs.deep.path));
        await expect(crumbs).toContainText(docs.deep.crumbs);
        await expect(crumbs.last()).toHaveText(docs.deep.title);

        await page.goto(routes.dir(DOC.folder));
        await expect(crumbs.last()).toHaveText(DOC.folder);
    });

    test('the sidebar shortcut works from the reader and from the source editor', async ({page}) => {
        // arrange
        const sidebar = page.getByTestId('sidebar');
        const toggle = async () => pressShortcut(page, `${await modifier(page)}+b`);
        await page.goto(routes.edit(DOC.path));
        await page.locator('[data-testid=editor-source] .cm-content').click();

        // act & assert
        await toggle();
        await expect(sidebar).toHaveCount(0);
        await toggle();
        await expect(sidebar).toBeVisible();
    });

    test('a note that does not exist offers to create it, and Enter does', async ({page}) => {
        // arrange
        await page.goto(routes.doc(docs.missing));

        // act & assert
        await expect(page.getByTestId('doc-missing-title')).toHaveText(docs.missing.split('/').pop().replace(/\.md$/, ''));
        await expect(page.getByTestId('doc-create')).toBeVisible();
        await expect(page.getByTestId('doc-missing-folder')).toHaveAttribute('href', new RegExp(`/doc/${DOC.folder}/$`));
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(MAIN.url.edit(docs.missing));
    });

    test('a missing note kept while the next note loads still offers to create itself', async ({page}) => {
        // arrange
        let release;
        const waiting = new Promise((resolve) => {
            release = resolve;
        });
        await page.goto(routes.doc(docs.missing));
        await expect(page.getByTestId('doc-missing-title')).toBeVisible();
        const twisty = page.locator(`[data-testid=tree-row][data-path="${DOC.folder}"] [data-testid=tree-twisty]`);
        if (await twisty.getAttribute('data-open') === 'false') {
            await twisty.click();
        }
        await page.route(`**/api/page/${DOC.path}`, async (route) => {
            await waiting;
            await route.continue();
        });
        try {
            // act
            await page.locator(`[data-testid=tree-row][data-path="${DOC.path}"] [data-testid=tree-link]`).click();

            // assert
            await expect(page).toHaveURL(MAIN.url.doc(DOC.path));
            await expect(page.getByTestId('doc-create')).toHaveAttribute('href', new RegExp(`/edit/${docs.missing}$`));
        } finally {
            release();
        }
        await expect(page.getByTestId('doc-missing')).toHaveCount(0);
    });

    test('a note reads the way Notion shows a page', async ({page}) => {
        // arrange
        const source = 'fmt.Println("hi")';
        writeFixture(LOOK, [
            '# Look', '', 'Text with `code` and <mark>marked</mark> words.', '',
            '> [!NOTE]', '> A note.', '', '- [ ] open task', '', '```go', source, '```', '',
        ].join('\n'));
        const doc = page.getByTestId('doc');
        await page.goto(routes.doc(LOOK));

        // act & assert
        await expect(doc.locator('h1')).toHaveCSS('font-size', '40px');
        await expect(doc.locator('.alert-note')).toHaveCSS('background-color', rgb(lightTheme.blocks.blue.bg));
        await expect(doc.locator('p code')).toHaveCSS('color', rgb(lightTheme.palette.inlineCode));
        await expect(doc.locator('mark')).toHaveCSS('background-color', rgb(lightTheme.blocks.yellow.bg));

        await openSpaceMenu(page);
        await chooseTheme(page, 'dark');
        await page.keyboard.press('Escape');
        await expect(doc.locator('mark')).toHaveCSS('background-color', rgb(darkTheme.blocks.yellow.bg));

        const copy = doc.getByTestId('code-copy');
        await copy.click();
        await expect(copy).toHaveAttribute('data-done', 'true');
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${source}\n`);

        removeFixture(LOOK);
    });

    test('a task box on the page takes no click and sends nothing', async ({page}) => {
        // arrange
        writeFixture(LOOK, '# Tasks\n\n- [ ] open task\n');
        await page.goto(routes.doc(LOOK));
        const box = page.getByTestId('doc').locator('input[type=checkbox]');
        await expect(box).toBeVisible();
        const sent = [];
        page.on('request', (req) => {
            if (req.method() !== 'GET') {
                sent.push(req.url());
            }
        });

        // act
        await box.click({force: true});

        // assert
        await expect(box).not.toBeChecked();
        await expect(box).toBeDisabled();
        expect(sent).toEqual([]);

        removeFixture(LOOK);
    });
});
