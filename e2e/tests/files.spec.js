const {expect, test} = require('@playwright/test');

const fs = require('fs');

const {fixtureFile, shot, signIn} = require('../support/helpers');

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
        await page.click('[data-new-folder]');
        const dialog = page.locator('dialog.modal');
        await expect(dialog.locator('.modal-title')).toHaveText('New folder');
        await dialog.locator('input[name="name"]').fill(FOLDER);
        await expect(dialog.locator('[data-preview]')).toHaveText(FOLDER);
        await shot(page, 'files-new-folder-dialog');
        await dialog.locator('button[type="submit"]').click();

        await expect(page.locator('.toast.is-success')).toContainText('Folder created');
        expect(fs.statSync(fixtureFile(FOLDER)).isDirectory()).toBe(true);
        // a folder is where a page is created, so it is on the tree before it holds one
        await expect(page.locator(`#sidebar .tree-dir[data-path="${FOLDER}"]`)).toHaveCount(1);

        await page.goto(`/p/${FOLDER}/`);
        await expect(page.locator('.empty-title')).toContainText('This folder is empty');
        await shot(page, 'files-folder-created');
    });

    test('creates a page in the folder picked for it', async ({page}) => {
        await page.click('.sidebar-foot [data-new-page]');
        const dialog = page.locator('dialog.modal');
        await expect(dialog.locator('.modal-title')).toHaveText('New page');
        await dialog.locator(`.picker-row[data-path="${FOLDER}"]`).click();
        await dialog.locator('input[name="name"]').fill('Тестовая страница');
        await expect(dialog.locator('[data-preview]')).toHaveText(PAGE);
        await shot(page, 'files-new-page-dialog');
        await dialog.locator('button[type="submit"]').click();

        await expect(page).toHaveURL(new RegExp(`/edit/${PAGE}$`));
        expect(fs.existsSync(fixtureFile(PAGE))).toBe(true);

        await page.locator('#editor-source').fill('# Тестовая страница\n');
        await page.click('[data-editor-save]');
        await expect(page.locator('#status-state')).toHaveText('Saved');

        await page.goto(`/p/${PAGE}`);
        await expect(page.locator(`#sidebar .tree-row[data-path="${PAGE}"]`)).toHaveClass(/is-current/);
        await shot(page, 'files-page-created');
    });

    test('refuses to create a page that already exists', async ({page}) => {
        await page.click('.sidebar-foot [data-new-page]');
        const dialog = page.locator('dialog.modal');
        await dialog.locator(`.picker-row[data-path="${FOLDER}"]`).click();
        await dialog.locator('input[name="name"]').fill('Тестовая страница');
        await dialog.locator('button[type="submit"]').click();

        await expect(page.locator('.toast.is-error')).toContainText('That page already exists');
        await shot(page, 'files-duplicate-page');
    });

    test('refuses to delete a folder that is not empty', async ({page}) => {
        await page.goto(`/p/${PAGE}`);
        await page.locator(`#sidebar [data-actions="${FOLDER}"]`).click();
        await page.locator('.menu-float').getByRole('menuitem', {name: 'Delete'}).click();
        await page.locator('dialog.modal [data-act="ok"]').click();

        await expect(page.locator('.toast.is-error')).toContainText('The folder is not empty');
        expect(fs.existsSync(fixtureFile(PAGE))).toBe(true);
        await shot(page, 'files-folder-not-empty');
    });

    test('renames a page from the tree menu', async ({page}) => {
        await page.goto(`/p/${PAGE}`);
        await page.locator(`#sidebar [data-actions="${PAGE}"]`).click();
        const menu = page.locator('.menu-float');
        await expect(menu).toBeVisible();
        await shot(page, 'files-row-menu');
        await menu.getByRole('menuitem', {name: 'Rename'}).click();

        const dialog = page.locator('dialog.modal');
        await expect(dialog.locator('input[name="to"]')).toHaveValue(PAGE);
        await dialog.locator('input[name="to"]').fill(RENAMED);
        await dialog.locator('button[type="submit"]').click();

        await expect(page).toHaveURL(new RegExp(`/p/${RENAMED}$`));
        expect(fs.existsSync(fixtureFile(PAGE))).toBe(false);
        expect(fs.existsSync(fixtureFile(RENAMED))).toBe(true);
        await expect(page.locator(`#sidebar .tree-row[data-path="${RENAMED}"]`)).toHaveCount(1);
        await shot(page, 'files-renamed');
    });

    test('deletes a page and drops it from the tree', async ({page}) => {
        await page.goto(`/p/${RENAMED}`);
        await page.locator(`#sidebar [data-actions="${RENAMED}"]`).click();
        await page.locator('.menu-float').getByRole('menuitem', {name: 'Delete'}).click();

        const dialog = page.locator('dialog.modal');
        await expect(dialog.locator('.modal-title')).toHaveText('Delete page?');
        await shot(page, 'files-delete-confirm');
        await dialog.locator('[data-act="ok"]').click();

        await expect(page).toHaveURL(/\/$/);
        await expect.poll(() => fs.existsSync(fixtureFile(RENAMED))).toBe(false);
        await expect(page.locator(`#sidebar .tree-row[data-path="${RENAMED}"]`)).toHaveCount(0);
        await shot(page, 'files-deleted');
    });
});
