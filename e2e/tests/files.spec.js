const {expect, test} = require('@playwright/test');

const fs = require('fs');

const {
    MAIN, atHome, fixtureFile, routes, save, setSource, shot, signIn,
} = require('../support/helpers');
const text = require('../support/text');

const FOLDER = 'e2e-fm';
const PAGE = `${FOLDER}/testovaya-stranitsa.md`;
const RENAMED = `${FOLDER}/pereimenovannaya.md`;

test.describe.serial('file management', () => {
    test.beforeEach(async ({page}) => {
        await signIn(page);
    });

    test.afterAll(() => {
        fs.rmSync(fixtureFile(FOLDER), {recursive: true, force: true});
    });

    test('creates a folder, which joins the tree while it holds no document', async ({page}) => {
        await page.getByTestId('sidebar-new-folder').click();
        // the hook sits on mantine's modal root, which is a wrapper with no box
        // of its own, so the dialog is counted and asserted on from the inside
        await expect(page.locator('[data-testid=modal][data-variant="create"][data-entry="dir"]'))
            .toHaveCount(1);
        await expect(page.getByTestId('modal-name-input')).toBeVisible();
        await expect(page.locator('.mantine-Modal-title')).toHaveText(text.modal.newFolder);

        await page.getByTestId('modal-name-input').fill(FOLDER);
        await expect(page.getByTestId('modal-path-preview')).toHaveText(FOLDER);
        await shot(page, 'files-new-folder-dialog');
        await page.getByTestId('modal-submit').click();

        await expect(page.locator('[data-testid=toast][data-kind="ok"]')).toContainText(text.toast.folderCreated);
        expect(fs.statSync(fixtureFile(FOLDER)).isDirectory()).toBe(true);
        // a folder is where a page is created, so it is on the tree before it holds one
        await expect(page.locator(`[data-testid=tree-row][data-path="${FOLDER}"]`)).toHaveCount(1);

        await page.goto(routes.dir(FOLDER));
        await expect(page.getByTestId('dir-empty')).toHaveText(text.dir.empty);
        await shot(page, 'files-folder-created');
    });

    test('creates a page in the folder picked for it', async ({page}) => {
        await page.getByTestId('sidebar-new-page').click();
        await expect(page.locator('[data-testid=modal][data-variant="create"][data-entry="file"]'))
            .toHaveCount(1);
        await expect(page.locator('.mantine-Modal-title')).toHaveText(text.modal.newPage);

        await page.locator(`[data-testid=modal-folder-row][data-path="${FOLDER}"]`).click();
        await expect(page.locator(`[data-testid=modal-folder-row][data-path="${FOLDER}"]`))
            .toHaveAttribute('data-selected', 'true');
        await page.getByTestId('modal-name-input').fill('Тестовая страница');
        await expect(page.getByTestId('modal-path-preview')).toHaveText(PAGE);
        await shot(page, 'files-new-page-dialog');
        await page.getByTestId('modal-submit').click();

        await expect(page).toHaveURL(MAIN.url.edit(PAGE));
        expect(fs.existsSync(fixtureFile(PAGE))).toBe(true);

        await setSource(page, '# Тестовая страница\n');
        await save(page);

        await page.goto(routes.doc(PAGE));
        await expect(page.locator('[data-testid=tree-row][data-current="true"]')).toHaveAttribute('data-path', PAGE);
        await shot(page, 'files-page-created');
    });

    test('refuses to create a page that already exists', async ({page}) => {
        await page.getByTestId('sidebar-new-page').click();
        await page.locator(`[data-testid=modal-folder-row][data-path="${FOLDER}"]`).click();
        await page.getByTestId('modal-name-input').fill('Тестовая страница');
        await page.getByTestId('modal-submit').click();

        // the dialog stays open and complains on the field, so neither the typed
        // name nor the folder that was picked for it is thrown away
        await expect(page.locator('[data-testid=modal][data-variant="create"]')).toHaveCount(1);
        await expect(page.locator('[data-testid=modal][data-variant="create"]'))
            .toContainText(text.pageExists);
        await shot(page, 'files-duplicate-page');
    });

    test('refuses to delete a folder that is not empty', async ({page}) => {
        await page.goto(routes.doc(PAGE));
        await page.locator(`[data-testid=tree-row][data-path="${FOLDER}"] [data-testid=tree-row-menu]`).click();
        await page.getByTestId('tree-row-menu-delete').click();
        await expect(page.locator('.mantine-Modal-title')).toHaveText(text.modal.deleteFolder);
        await page.getByTestId('modal-confirm').click();

        const toast = page.locator('[data-testid=toast][data-kind="error"]');
        await expect(toast).toContainText(text.toast.notDeleted);
        await expect(toast).toContainText(text.toast.folderNotEmpty);
        expect(fs.existsSync(fixtureFile(PAGE))).toBe(true);
        await shot(page, 'files-folder-not-empty');
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
});
