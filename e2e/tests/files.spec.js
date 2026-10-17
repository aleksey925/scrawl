const {expect, test} = require('../support/test');

const fs = require('fs');

const {
    MAIN, atHome, fixtureFile, routes, save, setSource, shot, signIn,
} = require('../support/helpers');
const text = require('../support/text');

const FOLDER = 'e2e-fm';
const OTHER = 'e2e-fm-other';
const PAGE = `${FOLDER}/testovaya-stranitsa.md`;
const RENAMED = `${FOLDER}/pereimenovannaya.md`;
const DRAGGED = ['e2e-drag-one.md', 'e2e-drag-two.md'];
const ROOT_PAGE = 'e2e-root-page.md';
const BLANK_FOLDER = 'e2e-fm-blank';
const BLANK_PAGE = 'e2e-blank-page.md';
const FULL_FOLDER = 'e2e-fm-full';
const JUNK_FOLDER = 'e2e-fm-junk';

test.describe.serial('file management', () => {
    test.beforeEach(async ({page}) => {
        await signIn(page);
    });

    test.afterAll(() => {
        for (const folder of [FOLDER, OTHER, BLANK_FOLDER, FULL_FOLDER, JUNK_FOLDER]) {
            fs.rmSync(fixtureFile(folder), {recursive: true, force: true});
        }
        for (const name of [...DRAGGED, ROOT_PAGE, BLANK_PAGE]) {
            fs.rmSync(fixtureFile(name), {force: true});
        }
    });

    test('creates a folder where the tree stands, with no dialog in the way', async ({page}) => {
        await page.getByTestId('sidebar-new').click();
        await page.getByTestId('sidebar-new-folder').click();
        // the row is typed in place: there is no dialog, and the input sits
        // where the folder is about to be
        await expect(page.getByTestId('tree-draft')).toHaveAttribute('data-entry', 'dir');
        await expect(page.locator('[data-testid=modal][data-variant="create"]')).toHaveCount(0);
        // the caret is already in it, so the name is the next thing typed
        await expect(page.getByTestId('tree-draft-input')).toBeFocused();
        await shot(page, 'files-new-folder-draft');

        await page.getByTestId('tree-draft-input').fill(FOLDER);
        await page.getByTestId('tree-draft-input').press('Enter');

        await expect(page.locator('[data-testid=toast][data-kind="ok"]')).toContainText(text.toast.folderCreated);
        expect(fs.statSync(fixtureFile(FOLDER)).isDirectory()).toBe(true);
        // a folder is where a page is created, so it is on the tree before it holds one
        await expect(page.locator(`[data-testid=tree-row][data-path="${FOLDER}"]`)).toHaveCount(1);
        await expect(page.getByTestId('tree-draft')).toHaveCount(0);

        // the new folder is where the reader is now, so the next entry goes
        // into it and not beside it
        await expect(page).toHaveURL(MAIN.url.dir(FOLDER));
        await expect(page.locator('[data-testid=tree-row][data-current="true"]')).toHaveAttribute('data-path', FOLDER);
        await expect(page.getByTestId('dir-empty-title')).toHaveText(text.dir.empty);
        await page.getByTestId('sidebar-new').click();
        await expect(page.getByTestId('sidebar-new-where')).toContainText(FOLDER);
        await page.keyboard.press('Escape');
        await shot(page, 'files-folder-created');
    });

    // the space has a row of its own, and it is the only thing that makes the
    // root a place a reader can point at
    test('creates a file in the root from the space row', async ({page}) => {
        const row = page.locator('[data-testid=tree-row][data-path=""]');
        await expect(page.locator('[data-testid=tree-row]').first()).toHaveAttribute('data-path', '');
        await row.locator('[data-testid=tree-row-menu]').click();
        await page.getByTestId('tree-row-menu-new-page').click();

        await page.getByTestId('tree-draft-input').fill(ROOT_PAGE.replace('.md', ''));
        await page.getByTestId('tree-draft-input').press('Enter');

        await expect(page).toHaveURL(MAIN.url.edit(ROOT_PAGE));
        expect(fs.existsSync(fixtureFile(ROOT_PAGE))).toBe(true);
        await expect(page.locator(`[data-testid=tree-row][data-path="${ROOT_PAGE}"]`)).toHaveCount(1);
        await shot(page, 'files-root-page');
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
        // the row stays open with the name in it, so a second try is one edit
        await expect(page.getByTestId('tree-draft-input')).toHaveValue('Тестовая страница');
        await shot(page, 'files-duplicate-page');
        await page.getByTestId('tree-draft-input').press('Escape');
        await expect(page.getByTestId('tree-draft')).toHaveCount(0);
    });

    // a folder with files in it used to be refused with an error after the
    // reader had already confirmed; now the question itself says what goes
    test('asks before deleting a folder that is not empty, and Cancel keeps it', async ({page}) => {
        // arrange
        await page.goto(routes.doc(PAGE));

        // act
        await page.locator(`[data-testid=tree-row][data-path="${FOLDER}"] [data-testid=tree-row-menu]`).click();
        await page.getByTestId('tree-row-menu-delete').click();

        // assert
        await expect(page.locator('.mantine-Modal-title')).toHaveText(text.modal.deleteFolderContents);
        await expect(page.locator('[data-testid=modal][data-variant="confirm-contents"]')).toContainText(FOLDER);
        await shot(page, 'files-folder-not-empty');
        await page.getByTestId('modal-cancel').click();
        await expect(page.locator('.mantine-Modal-title')).toHaveCount(0);
        expect(fs.existsSync(fixtureFile(PAGE))).toBe(true);
    });

    test('renames a page from the tree menu', async ({page}) => {
        await page.goto(routes.doc(PAGE));
        await page.locator(`[data-testid=tree-row][data-path="${PAGE}"] [data-testid=tree-row-menu]`).click();
        const menu = page.getByTestId('tree-row-menu-dropdown');
        await expect(menu).toBeVisible();
        await shot(page, 'files-row-menu');
        await page.getByTestId('tree-row-menu-rename').click();

        await expect(page.locator('.mantine-Modal-title')).toHaveText(text.modal.rename);
        await expect(page.getByTestId('modal-path-input')).toHaveValue(PAGE);
        await page.getByTestId('modal-path-input').fill(RENAMED);
        await page.getByTestId('modal-submit').click();

        await expect(page.locator('[data-testid=toast][data-kind="ok"]')).toContainText(text.toast.renamed);
        await expect(page).toHaveURL(MAIN.url.doc(RENAMED));
        expect(fs.existsSync(fixtureFile(PAGE))).toBe(false);
        expect(fs.existsSync(fixtureFile(RENAMED))).toBe(true);
        await expect(page.locator(`[data-testid=tree-row][data-path="${RENAMED}"]`)).toHaveCount(1);
        await shot(page, 'files-renamed');
    });

    // dragging is the shortest way to move a note, and the one a reader reaches
    // for first: the rename dialog asks for a whole path to say the same thing
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
        // shift takes the run between the two rows, the way a file manager does
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

    test('deletes a page and drops it from the tree', async ({page}) => {
        await page.goto(routes.doc(RENAMED));
        await page.locator(`[data-testid=tree-row][data-path="${RENAMED}"] [data-testid=tree-row-menu]`).click();
        await page.getByTestId('tree-row-menu-delete').click();

        await expect(page.locator('.mantine-Modal-title')).toHaveText(text.modal.deletePage);
        await shot(page, 'files-delete-confirm');
        await page.getByTestId('modal-confirm').click();

        await expect(page.locator('[data-testid=toast][data-kind="ok"]')).toContainText(text.toast.deleted);
        await expect(page).toHaveURL(atHome());
        await expect.poll(() => fs.existsSync(fixtureFile(RENAMED))).toBe(false);
        await expect(page.locator(`[data-testid=tree-row][data-path="${RENAMED}"]`)).toHaveCount(0);
        await shot(page, 'files-deleted');
    });

    // an empty note was a blank screen and an open empty folder a row with
    // nothing under it: neither said whether anything was selected at all
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
        await expect(row.locator('xpath=following-sibling::*[@data-testid="tree-empty"]')).toHaveText(text.dir.noNotes);
        await shot(page, 'files-empty-folder');
        await page.getByTestId('dir-empty-new-page').click();
        await expect(page.getByTestId('tree-draft-input')).toBeFocused();
        await expect(page.getByTestId('tree-empty')).toHaveCount(0);
        await page.getByTestId('tree-draft-input').fill('first');
        await page.getByTestId('tree-draft-input').press('Enter');
        await expect(page).toHaveURL(new RegExp(`${routes.edit(`${BLANK_FOLDER}/first.md`)}$`));
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
        await expect(page.locator('.mantine-Modal-title')).toHaveText(text.modal.deleteFolderContents);
        await page.getByTestId('modal-confirm').click();

        // assert
        await expect(page.locator('[data-testid=toast][data-kind="ok"]')).toContainText(text.toast.deleted);
        await expect(page).toHaveURL(atHome());
        expect(fs.existsSync(fixtureFile(FULL_FOLDER))).toBe(false);
        await expect(page.locator(`[data-testid=tree-row][data-path="${FULL_FOLDER}"]`)).toHaveCount(0);
    });

    // Finder leaves a .DS_Store in every folder it has shown, and the app
    // lists no such file: the folder looked empty and still would not go
    test('asks again when a folder that looks empty holds a file the app does not list', async ({page}) => {
        // arrange
        fs.mkdirSync(fixtureFile(JUNK_FOLDER), {recursive: true});
        fs.writeFileSync(fixtureFile(`${JUNK_FOLDER}/.DS_Store`), 'junk', 'utf8');
        await page.goto(routes.home());

        // act
        await page.locator(`[data-testid=tree-row][data-path="${JUNK_FOLDER}"] [data-testid=tree-row-menu]`).click();
        await page.getByTestId('tree-row-menu-delete').click();
        await expect(page.locator('.mantine-Modal-title')).toHaveText(text.modal.deleteFolder);
        await page.getByTestId('modal-confirm').click();
        await expect(page.locator('.mantine-Modal-title')).toHaveText(text.modal.deleteFolderContents);
        await page.getByTestId('modal-confirm').click();

        // assert
        await expect(page.locator('[data-testid=toast][data-kind="ok"]')).toContainText(text.toast.deleted);
        expect(fs.existsSync(fixtureFile(JUNK_FOLDER))).toBe(false);
    });
});
