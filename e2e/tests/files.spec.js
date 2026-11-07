const {expect, test} = require('../support/test');

const fs = require('fs');

const {
    MAIN, atHome, fixtureFile, holdRoute, nameOf, recordMoves, removeFixture, rightClickPrevented, routes, save, setSource, shot,
    signIn, stays, writeFixture,
} = require('../support/helpers');
const text = require('../support/text');

const FOLDER = 'e2e-fm';
const OTHER = 'e2e-fm-other';
const PAGE = `${FOLDER}/Testovaya-stranitsa.md`;
const RENAMED = `${FOLDER}/pereimenovannaya.md`;
const DRAGGED = ['e2e-drag-one.md', 'e2e-drag-two.md'];
const ROOT_PAGE = 'e2e-root-page.md';
const TYPED_FILE = 'E2eTyped.java';
const TYPED_PICTURE = 'e2e-typed.png';
const DATED_PAGE = 'E2E-Meeting-2024.10.21.md';
const SLUG_PAGE = 'E2E-My-Notes.md';
const BLANK_FOLDER = 'e2e-fm-blank';
const HOLLOW = 'e2e-fm-hollow';
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
const CONTEXT_FOLDER = 'e2e-fm-context';
const CONTEXT_NOTE = `${CONTEXT_FOLDER}/note.md`;
const CONTEXT_ROOT_FOLDER = 'e2e-fm-context-root';
const RENAME_FOLDER = 'e2e-fm-rename';
const UNDO_FOLDER = 'e2e-fm-undo';
const KEYS_FOLDER = 'e2e-fm-keys';
const GAP_FOLDER = 'e2e-fm-gap';
const ROOT_MOVED = 'e2e-fm-to-root.md';
const DROPPED_TO_ROOT = 'e2e-fm-dropped-to-root.md';
const FOCUS_RETURN_WAIT = 150;

function makeNest() {
    writeFixture(NESTED_NOTE, '# Nested\n');
    for (const folder of [`${NEST}/a/b`, `${NEST}/c/d`]) {
        fs.mkdirSync(fixtureFile(folder), {recursive: true});
    }
}

async function openMoveFromNoteMenu(page, note) {
    await page.goto(MAIN.url.doc(note));
    await page.getByTestId('note-menu').click();
    await page.getByTestId('note-menu-move').click();
    await expect(page.getByTestId('move-dialog')).toBeVisible();
}

async function startTreeRename(page, path) {
    await page.locator(`[data-testid=tree-row][data-path="${path}"] [data-testid=tree-row-menu]`).click();
    await page.getByTestId('tree-row-menu-rename').click();
    await expect(page.getByTestId('tree-rename-input')).toBeFocused();
    await page.waitForTimeout(FOCUS_RETURN_WAIT);
    await expect(page.getByTestId('tree-rename-input')).toBeFocused();
}

async function startListRename(page, path) {
    await page.locator(`[data-testid=dir-row][data-path="${path}"]`).click({button: 'right'});
    await page.getByTestId('tree-row-menu-rename').click();
    await expect(page.getByTestId('dir-rename-input')).toBeFocused();
    await page.waitForTimeout(FOCUS_RETURN_WAIT);
    await expect(page.getByTestId('dir-rename-input')).toBeFocused();
}

async function startPageRename(page, menu) {
    await page.getByTestId(menu).click();
    await page.getByTestId(`${menu}-rename`).click();
    await expect(page.getByTestId('page-rename-input')).toBeFocused();
}

function caretAt(input) {
    return input.evaluate((field) => [field.selectionStart, field.selectionEnd]);
}

function shownPlaces(page, prefix) {
    return page.locator('[data-testid=move-place]')
        .evaluateAll((rows, start) => rows.map((row) => row.dataset.path).filter((path) => path.startsWith(start)), prefix);
}

