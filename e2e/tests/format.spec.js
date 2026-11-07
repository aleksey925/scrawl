const {expect, test} = require('../support/test');

const fs = require('fs');

const {
    SHARED, editorStatus, fixtureFile, jsonRequest, readFixture, routes, save, setSource, signIn,
    sourceText, writeFixture,
} = require('../support/helpers');
const text = require('../support/text');

const FOLDER = 'e2e-format';

const longLines = [
    '## Заголовок, который намного длиннее семидесяти девяти символов и остаётся одной строкой',
    '',
    '| a   | b                                                                                   |',
    '| --- | ----------------------------------------------------------------------------------- |',
    '| 1   | ячейка таблицы, которая намного длиннее семидесяти девяти символов и не переносится |',
    '',
    '```',
    'строка кода, которая намного длиннее семидесяти девяти символов и остаётся как есть',
    '```',
];

const rough = [
    '#  Заголовок',
    '',
    '',
    '* один',
    '* два',
    '',
    '|a|b|',
    '|-|-|',
    '|длинная ячейка|2|',
    '',
    '```json',
    '{"a":1}',
    '```',
    '',
    'Один абзац, в котором много слов, и он намного длиннее семидесяти девяти символов, поэтому форматтер его переносит.',
    '',
    ...longLines,
    '',
].join('\n');

const formatted = [
    '# Заголовок',
    '',
    '- один',
    '- два',
    '',
    '| a              | b   |',
    '| -------------- | --- |',
    '| длинная ячейка | 2   |',
    '',
    '```json',
    '{ "a": 1 }',
    '```',
    '',
    'Один абзац, в котором много слов, и он намного длиннее семидесяти девяти',
    'символов, поэтому форматтер его переносит.',
    '',
    ...longLines,
    '',
].join('\n');

