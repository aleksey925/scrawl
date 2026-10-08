const {expect, test} = require('@playwright/test');

const fs = require('fs');

const {
    SHARED, editorStatus, fixtureFile, readFixture, routes, save, setSource, signIn, sourceText,
    writeFixture,
} = require('../support/helpers');
const text = require('../support/text');

const FOLDER = 'e2e-format';

// what a hand writes and what `prettier --write` makes of it: the list marker,
// the blank lines, the table and the code inside the fence all change
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
].join('\n');

test.describe('formatting', () => {
    test('a save formats the note and the editor shows what was written', async ({page}) => {
        // arrange
        const docPath = `${FOLDER}/on-save.md`;
        writeFixture(docPath, 'начало\n');
        await signIn(page, {from: routes.edit(docPath)});
        await expect.poll(() => sourceText(page)).toBe('начало\n');
        await setSource(page, rough);

        // act
        await save(page);

        // assert
        await expect(editorStatus(page)).toHaveText(text.status.saved);
        expect(readFixture(docPath)).toBe(formatted);
        await expect.poll(() => sourceText(page)).toBe(formatted);
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

    test('a file that is not markdown is saved as written and offers no button', async ({page}) => {
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
        await expect(page.getByTestId('editor-toolbar')).toBeVisible();
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
