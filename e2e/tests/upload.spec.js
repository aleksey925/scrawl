const {expect, test} = require('../support/test');

const fs = require('fs');

const {
    MAIN, SHARED, fixtureFile, holdRoute, routes, save, shot, signIn, sourceText, stays, writeFixture,
} = require('../support/helpers');
const text = require('../support/text');

const PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const FOLDER = 'e2e-upload';

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
        await expect(image).toHaveAttribute('src', routes.raw(`${FOLDER}/pasted/e2e-pasted.png`));
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

    test('leaving while a picture uploads asks Discard changes, and Keep editing lets the link land', async ({page}) => {
        // arrange
        const docPath = `${FOLDER}/leave-uploading.md`;
        writeFixture(docPath, '# Загрузка\n\n');
        await page.goto(routes.edit(docPath));
        await expect.poll(() => sourceText(page)).toContain('Загрузка');
        const {release, reached} = await holdRoute(page, '**/api/upload/**');
        await page.locator('[data-testid=editor-source] .cm-content').click();
        await sendFile(page, 'paste', 'e2e-leave-uploading.png');
        await reached;

        // act & assert
        await page.getByTestId('editor-cancel').click();
        await expect(page.locator('.mantine-Modal-title')).toHaveText(text.modal.discard);
        await expect(page.getByTestId('modal')).toHaveText(text.modal.discardUploading);
        await page.getByTestId('modal-cancel').click();
        await expect(page).toHaveURL(MAIN.url.edit(docPath));
        release();
        await expect.poll(() => sourceText(page)).toContain('![](leave-uploading/e2e-leave-uploading.png)');
    });

    test('a picture that lands while the source is hidden replaces its placeholder', async ({page}) => {
        // arrange
        const docPath = `${FOLDER}/preview-uploading.md`;
        writeFixture(docPath, '# Предпросмотр\n\n');
        await page.goto(routes.edit(docPath));
        await expect.poll(() => sourceText(page)).toContain('Предпросмотр');
        const {release, reached} = await holdRoute(page, '**/api/upload/**');
        await page.locator('[data-testid=editor-source] .cm-content').click();
        await sendFile(page, 'paste', 'e2e-preview-uploading.png');
        await reached;
        await page.getByTestId('editor-layout-mode').getByText('Preview').click();

        // act
        release();

        // assert
        await expect(page.locator('[data-testid=toast][data-kind="ok"]')).toContainText(text.toast.imageUploaded);
        await page.getByTestId('editor-layout-mode').getByText('Source').click();
        await expect.poll(() => sourceText(page)).toContain('![](preview-uploading/e2e-preview-uploading.png)');
        expect(await sourceText(page)).not.toContain('uploading-');
    });

    test('Discard while a picture uploads stops the typing, the toolbar and the draft while the reader loads', async ({page}) => {
        // arrange
        const docPath = `${FOLDER}/discard-uploading.md`;
        writeFixture(docPath, '# Сброс\n\n');
        const reader = await holdRoute(page, '**/assets/DocumentPage.js');
        await page.goto(routes.edit(docPath));
        await expect.poll(() => sourceText(page)).toContain('Сброс');
        const upload = await holdRoute(page, '**/api/upload/**');
        await page.locator('[data-testid=editor-source] .cm-content').click();
        await sendFile(page, 'paste', 'e2e-discard-uploading.png');
        await upload.reached;
        const before = await sourceText(page);
        await page.getByTestId('editor-cancel').click();
        await expect(page.locator('.mantine-Modal-title')).toHaveText(text.modal.discard);

        // act
        await page.getByTestId('modal-confirm').click();
        await expect(page.getByTestId('modal')).toHaveCount(0);
        await page.locator('[data-testid=editor-source] .cm-content').click();
        await page.keyboard.type('typed after Discard');
        await page.getByTestId('editor-toolbar-bold').click();
        await page.getByTestId('editor-upload-input').setInputFiles({
            name: 'e2e-picked-after-discard.png',
            mimeType: 'image/png',
            buffer: Buffer.from(PNG_BASE64, 'base64'),
        });
        await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));

        // assert
        const drafts = () => page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('scrawl.draft:')));
        await stays(drafts, [], 1500);
        expect(await sourceText(page)).toBe(before);
        reader.release();
        upload.release();
        await expect(page).toHaveURL(MAIN.url.doc(docPath));
    });
});
