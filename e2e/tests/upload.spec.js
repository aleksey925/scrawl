const {expect, test} = require('@playwright/test');

const fs = require('fs');

const {SHARED, fixtureFile, shot, signIn, writeFixture} = require('../support/helpers');

// a one pixel png, small enough to inline and real enough to pass the sniffing
// the store does on an upload
const PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const FOLDER = 'e2e-upload';

// sendFile builds a File in the page and hands it to the textarea the way a
// browser would, either through a paste or through a drop
async function sendFile(page, kind, name) {
    await page.locator('#editor-source').evaluate(async (ta, [type, base64, fileName]) => {
        const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
        const file = new File([bytes], fileName, {type: 'image/png'});
        const data = new DataTransfer();
        data.items.add(file);
        const event = type === 'paste'
            ? new ClipboardEvent('paste', {clipboardData: data, bubbles: true, cancelable: true})
            : new DragEvent('drop', {dataTransfer: data, bubbles: true, cancelable: true});
        ta.dispatchEvent(event);
    }, [kind, PNG_BASE64, name]);
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
        await page.goto(`/edit/${docPath}`);

        await page.locator('#editor-source').click();
        await sendFile(page, 'paste', 'e2e-pasted.png');

        await expect(page.locator('#editor-source')).toHaveValue(/!\[\]\(pasted\/e2e-pasted\.png\)/);
        await expect(page.locator('.toast')).toContainText('Image uploaded');
        expect(fs.existsSync(fixtureFile(`${FOLDER}/pasted/e2e-pasted.png`))).toBe(true);
        await shot(page, 'upload-pasted');

        await page.click('[data-editor-save]');
        await expect(page.locator('#status-state')).toHaveText('Saved');

        await page.goto(`/p/${docPath}`);
        const image = page.locator('#doc img');
        await expect(image).toHaveAttribute('src', `/raw/${FOLDER}/pasted/e2e-pasted.png`);
        expect(await image.evaluate((el) => el.naturalWidth)).toBeGreaterThan(0);
        await shot(page, 'upload-rendered');
    });

    test('a rejected file leaves no placeholder behind', async ({page}) => {
        const docPath = `${FOLDER}/rejected.md`;
        writeFixture(docPath, 'body\n');
        await page.goto(`/edit/${docPath}`);

        await page.locator('#editor-source').click();
        await sendFile(page, 'paste', 'notes.txt');

        await expect(page.locator('.toast.is-error')).toBeVisible();
        await expect(page.locator('#editor-source')).toHaveValue('body\n');
        expect(fs.existsSync(fixtureFile(`${FOLDER}/rejected/notes.txt`))).toBe(false);
        await shot(page, 'upload-rejected');
    });

    test('a dropped image is stored and linked', async ({page}) => {
        const docPath = `${FOLDER}/dropped.md`;
        writeFixture(docPath, '# Перетащенное\n\n');
        await page.goto(`/edit/${docPath}`);

        await page.locator('#editor-source').click();
        await sendFile(page, 'drop', 'e2e-dropped.png');

        await expect(page.locator('#editor-source')).toHaveValue(/!\[\]\(dropped\/e2e-dropped\.png\)/);
        expect(fs.existsSync(fixtureFile(`${FOLDER}/dropped/e2e-dropped.png`))).toBe(true);
    });

    test('--upload-dir puts every attachment in one shared folder', async ({page}) => {
        const docPath = `${FOLDER}/shared.md`;
        writeFixture(docPath, '# Общая папка\n\n', SHARED);
        await signIn(page, {baseURL: SHARED.baseURL});
        await page.goto(`${SHARED.baseURL}/edit/${docPath}`);

        await page.locator('#editor-source').click();
        await sendFile(page, 'paste', 'e2e-shared.png');

        await expect(page.locator('#editor-source'))
            .toHaveValue(/!\[\]\(\.\.\/attachments\/e2e-shared\.png\)/);
        expect(fs.existsSync(fixtureFile('attachments/e2e-shared.png', SHARED))).toBe(true);
        expect(fs.existsSync(fixtureFile(`${FOLDER}/shared`, SHARED))).toBe(false);
        await shot(page, 'upload-shared-dir');
    });
});
