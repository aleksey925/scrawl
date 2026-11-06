const {expect, test} = require('../support/test');

const fs = require('fs');

const {
    MAIN, atHome, fixtureFile, removeFixture, routes, save, setSource, shot, signIn, writeFixture,
} = require('../support/helpers');
const text = require('../support/text');

const FOLDER = 'e2e-fm';
const OTHER = 'e2e-fm-other';
const PAGE = `${FOLDER}/testovaya-stranitsa.md`;
const RENAMED = `${FOLDER}/pereimenovannaya.md`;
const DRAGGED = ['e2e-drag-one.md', 'e2e-drag-two.md'];
const ROOT_PAGE = 'e2e-root-page.md';
const TYPED_FILE = 'E2eTyped.java';
const TYPED_PICTURE = 'e2e-typed.png';
const DATED_PAGE = 'e2e-meeting-2024.10.21.md';
const BLANK_FOLDER = 'e2e-fm-blank';
const BLANK_PAGE = 'e2e-blank-page.md';
const FULL_FOLDER = 'e2e-fm-full';
const JUNK_FOLDER = 'e2e-fm-junk';
const LISTED_FOLDER = 'e2e-fm-listed';
const MOVED = 'e2e-fm-moved.md';
const UNDONE = 'e2e-fm-undone.md';
const LINKED = 'e2e-fm-linked.md';
const INNER = `${FOLDER}/inner`;
const NEST = 'e2e-fm-nest';
const UNDELETED = 'e2e-fm-undeleted';
const NESTED_NOTE = `${NEST}/a/note.md`;

function shownPlaces(page, prefix) {
    return page.locator('[data-testid=move-place]')
        .evaluateAll((rows, start) => rows.map((row) => row.dataset.path).filter((path) => path.startsWith(start)), prefix);
}