test.describe('formatting', () => {
    test('an alert keeps its marker on its own line in the browser and on the server', async ({page}) => {
        // arrange
        const docPath = `${FOLDER}/alerts.md`;
        const alerts = [
            '> [!NOTE]',
            '> Some text of the alert.',
            '',
            '> [!WARNING]',
            '> A long body of the alert that is much longer than seventy nine columns, so it',
            '> is',
            '> wrapped.',
            '',
        ].join('\n');
        const wrapped = [
            '> [!NOTE]',
            '> Some text of the alert.',
            '',
            '> [!WARNING]',
            '> A long body of the alert that is much longer than seventy nine columns, so it',
            '> is wrapped.',
            '',
        ].join('\n');
        writeFixture(docPath, alerts);
        await signIn(page, {from: routes.edit(docPath)});
        await expect.poll(() => sourceText(page)).toBe(alerts);

        // act
        await page.getByTestId('editor-toolbar-format').click();
        const res = await jsonRequest(page, 'PUT', routes.api(`/file/${FOLDER}/alerts-api.md`), {content: alerts, rev: ''});

        // assert
        await expect.poll(() => sourceText(page)).toBe(wrapped);
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).content).toBe(wrapped);
    });

    test('a save formats the note and the editor shows what was written', async ({page}) => {
        // arrange
        const docPath = `${FOLDER}/on-save.md`;
        writeFixture(docPath, 'начало\n');
        await signIn(page, {from: routes.edit(docPath)});
        await expect.poll(() => sourceText(page)).toBe('начало\n');
        await setSource(page, rough);

        // act
        const sending = page.waitForRequest((req) => req.method() === 'PUT');
        await save(page);

        // assert
        await expect(editorStatus(page)).toHaveText(text.status.saved);
        expect((await sending).postDataJSON()).toMatchObject({content: formatted, formatted: true});
        expect(readFixture(docPath)).toBe(formatted);
        await expect.poll(() => sourceText(page)).toBe(formatted);
    });

    test('a write through the API is formatted with no editor in the way', async ({page}) => {
        // arrange
        const docPath = `${FOLDER}/api.md`;
        await signIn(page);

        // act
        const res = await jsonRequest(page, 'PUT', routes.api(`/file/${docPath}`), {content: rough, rev: ''});

        // assert
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).content).toBe(formatted);
        expect(readFixture(docPath)).toBe(formatted);
    });

    test('the toolbar button formats the buffer and saves nothing', async ({page}) => {
        // arrange
        const docPath = `${FOLDER}/button.md`;
        writeFixture(docPath, rough);
        await signIn(page, {from: routes.edit(docPath)});
        await expect.poll(() => sourceText(page)).toBe(rough);

        // act
        await page.getByTestId('editor-toolbar-format').click();

        // assert
        await expect.poll(() => sourceText(page)).toBe(formatted);
        await expect(editorStatus(page)).toHaveAttribute('data-dirty', 'true');
        expect(readFixture(docPath)).toBe(rough);
    });

    test('the shortcut formats the buffer and one undo takes it back', async ({page}) => {
        // arrange
        const docPath = `${FOLDER}/shortcut.md`;
        writeFixture(docPath, rough);
        await signIn(page, {from: routes.edit(docPath)});
        await expect.poll(() => sourceText(page)).toBe(rough);
        await page.locator('[data-testid=editor-source] .cm-content').click();

        // act
        await page.keyboard.press('Shift+Alt+KeyF');

        // assert
        await expect.poll(() => sourceText(page)).toBe(formatted);
        await page.keyboard.press('ControlOrMeta+z');
        await expect.poll(() => sourceText(page)).toBe(rough);
    });

    test('the shortcut keeps the cursor in the text of an alert', async ({page}) => {
        // arrange
        const docPath = `${FOLDER}/alert-cursor.md`;
        writeFixture(docPath, '#  Title\n\n> [!NOTE]\n> Some text\n> of the alert.\n');
        await signIn(page, {from: routes.edit(docPath)});
        await expect.poll(() => sourceText(page)).toBe('#  Title\n\n> [!NOTE]\n> Some text\n> of the alert.\n');
        await page.locator('[data-testid=editor-source] .cm-line').nth(3).click();
        await page.keyboard.press('End');

        // act
        await page.keyboard.press('Shift+Alt+KeyF');
        await expect.poll(() => sourceText(page)).toBe('# Title\n\n> [!NOTE]\n> Some text of the alert.\n');
        await page.keyboard.insertText('!');

        // assert
        await expect.poll(() => sourceText(page)).toBe('# Title\n\n> [!NOTE]\n> Some text! of the alert.\n');
    });

    test('a file that is not markdown is saved as written and offers no toolbar to format with', async ({page}) => {
        // arrange
        const docPath = `${FOLDER}/data.txt`;
        writeFixture(docPath, 'начало\n');
        await signIn(page, {from: routes.edit(docPath)});
        await expect.poll(() => sourceText(page)).toBe('начало\n');
        await setSource(page, rough);

        // act
        await save(page);

        // assert
        expect(readFixture(docPath)).toBe(rough);
        await expect(page.getByTestId('editor-toolbar')).toHaveCount(0);
        await expect(page.getByTestId('editor-toolbar-format')).toHaveCount(0);
    });

    test('--space.format-on-save=off saves what was written and keeps the button', async ({page}) => {
        // arrange
        const docPath = `${FOLDER}/off.md`;
        writeFixture(docPath, 'начало\n', SHARED);
        await signIn(page, {baseURL: SHARED.baseURL, from: routes.edit(docPath)});
        await expect.poll(() => sourceText(page)).toBe('начало\n');
        await setSource(page, rough);

        // act
        await save(page);

        // assert
        expect(readFixture(docPath, SHARED)).toBe(rough);
        await page.getByTestId('editor-toolbar-format').click();
        await expect.poll(() => sourceText(page)).toBe(formatted);
    });

    test.afterAll(() => {
        fs.rmSync(fixtureFile(FOLDER), {recursive: true, force: true});
        fs.rmSync(fixtureFile(FOLDER, SHARED), {recursive: true, force: true});
    });
});
