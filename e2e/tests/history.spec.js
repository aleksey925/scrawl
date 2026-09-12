const {expect, test} = require('@playwright/test');

const fs = require('fs');

const docs = require('../support/docs');
const {
    HISTORY, MAIN, READONLY, fixtureFile, readFixture, shot, signIn, writeFixture,
} = require('../support/helpers');

const FOLDER = 'e2e-history';

async function saveInEditor(page, text) {
    await page.locator('#editor-source').fill(text);
    await page.click('[data-editor-save]');
    await expect(page.locator('#status-state')).toHaveText('Saved');
}

test.describe.serial('history', () => {
    test.beforeEach(async ({page}) => {
        await signIn(page, {baseURL: HISTORY.baseURL});
    });

    test.afterAll(() => {
        fs.rmSync(fixtureFile(FOLDER, HISTORY), {recursive: true, force: true});
    });

    test('two edits become two versions and the older one can be restored', async ({page}) => {
        const docPath = `${FOLDER}/restored.md`;
        await page.goto(`${HISTORY.baseURL}/edit/${docPath}`);
        await saveInEditor(page, '# Первая версия\n');
        await saveInEditor(page, '# Вторая версия\n');

        await page.goto(`${HISTORY.baseURL}/history/${docPath}`);
        const versions = page.locator('.version');
        await expect(versions).toHaveCount(2);
        await expect(versions.first().locator('.version-message')).toHaveText(`save ${docPath}`);
        await expect(versions.first().locator('.version-actor')).toHaveText('e2e');
        await expect(versions.first().locator('.version-kind')).toHaveText('modified');
        await expect(versions.nth(1).locator('.version-kind')).toHaveText('added');
        await shot(page, 'history-versions');

        await versions.nth(1).locator('.version-pick').click();
        await expect(page.locator('#version-detail .diff')).toContainText('Первая версия');
        await shot(page, 'history-diff');

        await versions.nth(1).locator('[data-restore]').click();
        const dialog = page.locator('dialog.modal');
        await expect(dialog.locator('.modal-title')).toHaveText('Restore this version?');
        await shot(page, 'history-restore-confirm');
        await dialog.locator('[data-act="ok"]').click();

        await expect.poll(() => readFixture(docPath, HISTORY)).toBe('# Первая версия\n');
        // the restore is itself a version, so the list grows instead of rewinding
        await expect(page.locator('.version')).toHaveCount(3);
        await shot(page, 'history-after-restore');

        await page.goto(`${HISTORY.baseURL}/p/${docPath}`);
        await expect(page.locator('#doc h1').first()).toContainText('Первая версия');
    });

    test('a page left open while the document changed is refused its restore', async ({page}) => {
        const docPath = `${FOLDER}/conflict.md`;
        await page.goto(`${HISTORY.baseURL}/edit/${docPath}`);
        await saveInEditor(page, 'first\n');
        await saveInEditor(page, 'second\n');

        await page.goto(`${HISTORY.baseURL}/history/${docPath}`);
        writeFixture(docPath, 'written by someone else\n', HISTORY);

        await page.locator('.version').nth(1).locator('[data-restore]').click();
        await page.locator('dialog.modal [data-act="ok"]').click();

        const conflict = page.locator('dialog.modal-wide');
        await expect(conflict.locator('.modal-title')).toContainText('changed while the history was open');
        await expect(conflict.locator('[data-theirs]')).toHaveText('written by someone else');
        expect(readFixture(docPath, HISTORY)).toBe('written by someone else\n');
        await shot(page, 'history-restore-conflict');
    });

    test('read-only mode lists the versions and offers no restore', async ({page}) => {
        await signIn(page, {baseURL: READONLY.baseURL});
        await page.goto(`${READONLY.baseURL}/history/${docs.doc.path}`);

        await expect(page.locator('.version').first()).toBeVisible();
        await expect(page.locator('[data-restore]')).toHaveCount(0);
        await shot(page, 'history-readonly');
    });

    test('the History action leads to the page and is absent when history is off', async ({page}) => {
        await page.goto(`${HISTORY.baseURL}/p/${docs.doc.path}`);
        await page.locator('.topbar-history').click();
        await expect(page).toHaveURL(`${HISTORY.baseURL}/history/${docs.doc.path}`);
        await expect(page.locator('.history-title')).toHaveText('History');

        await signIn(page, {baseURL: MAIN.baseURL});
        await page.goto(`${MAIN.baseURL}/p/${docs.doc.path}`);
        await expect(page.locator('.topbar-history')).toHaveCount(0);

        const response = await page.goto(`${MAIN.baseURL}/history/${docs.doc.path}`);
        expect(response.status()).toBe(404);
    });
});