test.describe.serial('file management', () => {
    test.beforeEach(async ({page}) => {
        await signIn(page);
    });

    test.afterAll(() => {
        for (const folder of [FOLDER, OTHER, BLANK_FOLDER, FULL_FOLDER, JUNK_FOLDER, LISTED_FOLDER, NEST, UNDELETED]) {
            fs.rmSync(fixtureFile(folder), {recursive: true, force: true});
        }
        for (const name of [...DRAGGED, ROOT_PAGE, BLANK_PAGE, TYPED_FILE, TYPED_PICTURE, DATED_PAGE]) {
            fs.rmSync(fixtureFile(name), {force: true});
        }
    });

    test('creates a folder where the tree stands, with no dialog in the way', async ({page}) => {
        await page.getByTestId('sidebar-new').click();
        await page.getByTestId('sidebar-new-folder').click();
        await expect(page.getByTestId('tree-draft')).toHaveAttribute('data-entry', 'dir');
        await expect(page.locator('[data-testid=modal][data-variant="create"]')).toHaveCount(0);
        await expect(page.getByTestId('tree-draft-input')).toBeFocused();
        await shot(page, 'files-new-folder-draft');

        await page.getByTestId('tree-draft-input').fill(FOLDER);
        await page.getByTestId('tree-draft-input').press('Enter');

        await expect(page.locator('[data-testid=toast][data-kind="ok"]')).toContainText(text.toast.folderCreated);
        expect(fs.statSync(fixtureFile(FOLDER)).isDirectory()).toBe(true);
        await expect(page.locator(`[data-testid=tree-row][data-path="${FOLDER}"]`)).toHaveCount(1);
        await expect(page.getByTestId('tree-draft')).toHaveCount(0);

        await expect(page).toHaveURL(MAIN.url.dir(FOLDER));
        await expect(page.locator('[data-testid=tree-row][data-current="true"]')).toHaveAttribute('data-path', FOLDER);
        await expect(page.getByTestId('dir-empty-title')).toHaveText(text.dir.empty);
        await page.getByTestId('sidebar-new').click();
        await expect(page.getByTestId('sidebar-new-where')).toContainText(FOLDER);
        await page.keyboard.press('Escape');
        await shot(page, 'files-folder-created');
    });

    test('creates a file in the root from the sidebar', async ({page}) => {
        // arrange
        await page.getByTestId('sidebar-new').click();
        await page.getByTestId('sidebar-new-page').click();

        // act
        await page.getByTestId('tree-draft-input').fill(ROOT_PAGE.replace('.md', ''));
        await page.getByTestId('tree-draft-input').press('Enter');

        // assert
        await expect(page).toHaveURL(MAIN.url.edit(ROOT_PAGE));
        expect(fs.existsSync(fixtureFile(ROOT_PAGE))).toBe(true);
        await expect(page.locator(`[data-testid=tree-row][data-path="${ROOT_PAGE}"]`)).toHaveCount(1);
        await shot(page, 'files-root-page');
    });

    test('a name with an extension of its own makes that file, named as typed', async ({page}) => {
        // arrange
        await page.getByTestId('sidebar-new').click();
        await page.getByTestId('sidebar-new-page').click();

        // act
        await page.getByTestId('tree-draft-input').fill(TYPED_FILE);
        await page.getByTestId('tree-draft-input').press('Enter');

        // assert
        await expect(page).toHaveURL(MAIN.url.edit(TYPED_FILE));
        await expect(page.getByTestId('editor')).toHaveAttribute('data-kind', 'text');
        expect(fs.existsSync(fixtureFile(TYPED_FILE))).toBe(true);
        expect(fs.existsSync(fixtureFile(`${TYPED_FILE}.md`))).toBe(false);
    });

    test('a name the editor cannot open makes that file and opens its page', async ({page}) => {
        // arrange
        await page.getByTestId('sidebar-new').click();
        await page.getByTestId('sidebar-new-page').click();

        // act
        await page.getByTestId('tree-draft-input').fill(TYPED_PICTURE);
        await page.getByTestId('tree-draft-input').press('Enter');

        // assert
        await expect(page).toHaveURL(MAIN.url.doc(TYPED_PICTURE));
        expect(fs.existsSync(fixtureFile(TYPED_PICTURE))).toBe(true);
    });

    test('a title with a date in it is still a note', async ({page}) => {
        // arrange
        await page.getByTestId('sidebar-new').click();
        await page.getByTestId('sidebar-new-page').click();

        // act
        await page.getByTestId('tree-draft-input').fill('E2E Meeting 2024.10.21');
        await page.getByTestId('tree-draft-input').press('Enter');

        // assert
        await expect(page).toHaveURL(MAIN.url.edit(DATED_PAGE));
        expect(fs.existsSync(fixtureFile(DATED_PAGE))).toBe(true);
    });

    test('a note renamed with an extension of its own becomes that file, and with a bare title stays a note', async ({page}) => {
        // arrange
        const note = `${FOLDER}/to-text.txt.md`;
        writeFixture(note, 'text\n');
        await page.goto(MAIN.url.dir(FOLDER));
        const rename = async (from, to) => {
            await page.locator(`[data-testid=tree-row][data-path="${from}"] [data-testid=tree-row-menu]`).click();
            await page.getByTestId('tree-row-menu-rename').click();
            await page.getByTestId('tree-rename-input').fill(to);
            await page.getByTestId('tree-rename-input').press('Enter');
            await expect(page.getByTestId('tree-rename')).toHaveCount(0);
        };

        // act
        await rename(note, 'bare title');
        await rename(`${FOLDER}/bare title.md`, 'to-text.txt');

        // assert
        await expect.poll(() => fs.existsSync(fixtureFile(`${FOLDER}/to-text.txt`))).toBe(true);
        expect([note, `${FOLDER}/bare title.md`, `${FOLDER}/to-text.txt.md`].filter((p) => fs.existsSync(fixtureFile(p))))
            .toEqual([]);
    });

    test('creates a page inside the folder it was started from', async ({page}) => {
        await page.locator(`[data-testid=tree-row][data-path="${FOLDER}"] [data-testid=tree-row-menu]`).click();
        await page.getByTestId('tree-row-menu-new-page').click();

        await expect(page.getByTestId('tree-draft')).toHaveAttribute('data-entry', 'file');
        await shot(page, 'files-new-page-draft');
        await page.getByTestId('tree-draft-input').fill('Тестовая страница');
        await page.getByTestId('tree-draft-input').press('Enter');

        await expect(page).toHaveURL(MAIN.url.edit(PAGE));
        expect(fs.existsSync(fixtureFile(PAGE))).toBe(true);

        await setSource(page, '# Тестовая страница\n');
        await save(page);

        await page.goto(routes.doc(PAGE));
        await expect(page.locator('[data-testid=tree-row][data-current="true"]')).toHaveAttribute('data-path', PAGE);
        await shot(page, 'files-page-created');
    });

    test('refuses to create a page that already exists and keeps the name typed', async ({page}) => {
        await page.locator(`[data-testid=tree-row][data-path="${FOLDER}"] [data-testid=tree-row-menu]`).click();
        await page.getByTestId('tree-row-menu-new-page').click();
        await page.getByTestId('tree-draft-input').fill('Тестовая страница');
        await page.getByTestId('tree-draft-input').press('Enter');

        await expect(page.locator('[data-testid=toast][data-kind="error"]')).toContainText(text.pageExists);
        await expect(page.getByTestId('tree-draft-input')).toHaveValue('Тестовая страница');
        await shot(page, 'files-duplicate-page');
        await page.getByTestId('tree-draft-input').press('Escape');
        await expect(page.getByTestId('tree-draft')).toHaveCount(0);
    });

    test('renames a page in place in the tree, asking only its name', async ({page}) => {
        // arrange
        await page.goto(routes.doc(PAGE));
        await page.locator(`[data-testid=tree-row][data-path="${PAGE}"] [data-testid=tree-row-menu]`).click();
        await expect(page.getByTestId('tree-row-menu-dropdown')).toBeVisible();
        await shot(page, 'files-row-menu');
        await page.getByTestId('tree-row-menu-rename').click();
        const input = page.getByTestId('tree-rename-input');
        await expect(input).toHaveValue('testovaya-stranitsa');
        await expect(input).toBeFocused();
        await shot(page, 'files-rename-in-place');

        // act
        await input.fill('pereimenovannaya');
        await input.press('Enter');

        // assert
        await expect(page.locator('[data-testid=toast][data-kind="ok"]')).toContainText(text.toast.renamed);
        await expect(page).toHaveURL(MAIN.url.doc(RENAMED));
        expect(fs.existsSync(fixtureFile(PAGE))).toBe(false);
        expect(fs.existsSync(fixtureFile(RENAMED))).toBe(true);
        await expect(page.locator(`[data-testid=tree-row][data-path="${RENAMED}"]`)).toHaveCount(1);
        await expect(page.locator('.mantine-Modal-title')).toHaveCount(0);
        await shot(page, 'files-renamed');
    });

    test('a rename with a slash in the name moves nothing', async ({page}) => {
        // arrange
        await page.goto(routes.doc(RENAMED));
        await page.locator(`[data-testid=tree-row][data-path="${RENAMED}"] [data-testid=tree-row-menu]`).click();
        await page.getByTestId('tree-row-menu-rename').click();

        // act
        await page.getByTestId('tree-rename-input').fill(`${OTHER}/pereimenovannaya`);
        await page.getByTestId('tree-rename-input').press('Enter');

        // assert
        await expect(page.locator('[data-testid=toast][data-kind="error"]')).toContainText(text.renameSlash);
        await expect(page.getByTestId('tree-rename-input')).toHaveValue(`${OTHER}/pereimenovannaya`);
        expect(fs.existsSync(fixtureFile(RENAMED))).toBe(true);
    });

    test('renames a note from its own menu in a dialog that asks only the name', async ({page}) => {
        // arrange
        const note = `${FOLDER}/from-menu.md`;
        writeFixture(note, '# From the menu\n');
        await page.goto(MAIN.url.doc(note));
        await page.getByTestId('note-menu').click();
        await page.getByTestId('note-menu-rename').click();
        await expect(page.getByTestId('rename-name')).toHaveValue('from-menu');
        await shot(page, 'files-rename-dialog');

        // act
        await page.getByTestId('rename-name').fill('menu-renamed');
        await page.getByTestId('rename-submit').click();

        // assert
        await expect(page).toHaveURL(MAIN.url.doc(`${FOLDER}/menu-renamed.md`));
        await expect(page.getByTestId('rename')).toHaveCount(0);
        expect([note, `${FOLDER}/menu-renamed.md`].map((p) => fs.existsSync(fixtureFile(p)))).toEqual([false, true]);
    });

    test('moves a page into another folder by dragging its row', async ({page}) => {
        // arrange
        fs.mkdirSync(fixtureFile(OTHER), {recursive: true});
        fs.writeFileSync(fixtureFile(`${FOLDER}/${DRAGGED[0]}`), '# Dragged\n', 'utf8');
        await page.goto(routes.dir(FOLDER));
        const row = page.locator(`[data-testid=tree-row][data-path="${FOLDER}/${DRAGGED[0]}"]`);
        await expect(row).toHaveCount(1);

        // act
        await row.dragTo(page.locator(`[data-testid=tree-row][data-path="${OTHER}"]`));

        // assert
        await expect(page.locator('[data-testid=toast][data-kind="ok"]')).toContainText(text.toast.moved);
        await expect.poll(() => fs.existsSync(fixtureFile(`${OTHER}/${DRAGGED[0]}`))).toBe(true);
        expect(fs.existsSync(fixtureFile(`${FOLDER}/${DRAGGED[0]}`))).toBe(false);
        await expect(page.locator(`[data-testid=tree-row][data-path="${OTHER}/${DRAGGED[0]}"]`)).toHaveCount(1);
        await shot(page, 'files-dragged');
    });

    test('moves every picked row when one of them is dragged', async ({page}) => {
        // arrange
        for (const name of DRAGGED) {
            fs.writeFileSync(fixtureFile(`${OTHER}/${name}`), '# Dragged\n', 'utf8');
        }
        await page.goto(routes.dir(OTHER));
        const rows = DRAGGED.map((name) => `[data-testid=tree-row][data-path="${OTHER}/${name}"]`);
        await expect(page.locator(rows[1])).toHaveCount(1);

        // act
        await page.locator(`${rows[0]} [data-testid=tree-link]`).click();
        await page.locator(`${rows[1]} [data-testid=tree-link]`).click({modifiers: ['Shift']});
        await expect(page.locator('[data-testid=tree-row][data-selected="true"]')).toHaveCount(2);
        await shot(page, 'files-multi-selected');
        await page.locator(rows[1]).dragTo(page.locator(`[data-testid=tree-row][data-path="${FOLDER}"]`));

        // assert
        await expect(page.locator('[data-testid=toast][data-kind="ok"]')).toContainText(text.toast.movedMany);
        for (const name of DRAGGED) {
            await expect.poll(() => fs.existsSync(fixtureFile(`${FOLDER}/${name}`))).toBe(true);
            expect(fs.existsSync(fixtureFile(`${OTHER}/${name}`))).toBe(false);
        }
    });

    test('moves a note into the folder picked in Move to, showing where it lands', async ({page}) => {
        // arrange
        writeFixture(`${FOLDER}/${MOVED}`, '# Moved\n');
        await page.goto(MAIN.url.doc(`${FOLDER}/${MOVED}`));
        await page.getByTestId('note-menu').click();
        await page.getByTestId('note-menu-move').click();
        await expect(page.locator(`[data-testid=move-place][data-path="${FOLDER}"]`)).toHaveAttribute('data-current', 'true');
        await shot(page, 'files-move-dialog');

        // act
        await page.getByTestId('move-input').fill(OTHER);
        await expect(page.getByTestId('move-preview')).toHaveText(`Moves to ${OTHER}/${MOVED}`);
        await shot(page, 'files-move-search');
        await page.getByTestId('move-input').press('Enter');

        // assert
        await expect(page.locator('[data-testid=toast][data-kind="ok"]'))
            .toContainText(`Moved "${MOVED.replace(/\.md$/, '')}" to "${OTHER}"`);
        await expect(page).toHaveURL(MAIN.url.doc(`${OTHER}/${MOVED}`));
        await expect(page.getByTestId('move-dialog')).toHaveCount(0);
        expect([`${FOLDER}/${MOVED}`, `${OTHER}/${MOVED}`].map((p) => fs.existsSync(fixtureFile(p)))).toEqual([false, true]);
    });

    test('Undo in the toast after a move puts the note back and follows it', async ({page}) => {
        // arrange
        writeFixture(`${FOLDER}/${UNDONE}`, '# Undone\n');
        await page.goto(MAIN.url.doc(`${FOLDER}/${UNDONE}`));
        await page.getByTestId('note-menu').click();
        await page.getByTestId('note-menu-move').click();
        await page.getByTestId('move-input').fill(OTHER);
        await page.getByTestId('move-input').press('Enter');
        await expect(page).toHaveURL(MAIN.url.doc(`${OTHER}/${UNDONE}`));
        await shot(page, 'files-move-undo');

        // act
        await page.getByTestId('toast-action').click();

        // assert
        await expect(page.locator('[data-testid=toast][data-kind="ok"]')
            .filter({hasText: `Moved "${UNDONE.replace(/\.md$/, '')}" back to "${FOLDER}"`})).toHaveCount(1);
        await expect(page).toHaveURL(MAIN.url.doc(`${FOLDER}/${UNDONE}`));
        expect([`${FOLDER}/${UNDONE}`, `${OTHER}/${UNDONE}`].map((p) => fs.existsSync(fixtureFile(p)))).toEqual([true, false]);
    });

    test('the folder named in the toast of a move opens that folder', async ({page}) => {
        // arrange
        writeFixture(`${FOLDER}/${LINKED}`, '# Linked\n');
        await page.goto(MAIN.url.dir(FOLDER));
        await page.locator(`[data-testid=tree-row][data-path="${FOLDER}/${LINKED}"] [data-testid=tree-row-menu]`).click();
        await page.getByTestId('tree-row-menu-move').click();
        await page.locator(`[data-testid=move-place][data-path="${OTHER}"]`).click();

        // act
        await page.getByTestId('toast-link').click();

        // assert
        await expect(page).toHaveURL(MAIN.url.dir(OTHER));
        await expect(page.locator(`[data-testid=dir-row][data-path="${OTHER}/${LINKED}"]`)).toHaveCount(1);
    });

    test('Move to says a folder already holds that name and moves nothing there', async ({page}) => {
        // arrange
        writeFixture(`${FOLDER}/${MOVED}`, '# Moved again\n');
        await page.goto(MAIN.url.dir(FOLDER));
        await page.locator(`[data-testid=tree-row][data-path="${FOLDER}/${MOVED}"] [data-testid=tree-row-menu]`).click();
        await page.getByTestId('tree-row-menu-move').click();

        // act
        await page.locator(`[data-testid=move-place][data-path="${OTHER}"]`).click();

        // assert
        await expect(page.getByTestId('move-taken')).toHaveText(`${OTHER} already holds ${MOVED}`);
        await expect(page.getByTestId('move-dialog')).toBeVisible();
        expect(fs.readFileSync(fixtureFile(`${FOLDER}/${MOVED}`), 'utf8')).toBe('# Moved again\n');
    });

    test('Move to leaves out the folder itself and every folder inside it', async ({page}) => {
        // arrange
        fs.mkdirSync(fixtureFile(INNER), {recursive: true});
        await page.goto(MAIN.url.dir(OTHER));

        // act
        await page.locator(`[data-testid=tree-row][data-path="${FOLDER}"] [data-testid=tree-row-menu]`).click();
        await page.getByTestId('tree-row-menu-move').click();

        // assert
        await expect(page.locator('[data-testid=move-place][data-path=""]')).toHaveAttribute('data-current', 'true');
        await expect(page.locator(`[data-testid=move-place][data-path="${OTHER}"]`)).toHaveCount(1);
        await expect(page.locator(`[data-testid=move-place][data-path="${FOLDER}"], [data-testid=move-place][data-path="${INNER}"]`))
            .toHaveCount(0);
    });

    test('Move to shows every folder folded, the one the entry is in too', async ({page}) => {
        // arrange
        writeFixture(NESTED_NOTE, '# Nested\n');
        for (const folder of [`${NEST}/a/b`, `${NEST}/c/d`]) {
            fs.mkdirSync(fixtureFile(folder), {recursive: true});
        }
        await page.goto(MAIN.url.doc(NESTED_NOTE));

        // act
        await page.getByTestId('note-menu').click();
        await page.getByTestId('note-menu-move').click();

        // assert
        await expect.poll(() => shownPlaces(page, NEST)).toEqual([NEST]);
        await shot(page, 'files-move-folded');
    });

    test('a chevron in Move to unfolds a folder and moves nothing', async ({page}) => {
        // arrange
        await page.goto(MAIN.url.doc(NESTED_NOTE));
        await page.getByTestId('note-menu').click();
        await page.getByTestId('note-menu-move').click();

        // act
        await page.locator(`[data-testid=move-place][data-path="${NEST}"] [data-testid=move-twisty]`).click();

        // assert
        await expect.poll(() => shownPlaces(page, NEST))
            .toEqual([NEST, `${NEST}/a`, `${NEST}/c`]);
        await expect(page.getByTestId('move-dialog')).toBeVisible();
        expect(fs.existsSync(fixtureFile(NESTED_NOTE))).toBe(true);
    });

    test('the right and left arrows unfold and fold the picked folder in Move to', async ({page}) => {
        // arrange
        await page.goto(MAIN.url.doc(NESTED_NOTE));
        await page.getByTestId('note-menu').click();
        await page.getByTestId('note-menu-move').click();
        await page.locator(`[data-testid=move-place][data-path="${NEST}"]`).hover();
        const input = page.getByTestId('move-input');

        // act & assert
        await input.press('ArrowRight');
        await expect(page.locator(`[data-testid=move-place][data-path="${NEST}/a"]`)).toHaveCount(1);
        await input.press('ArrowLeft');
        await expect(page.locator(`[data-testid=move-place][data-path="${NEST}/a"]`)).toHaveCount(0);
    });

    test('Move to opens in place of the menu it was picked from, and Escape closes it', async ({page}) => {
        // arrange
        await page.goto(MAIN.url.doc(NESTED_NOTE));
        await page.getByTestId('note-menu').click();
        const menu = await page.getByTestId('note-menu-dropdown').boundingBox();
        const edges = (box) => ({right: Math.round(box.x + box.width), top: Math.round(box.y)});

        // act & assert
        await page.getByTestId('note-menu-move').click();
        await expect.poll(async () => edges(await page.getByTestId('move-dialog').boundingBox())).toEqual(edges(menu));
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('move-dialog')).toHaveCount(0);
    });

    test('moves a folder with Move to and follows it when it is on screen', async ({page}) => {
        // arrange
        await page.goto(MAIN.url.dir(INNER));
        await page.getByTestId('folder-menu').click();
        await page.getByTestId('folder-menu-move').click();

        // act
        await page.getByTestId('move-input').fill(OTHER);
        await page.locator(`[data-testid=move-place][data-path="${OTHER}"]`).click();

        // assert
        await expect(page).toHaveURL(MAIN.url.dir(`${OTHER}/inner`));
        await expect.poll(() => fs.existsSync(fixtureFile(`${OTHER}/inner`))).toBe(true);
        expect(fs.existsSync(fixtureFile(INNER))).toBe(false);
    });

    test('deletes a page at once, names it in the toast and drops it from the tree', async ({page}) => {
        await page.goto(routes.doc(RENAMED));
        await page.locator(`[data-testid=tree-row][data-path="${RENAMED}"] [data-testid=tree-row-menu]`).click();
        await page.getByTestId('tree-row-menu-delete').click();

        await expect(page.locator('[data-testid=toast][data-kind="ok"]'))
            .toContainText(`Deleted "${RENAMED.split('/').pop().replace(/\.md$/, '')}"`);
        await expect(page.locator('.mantine-Modal-title')).toHaveCount(0);
        await expect(page).toHaveURL(atHome());
        await expect.poll(() => fs.existsSync(fixtureFile(RENAMED))).toBe(false);
        await expect(page.locator(`[data-testid=tree-row][data-path="${RENAMED}"]`)).toHaveCount(0);
        await shot(page, 'files-deleted');
    });

    test('a folder on screen drops a page deleted from the tree', async ({page}) => {
        // arrange
        const file = `${LISTED_FOLDER}/listed.md`;
        writeFixture(file, '# Listed\n');
        await page.goto(MAIN.url.dir(LISTED_FOLDER));
        const listed = page.locator(`[data-testid=dir-row][data-path="${file}"]`);
        await expect(listed).toBeVisible();

        // act
        await page.locator(`[data-testid=tree-row][data-path="${file}"] [data-testid=tree-row-menu]`).click();
        await page.getByTestId('tree-row-menu-delete').click();

        // assert
        await expect(listed).toHaveCount(0);
        await expect(page).toHaveURL(MAIN.url.dir(LISTED_FOLDER));
    });

    test('an empty note says it is empty and leads into the editor', async ({page}) => {
        // arrange
        fs.writeFileSync(fixtureFile(BLANK_PAGE), '', 'utf8');

        // act
        await page.goto(routes.doc(BLANK_PAGE));

        // assert
        await expect(page.getByTestId('doc-empty-title')).toHaveText(text.doc.empty);
        await expect(page.getByTestId('doc-empty')).toContainText(BLANK_PAGE);
        await shot(page, 'files-empty-note');
        await page.getByTestId('doc-empty-edit').click();
        await expect(page).toHaveURL(new RegExp(`${routes.edit(BLANK_PAGE)}$`));
        await expect(page.locator('[data-testid=editor-source] .cm-placeholder')).toBeVisible();
        await expect(page.getByTestId('editor-lines')).toHaveText('1 line');
    });

    test('an empty folder says so on its page and in the tree, and a file starts from there', async ({page}) => {
        // arrange
        fs.mkdirSync(fixtureFile(BLANK_FOLDER), {recursive: true});

        // act
        await page.goto(routes.dir(BLANK_FOLDER));

        // assert
        const row = page.locator(`[data-testid=tree-row][data-path="${BLANK_FOLDER}"]`);
        await expect(row.locator('xpath=following-sibling::*[@data-testid="tree-children"]').getByTestId('tree-empty')).toHaveText(text.dir.noNotes);
        await shot(page, 'files-empty-folder');
        await expect(page.getByTestId('dir-table').locator('th').first()).toBeVisible();
        await expect(page.getByTestId('dir-empty-new-folder')).toHaveCount(0);
        await page.getByTestId('dir-empty-new-file').click();
        await expect(page.getByTestId('dir-draft-input')).toBeFocused();
        await expect(page.getByTestId('tree-draft')).toHaveCount(0);
        await expect(page.getByTestId('dir-empty')).toHaveCount(0);
        await page.getByTestId('dir-draft-input').fill('first');
        await page.getByTestId('dir-draft-input').press('Enter');
        await expect(page).toHaveURL(new RegExp(`${routes.edit(`${BLANK_FOLDER}/first.md`)}$`));
    });

    test('New in a folder list names the entry in a row of the table', async ({page}) => {
        // arrange
        await page.goto(routes.dir(BLANK_FOLDER));
        const draft = page.getByTestId('dir-draft');

        // act & assert
        await page.getByTestId('dir-new').click();
        await page.getByTestId('dir-new-folder').click();
        await expect(draft).toHaveAttribute('data-entry', 'dir');
        await expect(page.getByTestId('tree-draft')).toHaveCount(0);
        await expect(page.getByTestId('dir-add-row')).toHaveCount(0);
        await shot(page, 'files-list-draft');

        await page.getByTestId('dir-draft-input').press('Escape');
        await expect(draft).toHaveCount(0);
        await expect(page.getByTestId('dir-add-row')).toBeVisible();

        await page.getByTestId('dir-add-row').click();
        await expect(draft).toHaveAttribute('data-entry', 'file');
        await page.getByTestId('dir-draft-input').fill('second');
        await page.getByTestId('dir-draft-input').press('Enter');
        await expect(page).toHaveURL(new RegExp(`${routes.edit(`${BLANK_FOLDER}/second.md`)}$`));
        expect(fs.existsSync(fixtureFile(`${BLANK_FOLDER}/second.md`))).toBe(true);
    });

    test('a folder list kept while the next one loads creates in the folder it shows', async ({page}) => {
        // arrange
        const held = 'e2e-fm-held';
        writeFixture(`${held}/inner/note.md`, '# Note\n');
        let release;
        const waiting = new Promise((resolve) => {
            release = resolve;
        });
        try {
            await page.route(`**/api/dir/${held}/inner`, async (route) => {
                await waiting;
                await route.continue();
            });
            await page.goto(routes.dir(held));
            await page.locator(`[data-testid=dir-row][data-path="${held}/inner"]`).click();
            await expect(page).toHaveURL(MAIN.url.dir(`${held}/inner`));
            await expect(page.getByTestId('dir-title')).toHaveText(held);

            // act
            await page.getByTestId('dir-new').click();
            await page.getByTestId('dir-new-folder').click();
            await page.getByTestId('dir-draft-input').fill('made');
            await page.getByTestId('dir-draft-input').press('Enter');

            // assert
            await expect.poll(() => fs.existsSync(fixtureFile(`${held}/made`))).toBe(true);
            expect(fs.existsSync(fixtureFile(`${held}/inner/made`))).toBe(false);
        } finally {
            release();
            removeFixture(held);
        }
    });

    test('the sidebar still names a new entry in the tree', async ({page}) => {
        // arrange
        await page.goto(routes.dir(BLANK_FOLDER));

        // act
        await page.getByTestId('sidebar-new').click();
        await page.getByTestId('sidebar-new-page').click();

        // assert
        await expect(page.getByTestId('tree-draft-input')).toBeFocused();
        await expect(page.getByTestId('dir-draft')).toHaveCount(0);
        await page.getByTestId('tree-draft-input').press('Escape');
    });

    test('deletes a folder with everything in it and leaves the page that was inside', async ({page}) => {
        // arrange
        const inner = `${FULL_FOLDER}/sub/note.md`;
        fs.mkdirSync(fixtureFile(`${FULL_FOLDER}/sub`), {recursive: true});
        fs.writeFileSync(fixtureFile(inner), '# Inner\n', 'utf8');
        fs.writeFileSync(fixtureFile(`${FULL_FOLDER}/picture.png`), 'not really a picture', 'utf8');
        await page.goto(routes.doc(inner));

        // act
        await page.locator(`[data-testid=tree-row][data-path="${FULL_FOLDER}"] [data-testid=tree-row-menu]`).click();
        await page.getByTestId('tree-row-menu-delete').click();

        // assert
        await expect(page.locator('[data-testid=toast][data-kind="ok"]')).toContainText(text.toast.deleted);
        await expect(page).toHaveURL(atHome());
        expect(fs.existsSync(fixtureFile(FULL_FOLDER))).toBe(false);
        await expect(page.locator(`[data-testid=tree-row][data-path="${FULL_FOLDER}"]`)).toHaveCount(0);
    });

    test('deletes a folder that holds only a file the app does not list', async ({page}) => {
        // arrange
        fs.mkdirSync(fixtureFile(JUNK_FOLDER), {recursive: true});
        fs.writeFileSync(fixtureFile(`${JUNK_FOLDER}/.DS_Store`), 'junk', 'utf8');
        await page.goto(routes.home());

        // act
        await page.locator(`[data-testid=tree-row][data-path="${JUNK_FOLDER}"] [data-testid=tree-row-menu]`).click();
        await page.getByTestId('tree-row-menu-delete').click();

        // assert
        await expect(page.locator('[data-testid=toast][data-kind="ok"]')).toContainText(text.toast.deleted);
        expect(fs.existsSync(fixtureFile(JUNK_FOLDER))).toBe(false);
    });

    test('Undo after a delete brings the folder back with what the app does not list, and the page that was open', async ({page}) => {
        // arrange
        const inner = `${UNDELETED}/note.md`;
        writeFixture(inner, '# Back\n');
        fs.writeFileSync(fixtureFile(`${UNDELETED}/.DS_Store`), 'junk', 'utf8');
        await page.goto(routes.doc(inner));
        await page.locator(`[data-testid=tree-row][data-path="${UNDELETED}"] [data-testid=tree-row-menu]`).click();
        await page.getByTestId('tree-row-menu-delete').click();
        await expect(page).toHaveURL(atHome());
        await shot(page, 'files-delete-undo');

        // act
        await page.getByTestId('toast-action').click();

        // assert
        await expect(page.locator('[data-testid=toast][data-kind="ok"]').filter({hasText: `Restored "${UNDELETED}"`}))
            .toHaveCount(1);
        await expect(page).toHaveURL(MAIN.url.doc(inner));
        expect([inner, `${UNDELETED}/.DS_Store`].map((p) => fs.existsSync(fixtureFile(p)))).toEqual([true, true]);
        await expect(page.locator(`[data-testid=tree-row][data-path="${UNDELETED}"]`)).toHaveCount(1);
    });
});