test.describe.serial('file management', () => {
    test.beforeEach(async ({page}) => {
        await signIn(page);
    });

    test.afterAll(() => {
        for (const folder of [
            FOLDER, OTHER, BLANK_FOLDER, FULL_FOLDER, JUNK_FOLDER, LISTED_FOLDER, NEST, UNDELETED, CONTEXT_FOLDER,
            CONTEXT_ROOT_FOLDER, RENAME_FOLDER, UNDO_FOLDER, KEYS_FOLDER, GAP_FOLDER, HOLLOW,
        ]) {
            fs.rmSync(fixtureFile(folder), {recursive: true, force: true});
        }
        for (const name of [...DRAGGED, ROOT_PAGE, BLANK_PAGE, TYPED_FILE, TYPED_PICTURE, DATED_PAGE, SLUG_PAGE, ROOT_MOVED,
            DROPPED_TO_ROOT]) {
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

    test('a title typed with .md is a title too, and goes through the slug', async ({page}) => {
        // arrange
        await page.getByTestId('sidebar-new').click();
        await page.getByTestId('sidebar-new-page').click();

        // act
        await page.getByTestId('tree-draft-input').fill('E2E My Notes.md');
        await page.getByTestId('tree-draft-input').press('Enter');

        // assert
        await expect(page).toHaveURL(MAIN.url.edit(SLUG_PAGE));
        expect(fs.existsSync(fixtureFile(SLUG_PAGE))).toBe(true);
    });

    test('a rename keeps the new name as typed, so a note renamed without .md leaves the tree and a file with it enters', async ({page}) => {
        // arrange
        const note = `${FOLDER}/to-bare.md`;
        const bare = `${FOLDER}/bare title`;
        const typed = `${FOLDER}/x.txt`;
        const plain = `${FOLDER}/y.txt`;
        const made = `${FOLDER}/y.md`;
        writeFixture(note, 'note\n');
        writeFixture(plain, 'text\n');
        await page.goto(MAIN.url.dir(FOLDER));
        const treeRow = (path) => page.locator(`[data-testid=tree-row][data-path="${path}"]`);
        const toast = page.locator('[data-testid=toast][data-kind="ok"]');

        // act & assert
        await startTreeRename(page, note);
        await page.getByTestId('tree-rename-input').fill(nameOf(bare));
        await page.getByTestId('tree-rename-input').press('Enter');
        await expect(page.getByTestId('tree-rename')).toHaveCount(0);
        await expect(toast).toContainText(`Renamed "${nameOf(note)}" to "${nameOf(bare)}"`);
        await expect(toast).toContainText(text.toast.notNoteNow);
        await expect(treeRow(note)).toHaveCount(0);
        await expect(treeRow(bare)).toHaveCount(0);

        await startListRename(page, bare);
        await page.getByTestId('dir-rename-input').fill(nameOf(typed));
        await page.getByTestId('dir-rename-input').press('Enter');
        await expect(page.locator(`[data-testid=dir-row][data-path="${typed}"]`)).toHaveCount(1);

        await startListRename(page, plain);
        await page.getByTestId('dir-rename-input').fill(nameOf(made));
        await page.getByTestId('dir-rename-input').press('Enter');
        const entered = toast.filter({hasText: `Renamed "${nameOf(plain)}" to "${nameOf(made)}"`});
        await expect(entered).toHaveCount(1);
        await expect(entered).not.toContainText(text.toast.notNoteNow);
        await expect(treeRow(made)).toHaveCount(1);
        await expect(treeRow(typed)).toHaveCount(0);
        expect([note, bare, `${bare}.md`, typed, plain, made]
            .map((path) => fs.existsSync(fixtureFile(path)))).toEqual([false, false, false, true, false, true]);
        removeFixture(typed);
        removeFixture(made);
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
        await expect(input).toHaveValue(nameOf(PAGE));
        await expect(input).toBeFocused();
        await shot(page, 'files-rename-in-place');

        // act
        await input.fill(nameOf(RENAMED));
        await input.press('Enter');

        // assert
        await expect(page.locator('[data-testid=toast][data-kind="ok"]'))
            .toContainText(`Renamed "${nameOf(PAGE)}" to "${nameOf(RENAMED)}"`);
        await expect(page).toHaveURL(MAIN.url.doc(RENAMED));
        expect(fs.existsSync(fixtureFile(PAGE))).toBe(false);
        expect(fs.existsSync(fixtureFile(RENAMED))).toBe(true);
        await expect(page.locator(`[data-testid=tree-row][data-path="${RENAMED}"]`)).toHaveCount(1);
        await expect(page.locator('.mantine-Modal-title')).toHaveCount(0);
        await shot(page, 'files-renamed');
    });

    test('the tree rename field keeps a name when it loses focus, and Escape drops it', async ({page}) => {
        // arrange
        const note = `${RENAME_FOLDER}/kept.md`;
        const blurred = `${RENAME_FOLDER}/blurred.md`;
        writeFixture(note, '# Kept\n');
        await page.goto(routes.dir(RENAME_FOLDER));
        const input = page.getByTestId('tree-rename-input');
        const moves = recordMoves(page);

        // act & assert
        await startTreeRename(page, note);
        await input.fill(nameOf(blurred));
        await page.getByTestId('dir-title').click();
        await expect.poll(() => fs.existsSync(fixtureFile(blurred))).toBe(true);
        await expect(page.getByTestId('tree-rename')).toHaveCount(0);

        await startTreeRename(page, blurred);
        await input.fill('dropped.md');
        await input.press('Escape');
        await expect(page.getByTestId('tree-rename')).toHaveCount(0);
        await stays(() => moves, [{from: note, to: blurred}], 300);
        expect([blurred, `${RENAME_FOLDER}/dropped.md`].map((p) => fs.existsSync(fixtureFile(p)))).toEqual([true, false]);
    });

    test('an empty or unchanged name in the tree rename field renames nothing', async ({page}) => {
        // arrange
        const note = `${RENAME_FOLDER}/same.md`;
        writeFixture(note, '# Same\n');
        await page.goto(routes.dir(RENAME_FOLDER));
        const input = page.getByTestId('tree-rename-input');

        // act & assert
        await startTreeRename(page, note);
        await input.fill('');
        await input.press('Enter');
        await expect(page.getByTestId('tree-rename')).toHaveCount(0);

        await startTreeRename(page, note);
        await expect(input).toHaveValue(nameOf(note));
        await input.press('Enter');
        await expect(page.getByTestId('tree-rename')).toHaveCount(0);
        await expect(page.getByTestId('toast')).toHaveCount(0);
        expect(fs.readdirSync(fixtureFile(RENAME_FOLDER)).filter((name) => name.startsWith('same'))).toEqual(['same.md']);
    });

    test('a note with a dot in its name is left as it is when the unchanged field loses focus', async ({page}) => {
        // arrange
        const note = `${RENAME_FOLDER}/guide.en.md`;
        writeFixture(note, '# Guide\n');
        await page.goto(routes.dir(RENAME_FOLDER));
        await startTreeRename(page, note);
        const input = page.getByTestId('tree-rename-input');
        await expect(input).toHaveValue(nameOf(note));
        const end = nameOf(note).length - '.md'.length;
        expect(await caretAt(input)).toEqual([end, end]);

        // act
        await page.getByTestId('dir-title').click();

        // assert
        await expect(page.getByTestId('tree-rename')).toHaveCount(0);
        await expect(page.getByTestId('toast')).toHaveCount(0);
        expect(fs.readdirSync(fixtureFile(RENAME_FOLDER)).filter((name) => name.startsWith('guide'))).toEqual(['guide.en.md']);
    });

    test('a file whose name ends in a space keeps it when the unchanged field loses focus', async ({page}) => {
        // arrange
        const file = `${RENAME_FOLDER}/spaced.md `;
        writeFixture(file, '# Spaced\n');
        await page.goto(routes.dir(RENAME_FOLDER));
        await startListRename(page, file);
        await expect(page.getByTestId('dir-rename-input')).toHaveValue(nameOf(file));

        // act
        await page.getByTestId('dir-title').click();

        // assert
        await expect(page.getByTestId('dir-rename-field')).toHaveCount(0);
        await expect(page.getByTestId('toast')).toHaveCount(0);
        expect(fs.readdirSync(fixtureFile(RENAME_FOLDER)).filter((name) => name.startsWith('spaced'))).toEqual([nameOf(file)]);
    });

    test('a new name typed with spaces around it is saved without them', async ({page}) => {
        // arrange
        const note = `${RENAME_FOLDER}/padded.md`;
        const renamed = `${RENAME_FOLDER}/unpadded.md`;
        writeFixture(note, '# Padded\n');
        await page.goto(routes.dir(RENAME_FOLDER));
        await startTreeRename(page, note);

        // act
        await page.getByTestId('tree-rename-input').fill(`  ${nameOf(renamed)} `);
        await page.getByTestId('tree-rename-input').press('Enter');

        // assert
        await expect(page.locator('[data-testid=toast][data-kind="ok"]'))
            .toContainText(`Renamed "${nameOf(note)}" to "${nameOf(renamed)}"`);
        expect(fs.readdirSync(fixtureFile(RENAME_FOLDER)).filter((name) => name.includes('padded'))).toEqual([nameOf(renamed)]);
    });

    test('renames a folder in place in the tree', async ({page}) => {
        // arrange
        const folder = `${RENAME_FOLDER}/sub`;
        writeFixture(`${folder}/inside.md`, '# Inside\n');
        await page.goto(routes.dir(RENAME_FOLDER));
        await startTreeRename(page, folder);

        // act
        await page.getByTestId('tree-rename-input').fill('moved-sub');
        await page.getByTestId('tree-rename-input').press('Enter');

        // assert
        await expect(page.locator('[data-testid=toast][data-kind="ok"]')).toContainText('Renamed "sub" to "moved-sub"');
        await expect.poll(() => fs.existsSync(fixtureFile(`${RENAME_FOLDER}/moved-sub/inside.md`))).toBe(true);
        expect(fs.existsSync(fixtureFile(folder))).toBe(false);
        await expect(page.locator(`[data-testid=tree-row][data-path="${RENAME_FOLDER}/moved-sub"]`)).toHaveCount(1);
    });

    test('a tree rename to a name that is taken says so and keeps the field', async ({page}) => {
        // arrange
        const note = `${RENAME_FOLDER}/first.md`;
        writeFixture(note, '# First\n');
        writeFixture(`${RENAME_FOLDER}/taken.md`, '# Taken\n');
        await page.goto(routes.dir(RENAME_FOLDER));
        await startTreeRename(page, note);

        // act
        await page.getByTestId('tree-rename-input').fill('taken.md');
        await page.getByTestId('tree-rename-input').press('Enter');

        // assert
        const failed = page.locator('[data-testid=toast][data-kind="error"]');
        await expect(failed).toContainText('Nothing was renamed');
        await expect(failed).toContainText('Something of that name is already there');
        await expect(page.getByTestId('tree-rename-input')).toHaveValue('taken.md');
        expect(fs.readFileSync(fixtureFile(`${RENAME_FOLDER}/taken.md`), 'utf8')).toBe('# Taken\n');
        expect(fs.existsSync(fixtureFile(note))).toBe(true);
    });

    test('Rename from the tree while the filter hides the folder opens the folders above and shows the field', async ({page}) => {
        // arrange
        const note = `${RENAME_FOLDER}/deep/er/zzfilteredname.md`;
        writeFixture(note, '# Filtered\n');
        await page.goto(routes.home());
        await page.getByTestId('sidebar-filter').fill('zzfilteredname');
        await expect(page.locator(`[data-testid=tree-row][data-path="${note}"]`)).toBeVisible();

        // act
        await page.locator(`[data-testid=tree-row][data-path="${note}"] [data-testid=tree-row-menu]`).click();
        await page.getByTestId('tree-row-menu-rename').click();

        // assert
        await expect(page.getByTestId('sidebar-filter')).toHaveValue('');
        await expect(page.getByTestId('tree-rename-input')).toHaveValue('zzfilteredname.md');
        await expect(page.getByTestId('tree-rename-input')).toBeFocused();
    });

    test('a rename with a slash in the name moves nothing', async ({page}) => {
        // arrange
        await page.goto(routes.doc(RENAMED));
        await page.locator(`[data-testid=tree-row][data-path="${RENAMED}"] [data-testid=tree-row-menu]`).click();
        await page.getByTestId('tree-row-menu-rename').click();

        // act
        await page.getByTestId('tree-rename-input').fill(`${OTHER}/pereimenovannaya.md`);
        await page.getByTestId('tree-rename-input').press('Enter');

        // assert
        await expect(page.locator('[data-testid=toast][data-kind="error"]')).toContainText(text.renameSlash);
        await expect(page.getByTestId('tree-rename-input')).toHaveValue(`${OTHER}/pereimenovannaya.md`);
        expect(fs.existsSync(fixtureFile(RENAMED))).toBe(true);
    });

    test('a name that starts with a dot renames nothing', async ({page}) => {
        // arrange
        const note = `${RENAME_FOLDER}/dotted.md`;
        writeFixture(note, '# Dotted\n');
        await page.goto(routes.dir(RENAME_FOLDER));
        await startTreeRename(page, note);

        // act
        await page.getByTestId('tree-rename-input').fill('.dotted.md');
        await page.getByTestId('tree-rename-input').press('Enter');

        // assert
        const failed = page.locator('[data-testid=toast][data-kind="error"]');
        await expect(failed).toContainText('Nothing was renamed');
        await expect(failed).toContainText('A name cannot start with a dot');
        await expect(page.getByTestId('tree-rename-input')).toHaveValue('.dotted.md');
        expect(fs.existsSync(fixtureFile(note))).toBe(true);
    });

    test('the rename field starts with the whole name, the cursor before the extension and nothing selected', async ({page}) => {
        // arrange
        const note = `${RENAME_FOLDER}/caret.md`;
        const folder = `${RENAME_FOLDER}/v1.2`;
        const bare = `${RENAME_FOLDER}/LICENSE`;
        writeFixture(note, '# Caret\n');
        writeFixture(`${folder}/inside.md`, '# Inside\n');
        writeFixture(bare, 'license\n');
        await page.goto(routes.dir(RENAME_FOLDER));
        const input = page.getByTestId('tree-rename-input');
        const end = nameOf(note).length - '.md'.length;

        // act & assert
        await expect(page.locator(`[data-testid=tree-row][data-path="${note}"] [data-testid=tree-link]`)).toHaveText(nameOf(note));
        await startTreeRename(page, note);
        await expect(input).toHaveValue(nameOf(note));
        expect(await caretAt(input)).toEqual([end, end]);
        await input.press('Escape');

        await startTreeRename(page, folder);
        await expect(input).toHaveValue(nameOf(folder));
        expect(await caretAt(input)).toEqual([nameOf(folder).length, nameOf(folder).length]);
        await input.press('Escape');

        await startListRename(page, bare);
        const listed = page.getByTestId('dir-rename-input');
        await expect(listed).toHaveValue(nameOf(bare));
        expect(await caretAt(listed)).toEqual([nameOf(bare).length, nameOf(bare).length]);
        await listed.press('Escape');
    });

    test('a click outside right after the field opens saves the name, and the focus stays where the click put it', async ({page}) => {
        // arrange
        const note = `${RENAME_FOLDER}/quick.md`;
        const renamed = `${RENAME_FOLDER}/quick-done.md`;
        writeFixture(note, '# Quick\n');
        await page.goto(routes.dir(RENAME_FOLDER));
        await page.locator(`[data-testid=tree-row][data-path="${note}"] [data-testid=tree-row-menu]`).click();
        await page.getByTestId('tree-row-menu-rename').click();
        await page.getByTestId('tree-rename-input').fill(nameOf(renamed));

        // act
        await page.getByTestId('sidebar-filter').click();

        // assert
        await expect.poll(() => fs.existsSync(fixtureFile(renamed))).toBe(true);
        await expect(page.getByTestId('tree-rename')).toHaveCount(0);
        await page.waitForTimeout(FOCUS_RETURN_WAIT);
        await expect(page.getByTestId('sidebar-filter')).toBeFocused();
    });

    test('a slow rename does not close a field opened after it', async ({page}) => {
        // arrange
        const first = `${RENAME_FOLDER}/slow-a.md`;
        const done = `${RENAME_FOLDER}/slow-a-done.md`;
        const second = `${RENAME_FOLDER}/slow-b.md`;
        const typed = 'slow-b-typed.md';
        writeFixture(first, '# A\n');
        writeFixture(second, '# B\n');
        await page.goto(routes.dir(RENAME_FOLDER));
        const release = await holdRoute(page, '**/api/move');
        await startTreeRename(page, first);
        await page.getByTestId('tree-rename-input').fill(nameOf(done));
        await page.getByTestId('dir-title').click();
        await startTreeRename(page, second);
        await page.getByTestId('tree-rename-input').fill(typed);

        // act
        release();

        // assert
        await expect.poll(() => fs.existsSync(fixtureFile(done))).toBe(true);
        await expect(page.locator('[data-testid=toast][data-kind="ok"]')).toContainText(`Renamed "${nameOf(first)}"`);
        await expect(page.getByTestId('tree-rename-input')).toHaveValue(typed);
        await page.getByTestId('tree-rename-input').press('Escape');
        expect(fs.existsSync(fixtureFile(second))).toBe(true);
    });

    test('a slow rename of the page on screen does not close a field opened after it when the page follows', async ({page}) => {
        // arrange
        const first = `${RENAME_FOLDER}/shown-a.md`;
        const done = `${RENAME_FOLDER}/shown-a-done.md`;
        const second = `${RENAME_FOLDER}/shown-b.md`;
        const typed = 'shown-b-typed.md';
        writeFixture(first, '# A\n');
        writeFixture(second, '# B\n');
        await page.goto(MAIN.url.doc(first));
        const release = await holdRoute(page, '**/api/move');
        await startPageRename(page, 'note-menu');
        await page.getByTestId('page-rename-input').fill(nameOf(done));
        await page.getByTestId('page-rename-input').press('Enter');
        await startTreeRename(page, second);
        await page.getByTestId('tree-rename-input').fill(typed);

        // act
        release();

        // assert
        await expect(page).toHaveURL(MAIN.url.doc(done));
        await expect(page.getByTestId('tree-rename-input')).toHaveValue(typed);
        await page.getByTestId('tree-rename-input').press('Escape');
        expect([first, done, second].map((path) => fs.existsSync(fixtureFile(path)))).toEqual([false, true, true]);
    });

    test('renames a note from its own menu in a popover under the last crumb, and the menu does not take the focus back', async ({page}) => {
        // arrange
        const note = `${FOLDER}/from-menu.md`;
        const renamed = `${FOLDER}/menu-renamed.md`;
        writeFixture(note, '# From the menu\n');
        await page.goto(MAIN.url.doc(note));
        const crumb = page.locator('[data-testid=crumb][data-current="true"]');
        const input = page.getByTestId('page-rename-input');

        // act & assert
        await expect(crumb).toHaveText(nameOf(note));
        await startPageRename(page, 'note-menu');
        await page.waitForTimeout(FOCUS_RETURN_WAIT);
        await expect(input).toBeFocused();
        await expect(input).toHaveValue(nameOf(note));
        const under = await crumb.boundingBox();
        const popover = await page.getByTestId('page-rename').boundingBox();
        expect(popover.y).toBeGreaterThanOrEqual(under.y + under.height);
        expect(Math.abs(popover.x - under.x)).toBeLessThan(8);
        await expect(page.locator('.mantine-Overlay-root:visible, .mantine-Modal-content:visible')).toHaveCount(0);
        await expect(page.getByTestId('page-rename').locator('button')).toHaveCount(0);
        await shot(page, 'files-rename-popover');

        await input.fill(nameOf(renamed));
        await input.press('Enter');
        await expect(page).toHaveURL(MAIN.url.doc(renamed));
        await expect(page.getByTestId('page-rename')).toHaveCount(0);
        await expect(crumb).toHaveText(nameOf(renamed));
        expect([note, renamed].map((path) => fs.existsSync(fixtureFile(path)))).toEqual([false, true]);
    });

    test('the rename popover of a page drops the name on Escape and saves it on a click on the page', async ({page}) => {
        // arrange
        const note = `${FOLDER}/popover-keys.md`;
        const clicked = `${FOLDER}/popover-clicked.md`;
        writeFixture(note, '# Popover keys\n\nSome text of the note.\n');
        await page.goto(MAIN.url.doc(note));
        const input = page.getByTestId('page-rename-input');
        const moves = recordMoves(page);

        // act & assert
        await startPageRename(page, 'note-menu');
        await input.fill('dropped.md');
        await input.press('Escape');
        await expect(page.getByTestId('page-rename')).toHaveCount(0);
        await stays(() => moves, [], 300);
        expect(fs.existsSync(fixtureFile(`${FOLDER}/dropped.md`))).toBe(false);

        await startPageRename(page, 'note-menu');
        await input.fill(nameOf(clicked));
        await page.locator('[data-testid=note] p').click();
        await expect(page).toHaveURL(MAIN.url.doc(clicked));
        expect(moves).toEqual([{from: note, to: clicked}]);
        expect([note, clicked].map((path) => fs.existsSync(fixtureFile(path)))).toEqual([false, true]);
        removeFixture(clicked);
    });

    test('a page rename to a name that is taken says so and keeps the popover with the name typed', async ({page}) => {
        // arrange
        const note = `${FOLDER}/popover-first.md`;
        const taken = `${FOLDER}/popover-taken.md`;
        writeFixture(note, '# First\n');
        writeFixture(taken, '# Taken\n');
        await page.goto(MAIN.url.doc(note));
        await startPageRename(page, 'note-menu');
        const input = page.getByTestId('page-rename-input');

        // act
        await input.fill(nameOf(taken));
        await input.press('Enter');

        // assert
        const failed = page.locator('[data-testid=toast][data-kind="error"]');
        await expect(failed).toContainText(text.renameFailed);
        await expect(failed).toContainText(text.nameTaken);
        await expect(page.getByTestId('page-rename')).toBeVisible();
        await expect(input).toHaveValue(nameOf(taken));
        await expect(input).toBeFocused();
        await expect(page).toHaveURL(MAIN.url.doc(note));
        expect(fs.readFileSync(fixtureFile(taken), 'utf8')).toBe('# Taken\n');
        removeFixture(note);
        removeFixture(taken);
    });

    test('going back with the rename popover open closes it and renames nothing', async ({page}) => {
        // arrange
        const note = `${FOLDER}/popover-back.md`;
        writeFixture(note, '# Back\n');
        await page.goto(MAIN.url.dir(FOLDER));
        await page.goto(MAIN.url.doc(note));
        await startPageRename(page, 'note-menu');
        await page.getByTestId('page-rename-input').fill('popover-gone.md');
        const moves = recordMoves(page);

        // act
        await page.goBack();

        // assert
        await expect(page).toHaveURL(MAIN.url.dir(FOLDER));
        await expect(page.getByTestId('page-rename')).toHaveCount(0);
        await stays(() => moves, [], 300);
        expect([note, `${FOLDER}/popover-gone.md`].map((path) => fs.existsSync(fixtureFile(path)))).toEqual([true, false]);
        removeFixture(note);
    });

    test('a file page and a folder page rename through the popover under the last crumb', async ({page}) => {
        // arrange
        const file = `${RENAME_FOLDER}/plain.txt`;
        const folder = `${RENAME_FOLDER}/page-folder`;
        writeFixture(file, 'plain\n');
        writeFixture(`${folder}/inside.md`, '# Inside\n');
        const input = page.getByTestId('page-rename-input');

        // act & assert
        await page.goto(MAIN.url.doc(file));
        await startPageRename(page, 'file-menu');
        await expect(input).toHaveValue(nameOf(file));
        await input.fill('plain-renamed.txt');
        await input.press('Enter');
        await expect(page).toHaveURL(MAIN.url.doc(`${RENAME_FOLDER}/plain-renamed.txt`));

        await page.goto(MAIN.url.dir(folder));
        await startPageRename(page, 'folder-menu');
        await expect(input).toHaveValue(nameOf(folder));
        await input.fill('page-folder-renamed');
        await input.press('Enter');
        await expect(page).toHaveURL(MAIN.url.dir(`${RENAME_FOLDER}/page-folder-renamed`));
        expect(fs.existsSync(fixtureFile(`${RENAME_FOLDER}/page-folder-renamed/inside.md`))).toBe(true);
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
        fs.mkdirSync(fixtureFile(OTHER), {recursive: true});
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
            .toContainText(`Moved "${MOVED}" to "${OTHER}"`);
        await expect(page).toHaveURL(MAIN.url.doc(`${OTHER}/${MOVED}`));
        await expect(page.getByTestId('move-dialog')).toHaveCount(0);
        expect([`${FOLDER}/${MOVED}`, `${OTHER}/${MOVED}`].map((p) => fs.existsSync(fixtureFile(p)))).toEqual([false, true]);
    });

    test('Undo in the toast after a move puts the note back and follows it', async ({page}) => {
        // arrange
        writeFixture(`${FOLDER}/${UNDONE}`, '# Undone\n');
        fs.mkdirSync(fixtureFile(OTHER), {recursive: true});
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
            .filter({hasText: `Moved "${UNDONE}" back to "${FOLDER}"`})).toHaveCount(1);
        await expect(page).toHaveURL(MAIN.url.doc(`${FOLDER}/${UNDONE}`));
        expect([`${FOLDER}/${UNDONE}`, `${OTHER}/${UNDONE}`].map((p) => fs.existsSync(fixtureFile(p)))).toEqual([true, false]);
    });

    test('the folder named in the toast of a move opens that folder', async ({page}) => {
        // arrange
        writeFixture(`${FOLDER}/${LINKED}`, '# Linked\n');
        fs.mkdirSync(fixtureFile(OTHER), {recursive: true});
        await page.goto(MAIN.url.dir(FOLDER));
        await page.locator(`[data-testid=tree-row][data-path="${FOLDER}/${LINKED}"] [data-testid=tree-row-menu]`).click();
        await page.getByTestId('tree-row-menu-move').click();
        await page.locator(`[data-testid=move-place][data-path="${OTHER}"]`).click();

        // act
        await page.getByTestId('toast-link').click();

        // assert
        await expect(page).toHaveURL(MAIN.url.dir(OTHER));
        await expect(page.locator(`[data-testid=dir-row][data-path="${OTHER}/${LINKED}"]`)).toHaveCount(1);
        await expect(page.getByTestId('toast-action')).toBeVisible();
        await expect(page.getByTestId('toast-link')).toBeVisible();
    });

    test('Move to says a folder already holds that name and moves nothing there', async ({page}) => {
        // arrange
        writeFixture(`${FOLDER}/${MOVED}`, '# Moved again\n');
        writeFixture(`${OTHER}/${MOVED}`, '# Moved\n');
        await page.goto(MAIN.url.dir(FOLDER));
        await page.locator(`[data-testid=tree-row][data-path="${FOLDER}/${MOVED}"] [data-testid=tree-row-menu]`).click();
        await page.getByTestId('tree-row-menu-move').click();
        const target = page.locator(`[data-testid=move-place][data-path="${OTHER}"]`);

        // act & assert
        await target.click();
        await expect(page.getByTestId('move-taken')).toHaveText(`${OTHER} already holds ${MOVED}`);
        await expect(page.getByTestId('move-dialog')).toBeVisible();

        await target.hover();
        await expect(target).toHaveAttribute('data-active', 'true');
        await page.getByTestId('move-input').press('Enter');
        await expect(page.getByTestId('move-dialog')).toBeVisible();
        expect(fs.readFileSync(fixtureFile(`${FOLDER}/${MOVED}`), 'utf8')).toBe('# Moved again\n');
        expect(fs.readFileSync(fixtureFile(`${OTHER}/${MOVED}`), 'utf8')).toBe('# Moved\n');
    });

    test('Move to leaves out the folder itself and every folder inside it', async ({page}) => {
        // arrange
        fs.mkdirSync(fixtureFile(INNER), {recursive: true});
        fs.mkdirSync(fixtureFile(OTHER), {recursive: true});
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
        makeNest();
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
        makeNest();
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

    test('a chevron in Move to keeps the focus in the search field, so the arrows go on working', async ({page}) => {
        // arrange
        makeNest();
        await page.goto(MAIN.url.doc(NESTED_NOTE));
        await page.getByTestId('note-menu').click();
        await page.getByTestId('note-menu-move').click();
        await page.locator(`[data-testid=move-place][data-path="${NEST}"] [data-testid=move-twisty]`).click();
        await expect.poll(() => shownPlaces(page, NEST)).toEqual([NEST, `${NEST}/a`, `${NEST}/c`]);

        // act
        await page.keyboard.press('ArrowLeft');

        // assert
        await expect(page.getByTestId('move-input')).toBeFocused();
        await expect.poll(() => shownPlaces(page, NEST)).toEqual([NEST]);
    });

    test('the right and left arrows unfold and fold the picked folder in Move to', async ({page}) => {
        // arrange
        makeNest();
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

    test('the arrows in Move to reach the folder the entry is in and unfold it, and Enter there moves nothing', async ({page}) => {
        // arrange
        makeNest();
        await page.goto(MAIN.url.doc(NESTED_NOTE));
        await page.getByTestId('note-menu').click();
        await page.getByTestId('note-menu-move').click();
        await page.locator(`[data-testid=move-place][data-path="${NEST}"]`).hover();
        const input = page.getByTestId('move-input');
        await input.press('ArrowRight');
        const current = page.locator(`[data-testid=move-place][data-path="${NEST}/a"]`);

        // act
        await input.press('ArrowDown');
        await input.press('ArrowRight');
        await input.press('Enter');

        // assert
        await expect(current).toHaveAttribute('data-active', 'true');
        await expect(page.getByTestId('move-preview')).toHaveText(`Pick a folder to move ${nameOf(NESTED_NOTE)} into`);
        await expect.poll(() => shownPlaces(page, NEST)).toEqual([NEST, `${NEST}/a`, `${NEST}/a/b`, `${NEST}/c`]);
        await expect(page.getByTestId('move-dialog')).toBeVisible();
        expect(fs.existsSync(fixtureFile(NESTED_NOTE))).toBe(true);
    });

    test('Move to opens in place of the menu it was picked from, and Escape closes it', async ({page}) => {
        // arrange
        makeNest();
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

    test('the arrow keys pick a folder in Move to and Enter moves there', async ({page}) => {
        // arrange
        const note = `${KEYS_FOLDER}/keyed.md`;
        writeFixture(note, '# Keyed\n');
        for (const folder of ['alpha-dest', 'beta-dest']) {
            fs.mkdirSync(fixtureFile(`${KEYS_FOLDER}/${folder}`), {recursive: true});
        }
        await openMoveFromNoteMenu(page, note);
        const input = page.getByTestId('move-input');
        await input.fill('-dest');
        const first = page.locator(`[data-testid=move-place][data-path="${KEYS_FOLDER}/alpha-dest"]`);
        const second = page.locator(`[data-testid=move-place][data-path="${KEYS_FOLDER}/beta-dest"]`);
        await expect(first).toHaveAttribute('data-active', 'true');

        // act
        await input.press('ArrowDown');
        await expect(second).toHaveAttribute('data-active', 'true');
        await input.press('ArrowDown');
        await expect(second).toHaveAttribute('data-active', 'true');
        await input.press('Enter');

        // assert
        await expect(page).toHaveURL(MAIN.url.doc(`${KEYS_FOLDER}/beta-dest/keyed.md`));
        expect([note, `${KEYS_FOLDER}/beta-dest/keyed.md`].map((p) => fs.existsSync(fixtureFile(p)))).toEqual([false, true]);
    });

    test('Move to says when no folder matches and Enter moves nothing then', async ({page}) => {
        // arrange
        const note = `${KEYS_FOLDER}/unmatched.md`;
        writeFixture(note, '# Unmatched\n');
        await openMoveFromNoteMenu(page, note);

        // act
        await page.getByTestId('move-input').fill('zz-no-folder-is-called-this');
        await page.getByTestId('move-input').press('Enter');

        // assert
        await expect(page.getByTestId('move-empty')).toHaveText('No folder matches that.');
        await expect(page.getByTestId('move-place')).toHaveCount(0);
        await expect(page.getByTestId('move-dialog')).toBeVisible();
        expect(fs.existsSync(fixtureFile(note))).toBe(true);
    });

    test('Move to puts a note into the root of the space', async ({page}) => {
        // arrange
        const note = `${KEYS_FOLDER}/${ROOT_MOVED}`;
        writeFixture(note, '# To the root\n');
        await openMoveFromNoteMenu(page, note);

        // act
        await page.locator('[data-testid=move-place][data-path=""]').click();

        // assert
        await expect(page).toHaveURL(MAIN.url.doc(ROOT_MOVED));
        expect([note, ROOT_MOVED].map((p) => fs.existsSync(fixtureFile(p)))).toEqual([false, true]);
    });

    test('Move to from the menu of a file page moves the file and its page follows', async ({page}) => {
        // arrange
        const picture = `${KEYS_FOLDER}/picture.png`;
        const into = `${KEYS_FOLDER}/pictures`;
        writeFixture(picture, 'not really a picture');
        fs.mkdirSync(fixtureFile(into), {recursive: true});
        await page.goto(MAIN.url.doc(picture));
        await page.getByTestId('file-menu').click();
        await page.getByTestId('file-menu-move').click();

        // act
        await page.getByTestId('move-input').fill('pictures');
        await page.locator(`[data-testid=move-place][data-path="${into}"]`).click();

        // assert
        await expect(page).toHaveURL(MAIN.url.doc(`${into}/picture.png`));
        await expect(page.getByTestId('file')).toBeVisible();
        expect([picture, `${into}/picture.png`].map((p) => fs.existsSync(fixtureFile(p)))).toEqual([false, true]);
    });

    test('moves a folder with Move to and follows it when it is on screen', async ({page}) => {
        // arrange
        fs.mkdirSync(fixtureFile(INNER), {recursive: true});
        fs.mkdirSync(fixtureFile(OTHER), {recursive: true});
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
        // arrange
        writeFixture(RENAMED, '# Renamed\n');
        await page.goto(routes.doc(RENAMED));
        await page.locator(`[data-testid=tree-row][data-path="${RENAMED}"] [data-testid=tree-row-menu]`).click();

        // act
        await page.getByTestId('tree-row-menu-delete').click();

        // assert
        await expect(page.locator('[data-testid=toast][data-kind="ok"]')).toContainText(`Deleted "${nameOf(RENAMED)}"`);
        await expect(page.locator('.mantine-Modal-title')).toHaveCount(0);
        await expect(page).toHaveURL(atHome());
        await expect.poll(() => fs.existsSync(fixtureFile(RENAMED))).toBe(false);
        await expect(page.locator(`[data-testid=tree-row][data-path="${RENAMED}"]`)).toHaveCount(0);
        await shot(page, 'files-deleted');
    });

    test('a delete shows its toast and leaves the page before the server answers', async ({page}) => {
        // arrange
        const note = `${FOLDER}/slow-delete.md`;
        writeFixture(note, '# Slow delete\n');
        await page.goto(routes.doc(note));
        const release = await holdRoute(page, `**${routes.api(`/file/${note}`)}**`);
        await page.locator(`[data-testid=tree-row][data-path="${note}"] [data-testid=tree-row-menu]`).click();

        // act
        await page.getByTestId('tree-row-menu-delete').click();

        // assert
        await expect(page.locator('[data-testid=toast][data-kind="ok"]')).toContainText('Deleted "slow-delete.md"');
        await expect(page).toHaveURL(atHome());
        expect(fs.existsSync(fixtureFile(note))).toBe(true);
        release();
        await expect.poll(() => fs.existsSync(fixtureFile(note))).toBe(false);
        await expect(page.locator(`[data-testid=tree-row][data-path="${note}"]`)).toHaveCount(0);
    });

    test('a new note and a new folder keep the capital letters typed', async ({page}) => {
        // arrange
        await page.goto(routes.dir(FOLDER));

        // act
        await page.locator(`[data-testid=tree-row][data-path="${FOLDER}"] [data-testid=tree-row-menu]`).click();
        await page.getByTestId('tree-row-menu-new-folder').click();
        await page.getByTestId('tree-draft-input').fill('Docs');
        await page.getByTestId('tree-draft-input').press('Enter');
        await expect.poll(() => fs.existsSync(fixtureFile(`${FOLDER}/Docs`))).toBe(true);
        await page.locator(`[data-testid=tree-row][data-path="${FOLDER}/Docs"] [data-testid=tree-row-menu]`).click();
        await page.getByTestId('tree-row-menu-new-page').click();
        await page.getByTestId('tree-draft-input').fill('Мой План Q3');
        await page.getByTestId('tree-draft-input').press('Enter');

        // assert
        await expect(page).toHaveURL(MAIN.url.edit(`${FOLDER}/Docs/Moy-Plan-Q3.md`));
        expect(fs.existsSync(fixtureFile(`${FOLDER}/Docs/Moy-Plan-Q3.md`))).toBe(true);
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

    test('an empty folder says so on its page, has no arrow in the tree, and opens there with its first file', async ({page}) => {
        // arrange
        fs.mkdirSync(fixtureFile(BLANK_FOLDER), {recursive: true});

        // act
        await page.goto(routes.dir(BLANK_FOLDER));

        // assert
        const row = page.locator(`[data-testid=tree-row][data-path="${BLANK_FOLDER}"]`);
        await expect(row).toHaveAttribute('data-empty', 'true');
        await expect(row.getByTestId('tree-twisty')).toHaveCount(0);
        await expect(row.locator('xpath=following-sibling::*[@data-testid="tree-children"]')).toHaveCount(0);
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
        await expect(row).toHaveAttribute('data-empty', 'false');
        await expect(row.getByTestId('tree-twisty')).toHaveAttribute('data-open', 'true');
        await expect(page.locator(`[data-testid=tree-row][data-path="${BLANK_FOLDER}/first.md"]`)).toBeVisible();
    });

    test('an empty folder in the tree has no arrow, unfolds nothing on a click and lines up with the rows beside it', async ({page}) => {
        // arrange
        fs.mkdirSync(fixtureFile(`${HOLLOW}/empty`), {recursive: true});
        writeFixture(`${HOLLOW}/full/note.md`, '# Note\n');
        writeFixture(`${HOLLOW}/note.md`, '# Note\n');
        await page.goto(routes.dir(HOLLOW));
        const empty = page.locator(`[data-testid=tree-row][data-path="${HOLLOW}/empty"]`);
        const full = page.locator(`[data-testid=tree-row][data-path="${HOLLOW}/full"]`);
        const note = page.locator(`[data-testid=tree-row][data-path="${HOLLOW}/note.md"]`);
        await expect(empty).toBeVisible();

        // act
        await empty.getByTestId('tree-link').click();

        // assert
        await expect(page).toHaveURL(MAIN.url.dir(`${HOLLOW}/empty`));
        await expect(empty.getByTestId('tree-empty-folder')).toHaveAttribute('data-open', 'true');
        await expect(empty).toHaveAttribute('data-empty', 'true');
        await expect(empty.getByTestId('tree-twisty')).toHaveCount(0);
        await expect(empty.locator('[aria-expanded]:not([data-testid=tree-row-menu])')).toHaveCount(0);
        await expect(full.getByTestId('tree-twisty')).toHaveAttribute('aria-expanded', /^(true|false)$/);
        await expect(empty.locator('xpath=following-sibling::*[@data-testid="tree-children"]')).toHaveCount(0);
        const starts = await Promise.all([empty, full, note].map(async (row) => {
            const icon = await row.locator('svg').first().boundingBox();
            const label = await row.getByTestId('tree-link').boundingBox();
            return [Math.round(icon.x), Math.round(label.x)];
        }));
        expect(starts).toEqual([starts[1], starts[1], starts[1]]);
        await shot(page, 'files-empty-folder-tree');
    });

    test('an empty folder opens with its first note from + and shuts when its last note goes', async ({page}) => {
        // arrange
        const folder = `${HOLLOW}/plus`;
        const first = `${folder}/first.md`;
        fs.mkdirSync(fixtureFile(folder), {recursive: true});
        await page.goto(routes.dir(HOLLOW));
        const row = page.locator(`[data-testid=tree-row][data-path="${folder}"]`);
        const children = row.locator('xpath=following-sibling::*[@data-testid="tree-children"]');

        // act & assert
        await row.hover();
        await row.getByTestId('tree-row-add').click();
        await expect(children.getByTestId('tree-draft')).toBeVisible();
        await page.getByTestId('tree-draft-input').fill('first');
        await page.getByTestId('tree-draft-input').press('Enter');
        await expect(page).toHaveURL(MAIN.url.edit(first));
        await expect(row.getByTestId('tree-twisty')).toHaveAttribute('data-open', 'true');
        await expect(children.locator(`[data-testid=tree-row][data-path="${first}"]`)).toBeVisible();

        await page.locator(`[data-testid=tree-row][data-path="${first}"] [data-testid=tree-row-menu]`).click();
        await page.getByTestId('tree-row-menu-delete').click();
        await expect.poll(() => fs.existsSync(fixtureFile(first))).toBe(false);
        await expect(row).toHaveAttribute('data-empty', 'true');
        await expect(row.getByTestId('tree-twisty')).toHaveCount(0);
        await expect(row.getByTestId('tree-empty-folder')).toHaveAttribute('data-open', 'false');
        await expect(children).toHaveCount(0);
    });

    test('a folder on screen shuts when its last note goes from the tree', async ({page}) => {
        // arrange
        const folder = `${HOLLOW}/viewed`;
        const last = `${folder}/last.md`;
        writeFixture(last, '# Last\n');
        await page.goto(routes.dir(folder));
        const row = page.locator(`[data-testid=tree-row][data-path="${folder}"]`);
        await expect(row.getByTestId('tree-twisty')).toHaveAttribute('data-open', 'true');

        // act
        await page.locator(`[data-testid=tree-row][data-path="${last}"] [data-testid=tree-row-menu]`).click();
        await page.getByTestId('tree-row-menu-delete').click();

        // assert
        await expect.poll(() => fs.existsSync(fixtureFile(last))).toBe(false);
        await expect(row).toHaveAttribute('data-empty', 'true');
        await expect(page).toHaveURL(MAIN.url.dir(folder));
        await expect(row.getByTestId('tree-empty-folder')).toHaveAttribute('data-open', 'false');
    });

    test('a folder inside a closed folder shows closed once its last note goes from its page', async ({page}) => {
        // arrange
        const outer = `${HOLLOW}/outer`;
        const folder = `${outer}/inner`;
        const last = `${folder}/last.md`;
        writeFixture(last, '# Last\n');
        await page.goto(routes.dir(folder));
        const outerRow = page.locator(`[data-testid=tree-row][data-path="${outer}"]`);
        const row = page.locator(`[data-testid=tree-row][data-path="${folder}"]`);
        await expect(row.getByTestId('tree-twisty')).toHaveAttribute('data-open', 'true');
        await outerRow.getByTestId('tree-twisty').click();
        await expect(row).toHaveCount(0);

        // act
        await page.locator(`[data-testid=dir-row][data-path="${last}"]`).click({button: 'right'});
        await page.getByTestId('tree-row-menu-delete').click();
        await expect.poll(() => fs.existsSync(fixtureFile(last))).toBe(false);
        await expect(page.locator(`[data-testid=dir-row][data-path="${last}"]`)).toHaveCount(0);
        await outerRow.getByTestId('tree-twisty').click();

        // assert
        await expect(row).toHaveAttribute('data-empty', 'true');
        await expect(row.getByTestId('tree-empty-folder')).toHaveAttribute('data-open', 'false');
    });

    test('a file dragged onto an empty folder lights it up, lands in it and opens it', async ({page}) => {
        // arrange
        const folder = `${HOLLOW}/target`;
        const dragged = `${HOLLOW}/dragged.md`;
        fs.mkdirSync(fixtureFile(folder), {recursive: true});
        writeFixture(dragged, '# Dragged\n');
        await page.goto(routes.dir(HOLLOW));
        const row = page.locator(`[data-testid=tree-row][data-path="${folder}"]`);
        await expect(row).toHaveAttribute('data-empty', 'true');
        const from = await page.locator(`[data-testid=tree-row][data-path="${dragged}"]`).boundingBox();
        const to = await row.boundingBox();

        // act
        await page.mouse.move(from.x + 60, from.y + from.height / 2);
        await page.mouse.down();
        await page.mouse.move(to.x + 60, to.y + to.height / 2, {steps: 10});

        // assert
        await expect(row).toHaveAttribute('data-drop', 'true');
        await page.mouse.up();
        await expect.poll(() => fs.existsSync(fixtureFile(`${folder}/dragged.md`))).toBe(true);
        await expect(row.getByTestId('tree-twisty')).toHaveAttribute('data-open', 'true');
        await expect(page.locator(`[data-testid=tree-row][data-path="${folder}/dragged.md"]`)).toBeVisible();
    });

    test('an empty folder on screen opens when a note is written into it from outside the page', async ({page}) => {
        // arrange
        const folder = `${HOLLOW}/outside`;
        const sibling = `${HOLLOW}/outside-sibling.md`;
        fs.mkdirSync(fixtureFile(folder), {recursive: true});
        writeFixture(sibling, '# Sibling\n');
        await page.goto(routes.dir(HOLLOW));
        const row = page.locator(`[data-testid=tree-row][data-path="${folder}"]`);
        await expect(row).toHaveAttribute('data-empty', 'true');

        // act
        writeFixture(`${folder}/note.md`, '# Note\n');
        await page.locator(`[data-testid=tree-row][data-path="${sibling}"]`).getByTestId('tree-link').click();

        // assert
        await expect(page).toHaveURL(MAIN.url.doc(sibling));
        await expect(row).toHaveAttribute('data-empty', 'false');
        await expect(row.getByTestId('tree-twisty')).toHaveAttribute('data-open', 'true');
        await expect(page.locator(`[data-testid=tree-row][data-path="${folder}/note.md"]`)).toBeVisible();
    });

    test('a click on an empty folder shows it open and the next click shows it closed, with nothing unfolding', async ({page}) => {
        // arrange
        const folder = `${HOLLOW}/flip`;
        fs.mkdirSync(fixtureFile(folder), {recursive: true});
        await page.goto(routes.dir(HOLLOW));
        const row = page.locator(`[data-testid=tree-row][data-path="${folder}"]`);
        const icon = row.getByTestId('tree-empty-folder');
        const children = row.locator('xpath=following-sibling::*[@data-testid="tree-children"]');
        await expect(icon).toHaveAttribute('data-open', 'false');
        const shut = await icon.innerHTML();

        // act & assert
        await icon.click();
        await expect(icon).toHaveAttribute('data-open', 'true');
        expect(await icon.innerHTML()).not.toBe(shut);
        await expect(children).toHaveCount(0);
        await expect(page).toHaveURL(MAIN.url.dir(HOLLOW));

        await icon.click();
        await expect(icon).toHaveAttribute('data-open', 'false');
        expect(await icon.innerHTML()).toBe(shut);

        await row.getByTestId('tree-link').click();
        await expect(page).toHaveURL(MAIN.url.dir(folder));
        await expect(icon).toHaveAttribute('data-open', 'true');
        await row.getByTestId('tree-link').click();
        await expect(icon).toHaveAttribute('data-open', 'false');
        await expect(children).toHaveCount(0);
    });

    test('the icon of an empty folder is a toggle that says the state it shows, with no aria-expanded', async ({page}) => {
        // arrange
        const name = 'toggled';
        const folder = `${HOLLOW}/${name}`;
        fs.mkdirSync(fixtureFile(folder), {recursive: true});
        await page.goto(routes.dir(HOLLOW));
        const icon = page.locator(`[data-testid=tree-row][data-path="${folder}"]`).getByTestId('tree-empty-folder');
        const state = () => icon.evaluate((button) => ({
            open: button.dataset.open,
            pressed: button.getAttribute('aria-pressed'),
            label: button.getAttribute('aria-label'),
            expanded: button.getAttribute('aria-expanded'),
        }));
        await expect.poll(state).toEqual({open: 'false', pressed: 'false', label: `Open ${name}`, expanded: null});

        // act
        await icon.click();

        // assert
        await expect.poll(state).toEqual({open: 'true', pressed: 'true', label: `Close ${name}`, expanded: null});
    });

    test('an empty folder keeps its closed folder icon under the pointer, with no chevron', async ({page}) => {
        // arrange
        const folder = `${HOLLOW}/hovered`;
        fs.mkdirSync(fixtureFile(folder), {recursive: true});
        await page.goto(routes.dir(HOLLOW));
        const row = page.locator(`[data-testid=tree-row][data-path="${folder}"]`);
        const icon = row.getByTestId('tree-link').locator('xpath=preceding-sibling::*').locator('svg');
        await expect(icon).toHaveCount(1);
        const resting = await icon.innerHTML();

        // act
        await row.hover();

        // assert
        await expect(icon).toHaveCount(1);
        await expect(icon).toBeVisible();
        expect(await icon.innerHTML()).toBe(resting);
        await expect(row.getByTestId('tree-twisty')).toHaveCount(0);
    });

    test('a folder that holds only a picture counts as empty in the tree', async ({page}) => {
        // arrange
        const folder = `${HOLLOW}/pictures`;
        fs.mkdirSync(fixtureFile(folder), {recursive: true});
        fs.writeFileSync(fixtureFile(`${folder}/picture.png`), 'not really a picture');

        // act
        await page.goto(routes.dir(HOLLOW));

        // assert
        const row = page.locator(`[data-testid=tree-row][data-path="${folder}"]`);
        await expect(row).toHaveAttribute('data-empty', 'true');
        await expect(row.getByTestId('tree-twisty')).toHaveCount(0);
        await expect(row.locator('xpath=following-sibling::*[@data-testid="tree-children"]')).toHaveCount(0);
    });

    test('an empty folder the filter finds has no arrow and nothing under it', async ({page}) => {
        // arrange
        const folder = `${HOLLOW}/zzfilteredempty`;
        fs.mkdirSync(fixtureFile(folder), {recursive: true});
        await page.goto(routes.dir(HOLLOW));

        // act
        await page.getByTestId('sidebar-filter').fill('zzfilteredempty');

        // assert
        const row = page.locator(`[data-testid=tree-row][data-path="${folder}"]`);
        await expect(row).toBeVisible();
        await expect(row).toHaveAttribute('data-empty', 'true');
        await expect(row.getByTestId('tree-twisty')).toHaveCount(0);
        await expect(row.locator('xpath=following-sibling::*[@data-testid="tree-children"]')).toHaveCount(0);
    });

    test('an empty folder the filter finds shows it open and closed on clicks on its icon', async ({page}) => {
        // arrange
        const folder = `${HOLLOW}/zzfilteredflip`;
        fs.mkdirSync(fixtureFile(folder), {recursive: true});
        await page.goto(routes.dir(HOLLOW));
        await page.getByTestId('sidebar-filter').fill('zzfilteredflip');
        const icon = page.locator(`[data-testid=tree-row][data-path="${folder}"]`).getByTestId('tree-empty-folder');
        await expect(icon).toHaveAttribute('data-open', 'false');

        // act & assert
        await icon.click();
        await expect(icon).toHaveAttribute('data-open', 'true');
        await icon.click();
        await expect(icon).toHaveAttribute('data-open', 'false');
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
        await page.waitForTimeout(FOCUS_RETURN_WAIT);
        await expect(page.getByTestId('tree-draft-input')).toBeFocused();
        await expect(page.getByTestId('dir-draft')).toHaveCount(0);
        await page.getByTestId('tree-draft-input').press('Escape');
    });

    test('a right click on a row of a folder list opens its menu at the pointer, and Rename names the row in place', async ({page}) => {
        // arrange
        writeFixture(CONTEXT_NOTE, '# Note\n');
        await page.goto(routes.dir(CONTEXT_FOLDER));
        const row = page.locator(`[data-testid=dir-row][data-path="${CONTEXT_NOTE}"]`);
        const box = await row.boundingBox();
        const at = {x: box.x + box.width / 2, y: box.y + box.height / 2};

        // act
        await page.mouse.click(at.x, at.y, {button: 'right'});

        // assert
        const menu = page.getByTestId('tree-row-menu-dropdown');
        await expect(menu).toBeVisible();
        await expect(row).toHaveAttribute('data-menu', 'true');
        await expect(page.getByTestId('dir-context-menu')).toHaveCount(0);
        await expect(page.getByTestId('tree-row-menu-new-page')).toHaveCount(0);
        await expect(page.getByTestId('tree-row-menu-new-folder')).toHaveCount(0);
        await expect(page).toHaveURL(MAIN.url.dir(CONTEXT_FOLDER));
        const placed = await menu.boundingBox();
        expect(Math.round(placed.x)).toBe(Math.round(at.x));
        expect(placed.y).toBeGreaterThan(at.y);
        await shot(page, 'files-list-row-menu');

        await page.getByTestId('tree-row-menu-rename').click();
        const input = page.getByTestId('dir-rename-input');
        await expect(input).toHaveValue(nameOf(CONTEXT_NOTE));
        await expect(input).toBeFocused();
        await expect(page.getByTestId('tree-rename')).toHaveCount(0);
        await shot(page, 'files-list-rename');
        await input.click();
        await expect(page).toHaveURL(MAIN.url.dir(CONTEXT_FOLDER));
        await input.press('Escape');
        await expect(page.getByTestId('dir-rename-field')).toHaveCount(0);
        expect(fs.existsSync(fixtureFile(CONTEXT_NOTE))).toBe(true);
    });

    test('Enter in the name cell of a folder list renames the row', async ({page}) => {
        // arrange
        const note = `${CONTEXT_FOLDER}/listed.md`;
        const renamed = `${CONTEXT_FOLDER}/listed-renamed.md`;
        writeFixture(note, '# Listed\n');
        await page.goto(routes.dir(CONTEXT_FOLDER));
        await startListRename(page, note);

        // act
        await page.getByTestId('dir-rename-input').fill(nameOf(renamed));
        await page.getByTestId('dir-rename-input').press('Enter');

        // assert
        await expect(page.locator(`[data-testid=dir-row][data-path="${renamed}"] [data-testid=dir-row-name]`)).toHaveText(nameOf(renamed));
        await expect(page.getByTestId('dir-rename-field')).toHaveCount(0);
        await expect(page).toHaveURL(MAIN.url.dir(CONTEXT_FOLDER));
        expect([note, renamed].map((path) => fs.existsSync(fixtureFile(path)))).toEqual([false, true]);
        removeFixture(renamed);
    });

    test('a right click in the field of a row being renamed keeps the browser menu, and one on its size while it saves opens none', async ({page}) => {
        // arrange
        const note = `${CONTEXT_FOLDER}/right-click.md`;
        const renamed = `${CONTEXT_FOLDER}/right-clicked.md`;
        writeFixture(note, '# Right click\n');
        await page.goto(routes.dir(CONTEXT_FOLDER));
        const row = page.locator(`[data-testid=dir-row][data-path="${note}"]`);
        const input = page.getByTestId('dir-rename-input');
        await startListRename(page, note);

        // act & assert
        expect(await rightClickPrevented(page, input)).toBe(false);
        await expect(page.locator('[data-testid=tree-row-menu-dropdown]:visible')).toHaveCount(0);
        await input.fill(nameOf(renamed));
        const release = await holdRoute(page, '**/api/move');
        expect(await rightClickPrevented(page, row.locator('td').nth(1))).toBe(true);
        await expect(page.getByTestId('dir-rename-field')).toBeVisible();
        await expect(page.getByTestId('dir-context-menu')).toHaveCount(0);
        await expect(page.locator('[data-testid=tree-row-menu-dropdown]:visible')).toHaveCount(0);
        release();
        await expect.poll(() => fs.existsSync(fixtureFile(renamed))).toBe(true);
        removeFixture(renamed);
    });

    test('a click outside the new row of a folder list keeps a typed name and drops an empty one', async ({page}) => {
        // arrange
        await page.goto(routes.dir(BLANK_FOLDER));
        const draft = page.getByTestId('dir-draft');

        // act & assert
        await page.getByTestId('dir-new').click();
        await page.getByTestId('dir-new-folder').click();
        await page.getByTestId('dir-draft-input').fill('kept');
        await page.getByTestId('dir-title').click();
        await expect(draft).toBeVisible();
        await expect(page.getByTestId('dir-draft-input')).toHaveValue('kept');

        await page.getByTestId('dir-draft-input').fill('');
        await page.getByTestId('dir-title').click();
        await expect(draft).toHaveCount(0);
        expect(fs.existsSync(fixtureFile(`${BLANK_FOLDER}/kept`))).toBe(false);
    });

    test('a right click on a second row while the menu of the first is open moves the menu to it', async ({page}) => {
        // arrange
        const second = `${CONTEXT_FOLDER}/second.md`;
        writeFixture(CONTEXT_NOTE, '# Note\n');
        writeFixture(second, '# Second\n');
        await page.goto(routes.dir(CONTEXT_FOLDER));
        const first = page.locator(`[data-testid=dir-row][data-path="${CONTEXT_NOTE}"]`);
        const next = page.locator(`[data-testid=dir-row][data-path="${second}"]`);
        await first.click({button: 'right', position: {x: 40, y: 10}});
        await expect(first).toHaveAttribute('data-menu', 'true');
        const box = await next.boundingBox();

        // act
        await next.click({button: 'right', position: {x: box.width - 40, y: box.height / 2}, force: true});

        // assert
        await expect(page.getByTestId('tree-row-menu-dropdown')).toHaveCount(1);
        await expect(next).toHaveAttribute('data-menu', 'true');
        await expect(first).toHaveAttribute('data-menu', 'false');
        await page.getByTestId('tree-row-menu-rename').click();
        await expect(page.getByTestId('dir-rename-input')).toHaveValue(nameOf(second));
        await page.getByTestId('dir-rename-input').press('Escape');
    });

    test('a right click on the free space of a folder list offers to create there', async ({page}) => {
        // arrange
        writeFixture(CONTEXT_NOTE, '# Note\n');
        await page.goto(routes.dir(CONTEXT_FOLDER));
        await expect(page.locator(`[data-testid=dir-row][data-path="${CONTEXT_NOTE}"]`)).toBeVisible();
        const viewport = page.viewportSize();

        // act
        await page.mouse.click(viewport.width / 2, viewport.height - 20, {button: 'right'});

        // assert
        await expect(page.getByTestId('dir-context-menu')).toBeVisible();
        await expect(page.getByTestId('tree-row-menu-dropdown')).toHaveCount(0);
        await page.getByTestId('dir-context-menu-new-folder').click();
        await expect(page.getByTestId('dir-draft')).toHaveAttribute('data-entry', 'dir');
        await page.getByTestId('dir-draft-input').fill('made');
        await page.getByTestId('dir-draft-input').press('Enter');
        await expect.poll(() => fs.existsSync(fixtureFile(`${CONTEXT_FOLDER}/made`))).toBe(true);
    });

    test('New file in the free space menu of a folder list names the file in a row of the table', async ({page}) => {
        // arrange
        writeFixture(CONTEXT_NOTE, '# Note\n');
        await page.goto(routes.dir(CONTEXT_FOLDER));
        await expect(page.locator(`[data-testid=dir-row][data-path="${CONTEXT_NOTE}"]`)).toBeVisible();
        const viewport = page.viewportSize();
        await page.mouse.click(viewport.width / 2, viewport.height - 20, {button: 'right'});

        // act
        await page.getByTestId('dir-context-menu-new-file').click();

        // assert
        await expect(page.getByTestId('dir-draft')).toHaveAttribute('data-entry', 'file');
        await expect(page.getByTestId('tree-draft')).toHaveCount(0);
        await page.getByTestId('dir-draft-input').fill('made-file');
        await page.getByTestId('dir-draft-input').press('Enter');
        await expect(page).toHaveURL(new RegExp(`${routes.edit(`${CONTEXT_FOLDER}/made-file.md`)}$`));
    });

    test('a right click on a link, a button, a field or selected text of a folder list keeps the browser menu', async ({page}) => {
        // arrange
        const inner = `${CONTEXT_FOLDER}/inner`;
        writeFixture(CONTEXT_NOTE, '# Note\n');
        fs.mkdirSync(fixtureFile(inner), {recursive: true});
        await page.goto(routes.dir(inner));
        await expect(page.getByTestId('dir-up')).toBeVisible();
        const appMenu = page.getByTestId('dir-context-menu');

        // act & assert
        expect(await rightClickPrevented(page, page.getByTestId('dir-up').locator('a'))).toBe(false);
        await expect(appMenu).toHaveCount(0);

        await page.getByTestId('dir-empty-new-file').click();
        expect(await rightClickPrevented(page, page.getByTestId('dir-draft-input'))).toBe(false);
        await expect(appMenu).toHaveCount(0);
        await page.getByTestId('dir-draft-input').press('Escape');

        await page.goto(routes.dir(CONTEXT_FOLDER));
        expect(await rightClickPrevented(page, page.getByTestId('dir-add-row'))).toBe(false);
        await expect(appMenu).toHaveCount(0);

        await page.getByTestId('dir-title').selectText();
        expect(await rightClickPrevented(page, page.getByTestId('dir-title'))).toBe(false);
        await expect(appMenu).toHaveCount(0);
    });

    test('a right click on the free space of the tree offers to create in the root', async ({page}) => {
        // arrange
        writeFixture(CONTEXT_NOTE, '# Note\n');
        await page.goto(routes.dir(CONTEXT_FOLDER));
        await expect(page.locator(`[data-testid=tree-row][data-path="${CONTEXT_NOTE}"]`)).toBeVisible();
        await page.getByTestId('tree-root').evaluate((root) => {
            root.closest('.mantine-ScrollArea-viewport').scrollTop = root.scrollHeight;
        });
        const tree = await page.getByTestId('tree-root').boundingBox();

        // act
        await page.mouse.click(tree.x + tree.width / 2, tree.y + tree.height - 10, {button: 'right'});

        // assert
        await expect(page.getByTestId('tree-context-menu')).toBeVisible();
        await expect(page.getByTestId('tree-row-menu-dropdown')).toHaveCount(0);
        await page.getByTestId('tree-context-menu-new-folder').click();
        await expect(page.getByTestId('tree-draft')).toHaveAttribute('data-entry', 'dir');
        await page.getByTestId('tree-draft-input').fill(CONTEXT_ROOT_FOLDER);
        await page.getByTestId('tree-draft-input').press('Enter');
        await expect.poll(() => fs.existsSync(fixtureFile(CONTEXT_ROOT_FOLDER))).toBe(true);
        expect(fs.existsSync(fixtureFile(`${CONTEXT_FOLDER}/${CONTEXT_ROOT_FOLDER}`))).toBe(false);
    });

    test('a right click on the empty space under the last row of the tree opens its menu too', async ({page}) => {
        // arrange
        await page.setViewportSize({width: 1280, height: 2400});
        await page.goto(routes.dir(CONTEXT_FOLDER));
        const rows = page.getByTestId('tree-row');
        await expect(rows.first()).toBeVisible();
        const last = await rows.last().boundingBox();
        const area = await page.locator('[data-testid=sidebar] .mantine-ScrollArea-viewport').boundingBox();
        const below = area.y + area.height - 20;
        expect(below).toBeGreaterThan(last.y + last.height + 40);

        // act
        await page.mouse.click(area.x + area.width / 2, below, {button: 'right'});

        // assert
        await expect(page.getByTestId('tree-context-menu')).toBeVisible();
    });

    test('a row dropped on the empty space under the last row of the tree moves into the root', async ({page}) => {
        // arrange
        const note = `${CONTEXT_FOLDER}/${DROPPED_TO_ROOT}`;
        writeFixture(note, '# Dropped\n');
        await page.setViewportSize({width: 1280, height: 2400});
        await page.goto(routes.dir(CONTEXT_FOLDER));
        const row = page.locator(`[data-testid=tree-row][data-path="${note}"]`);
        await expect(row).toBeVisible();
        const last = await page.getByTestId('tree-row').last().boundingBox();
        const area = page.locator('[data-testid=sidebar] .mantine-ScrollArea-viewport');
        const box = await area.boundingBox();
        const below = box.height - 20;
        expect(box.y + below).toBeGreaterThan(last.y + last.height + 40);

        // act
        await row.dragTo(area, {targetPosition: {x: box.width / 2, y: below}});

        // assert
        await expect.poll(() => fs.existsSync(fixtureFile(DROPPED_TO_ROOT))).toBe(true);
        expect(fs.existsSync(fixtureFile(note))).toBe(false);
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
        await expect(page.locator('[data-testid=toast][data-kind="ok"]')).toContainText(`Deleted "${FULL_FOLDER}"`);
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
        await expect(page.locator('[data-testid=toast][data-kind="ok"]')).toContainText(`Deleted "${JUNK_FOLDER}"`);
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

    test('Undo after a delete says nothing was restored when something took the place since', async ({page}) => {
        // arrange
        const note = `${UNDO_FOLDER}/deleted.md`;
        writeFixture(note, '# Deleted\n');
        await page.goto(routes.dir(UNDO_FOLDER));
        await page.locator(`[data-testid=tree-row][data-path="${note}"] [data-testid=tree-row-menu]`).click();
        await page.getByTestId('tree-row-menu-delete').click();
        await expect.poll(() => fs.existsSync(fixtureFile(note))).toBe(false);
        writeFixture(note, '# Written since\n');

        // act
        await page.getByTestId('toast-action').click();

        // assert
        const failed = page.locator('[data-testid=toast][data-kind="error"]');
        await expect(failed).toContainText('Nothing was restored');
        await expect(failed).toContainText('Something of that name is there now');
        expect(fs.readFileSync(fixtureFile(note), 'utf8')).toBe('# Written since\n');
    });

    test('a failed Undo after a delete keeps its toast, and Undo again restores once the place is free', async ({page}) => {
        // arrange
        const note = `${UNDO_FOLDER}/retried.md`;
        writeFixture(note, '# Retried\n');
        await page.goto(routes.dir(UNDO_FOLDER));
        await page.locator(`[data-testid=tree-row][data-path="${note}"] [data-testid=tree-row-menu]`).click();
        await page.getByTestId('tree-row-menu-delete').click();
        await expect.poll(() => fs.existsSync(fixtureFile(note))).toBe(false);
        writeFixture(note, '# Written since\n');
        await page.getByTestId('toast-action').click();
        await expect(page.locator('[data-testid=toast][data-kind="error"]')).toContainText('Nothing was restored');

        // act
        fs.rmSync(fixtureFile(note));
        await page.getByTestId('toast-action').click();

        // assert
        await expect(page.locator('[data-testid=toast][data-kind="ok"]').filter({hasText: 'Restored "retried.md"'})).toHaveCount(1);
        await expect(page.getByTestId('toast-action')).toHaveCount(0);
        expect(fs.readFileSync(fixtureFile(note), 'utf8')).toBe('# Retried\n');
    });

    test('Undo after a move says nothing was moved back when something took the old place', async ({page}) => {
        // arrange
        const note = `${UNDO_FOLDER}/moved.md`;
        const into = `${UNDO_FOLDER}/into`;
        writeFixture(note, '# Moved\n');
        fs.mkdirSync(fixtureFile(into), {recursive: true});
        await openMoveFromNoteMenu(page, note);
        await page.getByTestId('move-input').fill('into');
        await page.locator(`[data-testid=move-place][data-path="${into}"]`).click();
        await expect(page).toHaveURL(MAIN.url.doc(`${into}/moved.md`));
        writeFixture(note, '# Written since\n');

        // act
        await page.getByTestId('toast-action').click();

        // assert
        const failed = page.locator('[data-testid=toast][data-kind="error"]');
        await expect(failed).toContainText('Nothing was moved back');
        await expect(failed).toContainText('Something of that name is already there');
        await expect(page).toHaveURL(MAIN.url.doc(`${into}/moved.md`));
        expect([note, `${into}/moved.md`].map((p) => fs.readFileSync(fixtureFile(p), 'utf8')))
            .toEqual(['# Written since\n', '# Moved\n']);
    });

    test('a move and its Undo that were not pushed say so in a warning toast', async ({page}) => {
        // arrange
        const note = `${UNDO_FOLDER}/unpushed.md`;
        const into = `${UNDO_FOLDER}/into-unpushed`;
        writeFixture(note, '# Unpushed\n');
        fs.mkdirSync(fixtureFile(into), {recursive: true});
        await page.route('**/api/move', async (route) => {
            const res = await route.fetch();
            await route.fulfill({response: res, json: {...await res.json(), unpublished: true}});
        });
        await openMoveFromNoteMenu(page, note);
        await page.getByTestId('move-input').fill('into-unpushed');

        // act & assert
        await page.locator(`[data-testid=move-place][data-path="${into}"]`).click();
        const warned = page.locator('[data-testid=toast][data-kind="warn"]');
        await expect(warned.filter({hasText: 'Moved "unpushed.md" to'})).toContainText('Not pushed to the remote');
        await page.getByTestId('toast-action').click();
        await expect(warned.filter({hasText: 'Moved "unpushed.md" back'})).toContainText('Not pushed to the remote');
        await expect(page.locator('[data-testid=toast][data-kind="ok"]')).toHaveCount(0);
        await page.unroute('**/api/move');
    });

    test('a failed Undo after a move keeps its toast, and Undo again moves it back once the place is free', async ({page}) => {
        // arrange
        const note = `${UNDO_FOLDER}/moved-again.md`;
        const into = `${UNDO_FOLDER}/into-again`;
        writeFixture(note, '# Moved\n');
        fs.mkdirSync(fixtureFile(into), {recursive: true});
        await openMoveFromNoteMenu(page, note);
        await page.getByTestId('move-input').fill('into-again');
        await page.locator(`[data-testid=move-place][data-path="${into}"]`).click();
        await expect(page).toHaveURL(MAIN.url.doc(`${into}/moved-again.md`));
        writeFixture(note, '# Written since\n');
        await page.getByTestId('toast-action').click();
        await expect(page.locator('[data-testid=toast][data-kind="error"]')).toContainText('Nothing was moved back');

        // act
        fs.rmSync(fixtureFile(note));
        await page.getByTestId('toast-action').click();

        // assert
        await expect(page.locator('[data-testid=toast][data-kind="ok"]').filter({hasText: 'Moved "moved-again.md" back'}))
            .toHaveCount(1);
        await expect(page.getByTestId('toast-action')).toHaveCount(0);
        await expect(page).toHaveURL(MAIN.url.doc(note));
        expect([note, `${into}/moved-again.md`].map((p) => fs.existsSync(fixtureFile(p)))).toEqual([true, false]);
    });

    test('Undo after dragging two rows moves both back', async ({page}) => {
        // arrange
        const names = ['first.md', 'second.md'];
        const pair = `${UNDO_FOLDER}/pair`;
        const into = `${UNDO_FOLDER}/pair-drop`;
        for (const name of names) {
            writeFixture(`${pair}/${name}`, '# Dragged\n');
        }
        fs.mkdirSync(fixtureFile(into), {recursive: true});
        await page.goto(routes.dir(pair));
        const rows = names.map((name) => `[data-testid=tree-row][data-path="${pair}/${name}"]`);
        await page.locator(`${rows[0]} [data-testid=tree-link]`).click();
        await page.locator(`${rows[1]} [data-testid=tree-link]`).click({modifiers: ['Shift']});
        await page.locator(rows[1]).dragTo(page.locator(`[data-testid=tree-row][data-path="${into}"]`));
        await expect(page.locator('[data-testid=toast][data-kind="ok"]')).toContainText(text.toast.movedMany);

        // act
        await page.getByTestId('toast-action').click();

        // assert
        await expect(page.locator('[data-testid=toast][data-kind="ok"]').filter({hasText: 'Moved 2 items back'})).toHaveCount(1);
        for (const name of names) {
            await expect.poll(() => fs.existsSync(fixtureFile(`${pair}/${name}`))).toBe(true);
            expect(fs.existsSync(fixtureFile(`${into}/${name}`))).toBe(false);
        }
    });

    test('Undo after a move moves nothing back once the note was deleted and another took its new place', async ({page}) => {
        // arrange
        const note = `${UNDO_FOLDER}/replaced.md`;
        const into = `${UNDO_FOLDER}/into-replaced`;
        const moved = `${into}/replaced.md`;
        writeFixture(note, '# Moved\n');
        fs.mkdirSync(fixtureFile(into), {recursive: true});
        await openMoveFromNoteMenu(page, note);
        await page.getByTestId('move-input').fill('into-replaced');
        await page.locator(`[data-testid=move-place][data-path="${into}"]`).click();
        await expect(page).toHaveURL(MAIN.url.doc(moved));
        await page.locator(`[data-testid=tree-row][data-path="${moved}"] [data-testid=tree-row-menu]`).click();
        await page.getByTestId('tree-row-menu-delete').click();
        await expect.poll(() => fs.existsSync(fixtureFile(moved))).toBe(false);
        writeFixture(moved, '# Replacement\n');
        const moveToast = page.locator('[data-testid=toast]').filter({hasText: 'Moved "replaced.md" to'});

        // act
        await moveToast.getByTestId('toast-action').click();

        // assert
        const failed = page.locator('[data-testid=toast][data-kind="error"]');
        await expect(failed).toContainText('Nothing was moved back');
        await expect(failed).toContainText('It was renamed, moved or deleted since');
        await expect(moveToast).toHaveCount(0);
        expect([note, moved].map((p) => fs.existsSync(fixtureFile(p)))).toEqual([false, true]);
        expect(fs.readFileSync(fixtureFile(moved), 'utf8')).toBe('# Replacement\n');
    });

    test('Undo after a move moves nothing back once another note took its new place outside this tab', async ({page}) => {
        // arrange
        const note = `${UNDO_FOLDER}/swapped.md`;
        const into = `${UNDO_FOLDER}/into-swapped`;
        const moved = `${into}/swapped.md`;
        writeFixture(note, '# Moved\n');
        fs.mkdirSync(fixtureFile(into), {recursive: true});
        await openMoveFromNoteMenu(page, note);
        await page.getByTestId('move-input').fill('into-swapped');
        const recorded = page.waitForResponse((res) => res.url().endsWith(`/api/dir/${into}`));
        await page.locator(`[data-testid=move-place][data-path="${into}"]`).click();
        await expect(page).toHaveURL(MAIN.url.doc(moved));
        await recorded;
        fs.rmSync(fixtureFile(moved));
        writeFixture(moved, '# Another note\n');
        const moveToast = page.locator('[data-testid=toast]').filter({hasText: 'Moved "swapped.md" to'});

        // act
        await moveToast.getByTestId('toast-action').click();

        // assert
        const failed = page.locator('[data-testid=toast][data-kind="error"]');
        await expect(failed).toContainText('Nothing was moved back');
        await expect(failed).toContainText('It was renamed, moved or deleted since');
        expect([note, moved].map((p) => fs.existsSync(fixtureFile(p)))).toEqual([false, true]);
        expect(fs.readFileSync(fixtureFile(moved), 'utf8')).toBe('# Another note\n');
    });

    test('Undo after dragging two rows stops before a row deleted and replaced while it runs', async ({page}) => {
        // arrange
        const names = ['first.md', 'second.md'];
        const pair = `${UNDO_FOLDER}/held`;
        const into = `${UNDO_FOLDER}/held-drop`;
        for (const name of names) {
            writeFixture(`${pair}/${name}`, '# Dragged\n');
        }
        fs.mkdirSync(fixtureFile(into), {recursive: true});
        await page.goto(routes.dir(pair));
        const rows = names.map((name) => `[data-testid=tree-row][data-path="${pair}/${name}"]`);
        await page.locator(`${rows[0]} [data-testid=tree-link]`).click();
        await page.locator(`${rows[1]} [data-testid=tree-link]`).click({modifiers: ['Shift']});
        await page.locator(rows[1]).dragTo(page.locator(`[data-testid=tree-row][data-path="${into}"]`));
        const moveToast = page.locator('[data-testid=toast]').filter({hasText: text.toast.movedMany});
        await expect(moveToast).toHaveCount(1);
        const replaced = `${into}/${names[0]}`;
        let release = () => {};
        const held = new Promise((resolve) => {
            release = resolve;
        });
        let reach = () => {};
        const reached = new Promise((resolve) => {
            reach = resolve;
        });
        await page.route('**/api/move', async (route) => {
            if (route.request().postDataJSON().from === `${into}/${names[1]}`) {
                reach();
                await held;
            }
            await route.continue();
        });

        // act
        await moveToast.getByTestId('toast-action').click();
        await reached;
        await page.locator(`[data-testid=tree-row][data-path="${replaced}"] [data-testid=tree-row-menu]`).click();
        await page.getByTestId('tree-row-menu-delete').click();
        await expect.poll(() => fs.existsSync(fixtureFile(replaced))).toBe(false);
        writeFixture(replaced, '# Replacement\n');
        release();

        // assert
        const failed = page.locator('[data-testid=toast][data-kind="error"]');
        await expect(failed).toContainText('Some of it did not move back');
        await expect(failed).toContainText('It was renamed, moved or deleted since');
        await expect.poll(() => fs.existsSync(fixtureFile(`${pair}/${names[1]}`))).toBe(true);
        expect([`${pair}/${names[0]}`, replaced].map((p) => fs.existsSync(fixtureFile(p)))).toEqual([false, true]);
        expect(fs.readFileSync(fixtureFile(replaced), 'utf8')).toBe('# Replacement\n');
        await page.unroute('**/api/move');
    });

    test('the toast of a move names a folder whose name ends in .md by its whole name', async ({page}) => {
        // arrange
        const folder = `${UNDO_FOLDER}/dotted.md`;
        const into = `${UNDO_FOLDER}/into-dotted`;
        writeFixture(`${folder}/note.md`, '# Inside\n');
        fs.mkdirSync(fixtureFile(into), {recursive: true});
        await page.goto(routes.dir(UNDO_FOLDER));
        await page.locator(`[data-testid=tree-row][data-path="${folder}"] [data-testid=tree-row-menu]`).click();
        await page.getByTestId('tree-row-menu-move').click();
        await page.getByTestId('move-input').fill('into-dotted');

        // act
        await page.locator(`[data-testid=move-place][data-path="${into}"]`).click();

        // assert
        await expect(page.locator('[data-testid=toast][data-kind="ok"]'))
            .toContainText('Moved "dotted.md" to "into-dotted"');
        await expect.poll(() => fs.existsSync(fixtureFile(`${into}/dotted.md/note.md`))).toBe(true);
    });

    test('every row of the tree keeps 1px under it, a nested one too', async ({page}) => {
        // arrange
        for (const name of ['a.md', 'b.md', 'c.md']) {
            writeFixture(`${GAP_FOLDER}/${name}`, '# Gap\n');
        }

        // act
        await page.goto(routes.dir(GAP_FOLDER));

        // assert
        await expect(page.locator(`[data-testid=tree-row][data-path="${GAP_FOLDER}/c.md"]`)).toBeVisible();
        const gaps = await page.getByTestId('tree-row').evaluateAll((rows, folder) => {
            const at = rows.findIndex((row) => row.dataset.path === folder);
            const run = rows.slice(at, at + 5).map((row) => row.getBoundingClientRect());
            return run.slice(1).map((box, index) => Math.round(box.top - run[index].bottom));
        }, GAP_FOLDER);
        expect(gaps).toEqual([1, 1, 1, 1]);
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
