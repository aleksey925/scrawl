const {expect, test} = require('../support/test');

const fs = require('fs');

const docs = require('../support/docs');
const {
    HISTORY, MAIN, READONLY, fixtureFile, readFixture, rgb, routes, save, setSource, shot, signIn,
    writeFixture,
} = require('../support/helpers');
const text = require('../support/text');
const lightTheme = require('../../theme/themes/light.json');

const FOLDER = 'e2e-history';

// a version list counts every save the repository ever saw, and deleting the
// file does not delete its history: a test that runs again in the same session
// needs a document of its own. A new name is not enough, the text has to be
// new too: history follows a rename, and a new file holding the bytes of a
// deleted one is a rename as far as git can tell.
function freshDoc(name) {
    const stamp = Date.now();
    return {docPath: `${FOLDER}/${name}-${stamp}.md`, stamp};
}

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
        const {docPath, stamp} = freshDoc('restored');
        const first = `# Первая версия ${stamp}\n`;
        await page.goto(HISTORY.url.edit(docPath));
        await saveInEditor(page, first);
        await saveInEditor(page, `# Вторая версия ${stamp}\n`);

        await page.goto(HISTORY.url.history(docPath));
        await expect(page.getByTestId('history-title')).toHaveText(text.history.title);
        const versions = page.getByTestId('version');
        await expect(versions).toHaveCount(2);
        await expect(versions.first().getByTestId('version-actor')).toHaveText('e2e');
        await expect(versions.first().getByTestId('version-kind')).toHaveText('Edit');
        await expect(versions.nth(1).getByTestId('version-kind')).toHaveText('Create');
        await expect(versions.nth(1).getByTestId('version-kind'))
            .toHaveCSS('background-color', rgb(lightTheme.blocks.green.bg));
        // the newest version is the note as it is now, and writing it back changes nothing
        await expect(versions.first()).toHaveAttribute('data-selected', 'true');
        await expect(page.getByTestId('version-restore')).toBeDisabled();
        await expect(page.getByTestId('history-restore-reason')).toHaveText('Same as the current note');
        await shot(page, 'history-versions');

        await versions.nth(1).click();
        await expect(versions.nth(1)).toHaveAttribute('data-selected', 'true');
        await expect(page.getByTestId('rendered-diff')).toContainText('Первая версия');
        await page.getByTestId('history-diff-view').getByText('Source').click();
        await expect(page.getByTestId('history-diff')).toContainText('Первая версия');
        await shot(page, 'history-diff');
        await page.getByTestId('history-diff-view').getByText('Rendered').click();

        await page.getByTestId('version-restore').click();
        await expect(page.locator('.mantine-Modal-title')).toHaveText(text.modal.restore);
        await shot(page, 'history-restore-confirm');
        await page.getByTestId('modal-confirm').click();

        await expect(page.locator('[data-testid=toast][data-kind="ok"]')).toContainText(text.toast.restored);
        await expect.poll(() => readFixture(docPath, HISTORY)).toBe(first);
        // the restore is itself a version, so the list grows instead of rewinding
        await expect(page.getByTestId('version')).toHaveCount(3);
        await shot(page, 'history-after-restore');

        await page.goto(HISTORY.url.doc(docPath));
        await expect(page.getByTestId('doc').locator('h1').first()).toContainText('Первая версия');
    });

    test('a version is compared as a reader sees it, markup apart from words', async ({page}) => {
        const {docPath, stamp} = freshDoc('compared');
        await page.goto(HISTORY.url.edit(docPath));
        await saveInEditor(page, `# Заметка ${stamp}\n\nОдна длинная строка,\nперенесённая вручную.\n\nБыстрая лиса.\n`);
        await saveInEditor(page, `# Заметка ${stamp}\n\nОдна длинная строка, перенесённая вручную.\n\nМедленная лиса.\n`);

        await page.goto(HISTORY.url.history(docPath));
        const diff = page.getByTestId('rendered-diff');
        const rows = diff.getByTestId('diff-row');
        await expect(diff).toHaveAttribute('data-layout', 'split');
        await expect(rows).toHaveCount(3);
        await expect(rows.nth(1)).toHaveAttribute('data-kind', 'format');
        await expect(rows.nth(2)).toHaveAttribute('data-kind', 'changed');
        await expect(rows.nth(2).locator('.diff-old del.diff-del')).toHaveText('Быстрая');
        await expect(rows.nth(2).locator('.diff-new ins.diff-ins')).toHaveText('Медленная');
        await shot(page, 'history-rendered-diff');

        // unified shows the changed block once, both marks in it
        await page.getByTestId('history-diff-layout').getByText('Unified').click();
        await expect(diff).toHaveAttribute('data-layout', 'unified');
        await expect(rows.nth(2).locator('.diff-cell')).toHaveCount(1);
        await expect(rows.nth(2).locator('del.diff-del')).toHaveText('Быстрая');
        await expect(rows.nth(2).locator('ins.diff-ins')).toHaveText('Медленная');
        await shot(page, 'history-rendered-diff-unified');
        await page.reload();
        await expect(page.getByTestId('rendered-diff')).toHaveAttribute('data-layout', 'unified');
        await page.getByTestId('history-diff-layout').getByText('Split').click();

        // the choice of view is kept for the next version and the next visit
        await page.getByTestId('history-diff-view').getByText('Source').click();
        await page.reload();
        await expect(page.getByTestId('history-diff')).toContainText('+Медленная лиса.');
        await page.getByTestId('history-diff-view').getByText('Rendered').click();
        await expect(page.getByTestId('rendered-diff')).toBeVisible();
    });

    test('formulas and diagrams stay drawn when the layout changes', async ({page}) => {
        // arrange
        const {docPath, stamp} = freshDoc('typeset');
        const diagram = (to) => `\`\`\`mermaid\nflowchart TD\n  A --> ${to}\n\`\`\`\n`;
        await page.goto(HISTORY.url.edit(docPath));
        await saveInEditor(page, `# Формулы ${stamp}\n\nБыстрая лиса $x^2$.\n\n${diagram('B')}`);
        await saveInEditor(page, `# Формулы ${stamp}\n\nМедленная лиса $x^2$.\n\n${diagram('C')}`);
        await page.goto(HISTORY.url.history(docPath));
        const diff = page.getByTestId('rendered-diff');
        const math = diff.locator('.math.is-typeset .katex');
        const diagrams = diff.locator('.md-diagram[data-state="done"] svg');
        await expect(math.first()).toBeVisible();
        await expect(diagrams.first()).toBeVisible();

        // act
        await page.getByTestId('history-diff-layout').getByText('Unified').click();

        // assert
        await expect(diff).toHaveAttribute('data-layout', 'unified');
        await expect(math.first()).toBeVisible();
        await expect(diagrams.first()).toBeVisible();
        await expect(diff.locator('.math:not(.is-typeset)')).toHaveCount(0);
    });

    test('a row in an open fold lines up with the rows around it', async ({page}) => {
        // arrange
        const {docPath, stamp} = freshDoc('folded');
        const paragraphs = (last) => ['Один.', 'Два.', 'Три.', 'Четыре.', last].join('\n\n');
        await page.goto(HISTORY.url.edit(docPath));
        await saveInEditor(page, `# Свёрнутое ${stamp}\n\n${paragraphs('Пять.')}\n`);
        await saveInEditor(page, `# Свёрнутое ${stamp}\n\n${paragraphs('Шесть.')}\n`);
        await page.goto(HISTORY.url.history(docPath));
        await page.getByTestId('history-diff-layout').getByText('Unified').click();
        const diff = page.getByTestId('rendered-diff');
        const fold = diff.getByTestId('diff-fold').first();

        // act
        await fold.locator('summary').click();

        // assert
        const inside = await fold.getByTestId('diff-row').first().boundingBox();
        const outside = await diff.locator(':scope > [data-testid=diff-row]').first().boundingBox();
        expect(Math.round(inside.x)).toBe(Math.round(outside.x));
    });

    test('a page left open while the document changed is refused its restore', async ({page}) => {
        const {docPath, stamp} = freshDoc('conflict');
        await page.goto(HISTORY.url.edit(docPath));
        await saveInEditor(page, `first ${stamp}\n`);
        await saveInEditor(page, `second ${stamp}\n`);

        await page.goto(HISTORY.url.history(docPath));
        await expect(page.getByTestId('version')).toHaveCount(2);
        writeFixture(docPath, 'written by someone else\n', HISTORY);

        await page.getByTestId('version').nth(1).click();
        await page.getByTestId('version-restore').click();
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

    test('the history is a dialog over the note, and Esc goes back to the note', async ({page}) => {
        // arrange
        await page.goto(HISTORY.url.doc(docs.doc.path));
        await page.getByTestId('doc-history').click();
        await expect(page.getByTestId('history-list')).toBeVisible();

        // act
        await page.keyboard.press('Escape');

        // assert
        await expect(page.getByTestId('history-list')).toHaveCount(0);
        await expect(page).toHaveURL(HISTORY.url.doc(docs.doc.path));
        await expect(page.getByTestId('doc')).toBeVisible();
    });

    test('the history expands to nearly the whole window, and stays so', async ({page}) => {
        // arrange
        await page.goto(HISTORY.url.history(docs.doc.path));
        const dialog = page.getByTestId('history-dialog');
        const content = dialog.locator('.mantine-Modal-content');
        await expect(dialog).toHaveAttribute('data-expanded', 'false');
        const before = await content.boundingBox();

        // act
        await page.getByTestId('history-expand').click();

        // assert
        await expect(dialog).toHaveAttribute('data-expanded', 'true');
        await expect.poll(async () => (await content.boundingBox()).width).toBe(page.viewportSize().width - 32);
        expect((await content.boundingBox()).width).toBeGreaterThan(before.width);
        await page.reload();
        await expect(page.getByTestId('history-dialog')).toHaveAttribute('data-expanded', 'true');
        await page.getByTestId('history-expand').click();
        await expect(page.getByTestId('history-dialog')).toHaveAttribute('data-expanded', 'false');
    });

    test('read-only mode lists the versions and offers no restore', async ({page}) => {
        await signIn(page, {baseURL: READONLY.baseURL, from: routes.history(docs.doc.path)});

        await expect(page.getByTestId('version').first()).toBeVisible();
        await expect(page.getByTestId('version-restore')).toHaveCount(0);
        await shot(page, 'history-readonly');
    });

    test('the History action leads to the page, and is gone where history is off', async ({page}) => {
        await page.goto(HISTORY.url.doc(docs.doc.path));
        await page.getByTestId('doc-history').click();
        await expect(page).toHaveURL(HISTORY.url.history(docs.doc.path));
        await expect(page.getByTestId('doc')).toBeVisible();
        await expect(page.getByTestId('history-title')).toHaveText(text.history.title);
        await expect(page.getByTestId('version').first()).toBeVisible();

        // an instance running without history offers no action, and its route
        // typed in by hand answers with the reason
        await signIn(page, {baseURL: MAIN.baseURL, from: routes.doc(docs.doc.path)});
        await expect(page.getByTestId('note-menu')).toBeVisible();
        await expect(page.getByTestId('doc-history')).toHaveCount(0);
        await page.goto(MAIN.url.history(docs.doc.path));

        await expect(page.getByTestId('history-error')).toContainText('history is disabled');
        await expect(page.getByTestId('version')).toHaveCount(0);
        await shot(page, 'history-disabled');
    });
});