const PAGES = 'e2e-file-pages';
const PIXEL = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
);
const CODE = 'def greet(name):\n    return f"hello, {name}"\n\nprint(greet("you"))\n';

async function settled(locator) {
    await locator.evaluate((el) => Promise.all(el.getAnimations({subtree: true}).map((motion) => motion.finished)));
}

test.describe('file pages', () => {
    test.beforeAll(() => {
        writeFixture(`${PAGES}/pic.png`, PIXEL);
        writeFixture(`${PAGES}/wide.svg`, '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="10"></svg>\n');
        writeFixture(`${PAGES}/big.svg`, '<svg xmlns="http://www.w3.org/2000/svg" width="3000" height="2000"><rect width="3000" height="2000" fill="teal"/></svg>\n');
        writeFixture(`${PAGES}/code.py`, CODE);
        writeFixture(`${PAGES}/blob.bin`, Buffer.from([0, 1, 2, 3]));
        writeFixture(`${PAGES}/links.md`, '# Links\n\n[the code](code.py) and [the folder](../e2e-file-pages)\n');
    });

    test.beforeEach(async ({page}) => {
        await signIn(page);
    });

    test.afterAll(() => {
        removeFixture(PAGES);
    });

    test('a picture row opens its page, and a click opens the viewer', async ({page}) => {
        // arrange
        await page.goto(routes.dir(PAGES));

        // act
        await page.locator(`[data-testid=dir-row][data-path="${PAGES}/pic.png"]`).click();

        // assert
        await expect(page).toHaveURL(MAIN.url.doc(`${PAGES}/pic.png`));
        await expect(page.getByTestId('file')).toHaveAttribute('data-type', 'image');
        await expect(page.getByTestId('file-meta')).toContainText('1 × 1');
        await page.getByTestId('file-preview').click();
        await expect(page.getByTestId('doc-lightbox-image')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('doc-lightbox')).toHaveCount(0);
    });

    test('the next picture is not drawn at the scale of the one before', async ({page}) => {
        // arrange
        await page.goto(routes.doc(`${PAGES}/pic.png`));
        const image = page.getByTestId('file-preview').locator('img');
        await expect(image).toHaveCSS('width', '128px');
        await page.route('**/raw/**/wide.svg', async (route) => {
            await new Promise((resolve) => setTimeout(resolve, 1500));
            await route.continue().catch(() => undefined);
        });

        // act
        await page.evaluate((url) => {
            window.history.pushState(null, '', url);
            window.dispatchEvent(new PopStateEvent('popstate'));
        }, routes.doc(`${PAGES}/wide.svg`));

        // assert
        await expect(page.getByTestId('file-title')).toHaveText('wide.svg');
        expect(await image.evaluate((el) => el.style.width)).toBe('');
        await expect(image).toHaveCSS('width', '300px');
    });

    test('Back with the viewer of a picture open closes it and leaves the page free', async ({page}) => {
        // arrange
        await page.goto(routes.dir(PAGES));
        await page.locator(`[data-testid=dir-row][data-path="${PAGES}/pic.png"]`).click();
        await page.getByTestId('file-preview').click();
        await expect(page.getByTestId('doc-lightbox-image')).toBeVisible();

        // act
        await page.goBack();

        // assert
        await expect(page.getByTestId('dir')).toBeVisible();
        await expect(page.getByTestId('doc-lightbox')).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('');
    });

    test('a picture page draws no box behind the picture', async ({page}) => {
        // act
        await page.goto(routes.doc(`${PAGES}/wide.svg`));

        // assert
        const preview = page.getByTestId('file-preview');
        await expect(preview).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        await expect(preview).toHaveCSS('background-image', 'none');
        await expect(preview).toHaveCSS('padding', '0px');
    });

    test('a click zooms the picture in the viewer, a drag moves it, and a click fits it back', async ({page}) => {
        // arrange
        await page.goto(routes.doc(`${PAGES}/big.svg`));
        await page.getByTestId('file-preview').click();
        const picture = page.getByTestId('doc-lightbox-image');
        await expect(picture).toBeVisible();
        await settled(page.getByTestId('doc-lightbox'));
        const fitted = await picture.boundingBox();
        const centre = {x: fitted.x + fitted.width / 2, y: fitted.y + fitted.height / 2};

        // act
        await page.mouse.click(centre.x, centre.y);
        await expect(picture).toHaveAttribute('data-zoomed', 'true');
        await settled(picture);
        const zoomed = await picture.boundingBox();
        await page.mouse.move(centre.x, centre.y);
        await page.mouse.down();
        await page.mouse.move(centre.x + 200, centre.y + 100, {steps: 5});
        await page.mouse.up();

        // assert
        expect(zoomed.width).toBeGreaterThan(fitted.width * 1.5);
        const dragged = await picture.boundingBox();
        expect({dx: Math.round(dragged.x - zoomed.x), dy: Math.round(dragged.y - zoomed.y)}).toEqual({dx: 200, dy: 100});
        await expect(picture).toHaveAttribute('data-zoomed', 'true');
        await page.mouse.click(centre.x, centre.y);
        await expect(picture).toHaveAttribute('data-zoomed', 'false');
        await expect(page.getByTestId('doc-lightbox')).toBeVisible();
    });

    test('the wheel with Ctrl and the keys zoom the picture, the wheel alone moves it, and Escape closes', async ({page}) => {
        // arrange
        await page.goto(routes.doc(`${PAGES}/big.svg`));
        await page.getByTestId('file-preview').click();
        const picture = page.getByTestId('doc-lightbox-image');
        await expect(picture).toBeVisible();
        await settled(page.getByTestId('doc-lightbox'));
        const box = await picture.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

        // act
        await page.mouse.wheel(0, -300);
        await expect(picture).toHaveAttribute('data-zoomed', 'false');
        await page.keyboard.down('Control');
        await page.mouse.wheel(0, -300);
        await page.keyboard.up('Control');

        // assert
        await expect(picture).toHaveAttribute('data-zoomed', 'true');
        const zoomed = await picture.boundingBox();
        await page.mouse.wheel(0, 200);
        await expect.poll(async () => (await picture.boundingBox()).y).toBeLessThan(zoomed.y);
        await expect(picture).toHaveAttribute('data-zoomed', 'true');
        await page.keyboard.press('0');
        await expect(picture).toHaveAttribute('data-zoomed', 'false');
        await page.keyboard.press('+');
        await expect(picture).toHaveAttribute('data-zoomed', 'true');
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('doc-lightbox')).toHaveCount(0);
    });

    test('a text file is numbered lines, and Copy takes the text alone', async ({page}) => {
        // arrange
        await page.goto(routes.doc(`${PAGES}/code.py`));
        const code = page.getByTestId('file-code');

        // act
        await code.hover();
        await code.getByTestId('code-copy').click();

        // assert
        await expect(page.getByTestId('file-meta')).toContainText('Python, 4 lines');
        await expect(code.locator('.line')).toHaveCount(4);
        await expect(code.locator('pre span[class]').first()).toBeVisible();
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(CODE);
        await shot(page, 'files-text-page');
    });

    test('Download is a link to the bytes, and a file that cannot be shown offers it', async ({page}) => {
        // arrange
        await page.goto(routes.doc(`${PAGES}/blob.bin`));

        // act & assert
        await expect(page.getByTestId('file')).toHaveAttribute('data-type', 'other');
        await expect(page.getByTestId('file-other-download')).toHaveAttribute('href', routes.raw(`${PAGES}/blob.bin`));
        await expect(page.getByTestId('file-download')).toHaveAttribute('download', 'blob.bin');
        await expect(page.getByTestId('doc-history')).toHaveCount(0);
    });

    test('a link in a note opens the page of a file, and one to a folder its list', async ({page}) => {
        // arrange
        await page.goto(routes.doc(`${PAGES}/links.md`));

        // act & assert
        await page.getByTestId('doc').getByRole('link', {name: 'the code'}).click();
        await expect(page).toHaveURL(MAIN.url.doc(`${PAGES}/code.py`));
        await expect(page.getByTestId('file')).toHaveAttribute('data-type', 'text');

        await page.goBack();
        await page.getByTestId('doc').getByRole('link', {name: 'the folder'}).click();
        await expect(page).toHaveURL(MAIN.url.dir(PAGES));
        await expect(page.getByTestId('dir')).toBeVisible();
    });
});
