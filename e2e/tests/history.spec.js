const {expect, test} = require('@playwright/test');

const fs = require('fs');

const docs = require('../support/docs');
const {
    HISTORY, MAIN, READONLY, fixtureFile, readFixture, routes, save, setSource, shot, signIn,
    writeFixture,
} = require('../support/helpers');
const text = require('../support/text');

const FOLDER = 'e2e-history';

async function saveInEditor(page, body) {
    await setSource(page, body);
    await save(page);
}

test.describe.serial('history', () => {
    test.beforeEach(async ({page}) => {
        await signIn(page, {baseURL: HISTORY.baseURL, from: routes.home()});
    });

    test.afterAll(() => {
        fs.rmSync(fixtureFile(FOLDER, HISTORY), {recursive: true, force: true});
    });

    test('two edits become two versions and the older one can be restored', async ({page}) => {
        const docPath = `${FOLDER}/restored.md`;
        await page.goto(HISTORY.url.edit(docPath));
        await saveInEditor(page, '# Первая версия\n');
        await saveInEditor(page, '# Вторая версия\n');

        await page.goto(HISTORY.url.history(docPath));
        await expect(page.getByTestId('history-title')).toHaveText(text.history.title);
        const versions = page.getByTestId('version');
        await expect(versions).toHaveCount(2);
        await expect(versions.first().getByTestId('version-message')).toHaveText(`save ${docPath}`);
        await expect(versions.first().getByTestId('version-actor')).toHaveText('e2e');
        await expect(versions.first().getByTestId('version-kind')).toHaveText('modified');
        await expect(versions.nth(1).getByTestId('version-kind')).toHaveText('added');
        await shot(page, 'history-versions');

        await versions.nth(1).getByTestId('version-pick').click();
        await expect(versions.nth(1)).toHaveAttribute('data-selected', 'true');
        await expect(page.getByTestId('history-diff')).toContainText('Первая версия');
        await shot(page, 'history-diff');

        await versions.nth(1).getByTestId('version-restore').click();
        await expect(page.locator('.mantine-Modal-title')).toHaveText(text.modal.restore);
        await shot(page, 'history-restore-confirm');
        await page.getByTestId('modal-confirm').click();

        await expect(page.locator('[data-testid=toast][data-kind="ok"]')).toContainText(text.toast.restored);
        await expect.poll(() => readFixture(docPath, HISTORY)).toBe('# Первая версия\n');
        // the restore is itself a version, so the list grows instead of rewinding
        await expect(page.getByTestId('version')).toHaveCount(3);
        await shot(page, 'history-after-restore');

        await page.goto(HISTORY.url.doc(docPath));
        await expect(page.getByTestId('doc').locator('h1').first()).toContainText('Первая версия');
    });

    test('a page left open while the document changed is refused its restore', async ({page}) => {
        const docPath = `${FOLDER}/conflict.md`;
        await page.goto(HISTORY.url.edit(docPath));
        await saveInEditor(page, 'first\n');
        await saveInEditor(page, 'second\n');

        await page.goto(HISTORY.url.history(docPath));
        await expect(page.getByTestId('version')).toHaveCount(2);
        writeFixture(docPath, 'written by someone else\n', HISTORY);

        await page.getByTestId('version').nth(1).getByTestId('version-restore').click();
        await page.getByTestId('modal-confirm').click();

        // the dialog is mounted whether or not it is open, so what it holds is
        // what says it is up
        const conflict = page.locator('[data-testid=modal][data-variant="conflict"]');
        await expect(page.getByTestId('history-conflict-current')).toBeVisible();
        // the confirm dialog is still on its way out, so the title is looked up
        // inside this one rather than anywhere on the page
        await expect(conflict.locator('.mantine-Modal-title')).toContainText(text.modal.restoreConflict);
        await expect(page.getByTestId('history-conflict-current')).toHaveText('written by someone else\n');
        expect(readFixture(docPath, HISTORY)).toBe('written by someone else\n');
        await shot(page, 'history-restore-conflict');

        await page.getByTestId('history-conflict-cancel').click();
        await expect(page.getByTestId('history-conflict-current')).toHaveCount(0);
    });

    test('read-only mode lists the versions and offers no restore', async ({page}) => {
        await signIn(page, {baseURL: READONLY.baseURL, from: routes.history(docs.doc.path)});

        await expect(page.getByTestId('version').first()).toBeVisible();
        await expect(page.getByTestId('version-restore')).toHaveCount(0);
        await shot(page, 'history-readonly');
    });

    test('the History action leads to the page, and says so when history is off', async ({page}) => {
        await page.goto(HISTORY.url.doc(docs.doc.path));
        await page.getByTestId('doc-history').click();
        await expect(page).toHaveURL(HISTORY.url.history(docs.doc.path));
        await expect(page.getByTestId('history-title')).toHaveText(text.history.title);
        await expect(page.getByTestId('version').first()).toBeVisible();

        // the action is on the page whatever the server does with versions, so
        // an instance running without history answers the route with the reason
        await signIn(page, {baseURL: MAIN.baseURL, from: routes.doc(docs.doc.path)});
        await expect(page.getByTestId('doc-history')).toBeVisible();
        await page.getByTestId('doc-history').click();

        await expect(page).toHaveURL(MAIN.url.history(docs.doc.path));
        await expect(page.getByTestId('history-error')).toContainText('history is disabled');
        await expect(page.getByTestId('version')).toHaveCount(0);
        await shot(page, 'history-disabled');
    });
});
