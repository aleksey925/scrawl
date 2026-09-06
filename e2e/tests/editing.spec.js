const {expect, test} = require('@playwright/test');

const {
    fixtureFile, modifier, readFixture, removeFixture, shot, signIn, writeFixture,
} = require('../support/helpers');

const fs = require('fs');

// scratch keeps every test on its own document, so a failure cannot poison the
// next one and the corpus files stay as they were copied
function scratch(name) {
    return `e2e-scratch/${name}.md`;
}

test.describe('editing', () => {
    test.beforeEach(async ({page}) => {
        await signIn(page);
    });

    test('typing updates the preview and the save button writes the file', async ({page}) => {
        const docPath = scratch('save-button');
        writeFixture(docPath, '# Заголовок\n\nстарый текст\n');
        await page.goto(`/edit/${docPath}`);

        const source = page.locator('#editor-source');
        await expect(source).toHaveValue('# Заголовок\n\nстарый текст\n');
        await expect(page.locator('#preview h1')).toContainText('Заголовок');

        await source.fill('# Заголовок\n\nновый текст\n');
        await expect(page.locator('#preview')).toContainText('новый текст');
        await expect(page.locator('#status-state')).toHaveText('Unsaved changes');
        await shot(page, 'editing-preview');

        await page.click('[data-editor-save]');
        await expect(page.locator('#status-state')).toHaveText('Saved');
        expect(readFixture(docPath)).toBe('# Заголовок\n\nновый текст\n');

        await page.reload();
        await expect(page.locator('#editor-source')).toHaveValue('# Заголовок\n\nновый текст\n');
        await shot(page, 'editing-saved');
        removeFixture(docPath);
    });

    test('the save shortcut writes the file', async ({page}) => {
        const docPath = scratch('save-shortcut');
        writeFixture(docPath, 'before\n');
        await page.goto(`/edit/${docPath}`);

        await page.locator('#editor-source').fill('after the shortcut\n');
        await page.locator('#editor-source').press(`${await modifier(page)}+s`);

        await expect(page.locator('#status-state')).toHaveText('Saved');
        await expect.poll(() => readFixture(docPath)).toBe('after the shortcut\n');
        removeFixture(docPath);
    });

    test('trailing whitespace survives a save', async ({page}) => {
        const docPath = scratch('whitespace');
        const body = '- item\n   \n- next\n';
        writeFixture(docPath, body);
        await page.goto(`/edit/${docPath}`);

        await page.locator('#editor-source').fill(body + '- third\n');
        await page.click('[data-editor-save]');

        await expect.poll(() => readFixture(docPath)).toBe(body + '- third\n');
        removeFixture(docPath);
    });

    test('leaving with unsaved changes asks first and keeps a draft', async ({page}) => {
        const docPath = scratch('dirty-guard');
        writeFixture(docPath, 'kept\n');
        await page.goto(`/edit/${docPath}`);

        await page.locator('#editor-source').fill('typed but not saved\n');
        await expect(page.locator('.statusbar')).toHaveClass(/is-dirty/);
        await page.click('[data-editor-cancel]');

        const dialog = page.locator('dialog.modal');
        await expect(dialog.locator('.modal-title')).toHaveText('Leave without saving?');
        await shot(page, 'editing-leave-guard');
        await dialog.locator('[data-act="cancel"]').click();
        await expect(page).toHaveURL(new RegExp(`/edit/${docPath}$`));

        // the draft is debounced into localStorage and offered on the next load
        await page.waitForTimeout(1000);
        await page.goto(`/edit/${docPath}`);
        await expect(page.locator('#draft-bar')).toBeVisible();
        await expect(page.locator('#draft-text')).toContainText('unsaved draft');
        await shot(page, 'editing-draft-bar');

        await page.click('[data-draft-restore]');
        await expect(page.locator('#editor-source')).toHaveValue('typed but not saved\n');
        expect(readFixture(docPath), 'nothing is written to disk without a save').toBe('kept\n');
        removeFixture(docPath);
    });

    test('a file changed behind the browser raises the conflict dialog and overwrite wins', async ({page}) => {
        const docPath = scratch('conflict-overwrite');
        writeFixture(docPath, 'original\n');
        await page.goto(`/edit/${docPath}`);
        await expect(page.locator('#editor-source')).toHaveValue('original\n');

        writeFixture(docPath, 'written by someone else\n');
        await page.locator('#editor-source').fill('my version\n');
        await page.click('[data-editor-save]');

        const dialog = page.locator('dialog.modal-wide');
        await expect(dialog).toBeVisible();
        await expect(dialog.locator('.modal-title')).toHaveText('This file changed on disk');
        await expect(dialog.locator('[data-mine]')).toHaveText('my version');
        await expect(dialog.locator('[data-theirs]')).toHaveText('written by someone else');
        await expect(page.locator('#status-state')).toHaveText('Conflict');
        await shot(page, 'editing-conflict');

        await dialog.locator('[data-act="overwrite"]').click();
        await expect(page.locator('#status-state')).toHaveText('Saved');
        await expect.poll(() => readFixture(docPath)).toBe('my version\n');
        removeFixture(docPath);
    });

    test('the conflict dialog can keep both versions as a copy', async ({page}) => {
        const docPath = scratch('conflict-copy');
        writeFixture(docPath, 'original\n');
        await page.goto(`/edit/${docPath}`);
        await expect(page.locator('#editor-source')).toHaveValue('original\n');

        writeFixture(docPath, 'disk wins\n');
        await page.locator('#editor-source').fill('mine to keep\n');
        await page.click('[data-editor-save]');

        const dialog = page.locator('dialog.modal-wide');
        await expect(dialog).toBeVisible();
        await dialog.locator('[data-act="copy"]').click();

        await expect(page).toHaveURL(/\/edit\/e2e-scratch\/conflict-copy\.conflict-[\d-]+T[\d-]+\.md$/);
        const copyPath = decodeURIComponent(new URL(page.url()).pathname.replace('/edit/', ''));
        expect(readFixture(copyPath)).toBe('mine to keep\n');
        expect(readFixture(docPath), 'the disk version must be left alone').toBe('disk wins\n');
        await shot(page, 'editing-conflict-copy');

        removeFixture(copyPath);
        removeFixture(docPath);
    });

    test.afterAll(() => {
        fs.rmSync(fixtureFile('e2e-scratch'), {recursive: true, force: true});
    });
});
