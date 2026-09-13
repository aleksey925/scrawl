const {expect, test} = require('@playwright/test');

const fs = require('fs');

const {
    SHARED, fixtureFile, routes, save, shot, signIn, sourceText, writeFixture,
} = require('../support/helpers');
const text = require('../support/text');

// a one pixel png, small enough to inline and real enough to pass the sniffing
// the store does on an upload
const PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const FOLDER = 'e2e-upload';

// sendFile builds a File in the page and hands it to the editor the way a
// browser would, either through a paste or through a drop
async function sendFile(page, kind, name, type = 'image/png') {
    await page.locator('[data-testid=editor-source] .cm-content').evaluate(
        async (el, [event, base64, fileName, mime]) => {
            const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
            const file = new File([bytes], fileName, {type: mime});
            const data = new DataTransfer();
            data.items.add(file);
            el.dispatchEvent(event === 'paste'
                ? new ClipboardEvent('paste', {clipboardData: data, bubbles: true, cancelable: true})
                : new DragEvent('drop', {dataTransfer: data, bubbles: true, cancelable: true}));
        }, [kind, PNG_BASE64, name, type]);
}

test.describe.serial('upload', () => {
    test.beforeEach(async ({page}) => {
        await signIn(page);
    });

    test.afterAll(() => {
        fs.rmSync(fixtureFile(FOLDER), {recursive: true, force: true});
        fs.rmSync(fixtureFile(FOLDER, SHARED), {recursive: true, force: true});
        fs.rmSync(fixtureFile('attachments/e2e-shared.png', SHARED), {force: true});
    });

    test('a pasted image lands in a folder named after the document', async ({page}) => {
        const docPath = `${FOLDER}/pasted.md`;
        writeFixture(docPath, '# Со скриншотом\n\n');
        await page.goto(routes.edit(docPath));
        await expect.poll(() => sourceText(page)).toContain('Со скриншотом');

        await page.locator('[data-testid=editor-source] .cm-content').click();
        await sendFile(page, 'paste', 'e2e-pasted.png');

        await expect.poll(() => sourceText(page)).toContain('![](pasted/e2e-pasted.png)');
        await expect(page.locator('[data-testid=toast][data-kind="ok"]'))
            .toContainText(text.toast.imageUploaded);
        expect(fs.existsSync(fixtureFile(`${FOLDER}/pasted/e2e-pasted.png`))).toBe(true);
        await shot(page, 'upload-pasted');

        await save(page);

        await page.goto(routes.doc(docPath));
        const image = page.getByTestId('doc').locator('img');
        await expect(image).toHaveAttribute('src', `/raw/${FOLDER}/pasted/e2e-pasted.png`);
        expect(await image.evaluate((el) => el.naturalWidth)).toBeGreaterThan(0);
        await shot(page, 'upload-rendered');
    });

    test('a rejected file leaves no placeholder behind', async ({page}) => {
        const docPath = `${FOLDER}/rejected.md`;
        writeFixture(docPath, 'body\n');
        await page.goto(routes.edit(docPath));
        await expect.poll(() => sourceText(page)).toBe('body\n');

        await page.locator('[data-testid=editor-source] .cm-content').click();
        await sendFile(page, 'paste', 'notes.txt', 'text/plain');

        await expect(page.locator('[data-testid=toast][data-kind="error"]')).toBeVisible();
        // the placeholder the upload put in is taken back out, so a save now
        // would write exactly what was there before
        await expect.poll(() => sourceText(page)).toBe('body\n');
        expect(fs.existsSync(fixtureFile(`${FOLDER}/rejected/notes.txt`))).toBe(false);
        await shot(page, 'upload-rejected');
    });

    test('a dropped image is stored and linked', async ({page}) => {
        const docPath = `${FOLDER}/dropped.md`;
        writeFixture(docPath, '# Перетащенное\n\n');
        await page.goto(routes.edit(docPath));
        await expect.poll(() => sourceText(page)).toContain('Перетащенное');

        await page.locator('[data-testid=editor-source] .cm-content').click();
        await sendFile(page, 'drop', 'e2e-dropped.png');

        await expect.poll(() => sourceText(page)).toContain('![](dropped/e2e-dropped.png)');
        expect(fs.existsSync(fixtureFile(`${FOLDER}/dropped/e2e-dropped.png`))).toBe(true);
    });

    test('--upload-dir puts every attachment in one shared folder', async ({page}) => {
        const docPath = `${FOLDER}/shared.md`;
        writeFixture(docPath, '# Общая папка\n\n', SHARED);
        await signIn(page, {baseURL: SHARED.baseURL, from: routes.edit(docPath)});
        await expect.poll(() => sourceText(page)).toContain('Общая папка');

        await page.locator('[data-testid=editor-source] .cm-content').click();
        await sendFile(page, 'paste', 'e2e-shared.png');

        await expect.poll(() => sourceText(page)).toContain('![](../attachments/e2e-shared.png)');
        expect(fs.existsSync(fixtureFile('attachments/e2e-shared.png', SHARED))).toBe(true);
        expect(fs.existsSync(fixtureFile(`${FOLDER}/shared`, SHARED))).toBe(false);
        await shot(page, 'upload-shared-dir');
    });
});
