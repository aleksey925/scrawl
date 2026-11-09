const {expect, test} = require('../support/test');

const fs = require('fs');

const {
    MAIN, SHARED, dialogButtons, editorStatus, fixtureFile, holdRoute, nameOf, readFixture, removeFixture, routes, save,
    setSource, shot, signIn, sourceText, writeFixture,
} = require('../support/helpers');
const text = require('../support/text');

function scratch(name) {
    return `e2e-scratch/${name}.md`;
}

async function openTallDocument(page, name) {
    const docPath = scratch(name);
    const filler = Array
        .from({length: 60}, (_, index) => `Абзац ${index} наполнителя, чтобы было что прокручивать.`)
        .join('\n\n');
    writeFixture(docPath, `# Начало\n\n${filler}\n`);

    await page.goto(routes.edit(docPath));
    await expect(page.getByTestId('editor-preview')).toContainText('Абзац 0');
    return docPath;
}

async function editFromReader(page, docPath, body) {
    writeFixture(docPath, body);
    await page.goto(routes.doc(docPath));
    await page.getByTestId('doc-edit').click();
    await expect.poll(() => sourceText(page)).toBe(body);
}

function holdSave(page) {
    return holdRoute(page, '**/api/file/**', (req) => req.method() === 'PUT');
}

function failSave(page, status) {
    return page.route('**/api/file/**', (route) => (route.request().method() === 'PUT'
        ? route.fulfill({status, json: {error: 'refused'}})
        : route.continue()));
}

async function wheelOverSource(page, {steps = 20, delta = 60} = {}) {
    const box = await page.getByTestId('editor-source').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < steps; i += 1) {
        await page.mouse.wheel(0, delta);
        await page.waitForTimeout(16);
    }
    return steps * delta;
}

function watchCompares(page) {
    const sent = [];
    page.on('request', (req) => {
        if (req.url().endsWith('/api/compare')) {
            sent.push(req.postDataJSON());
        }
    });
    return sent;
}

function sourceLayout(page) {
    return page.getByTestId('editor-source').evaluate((root) => {
        const heights = Array.from(root.querySelectorAll('.cm-line'), (line) => line.offsetHeight);
        const scroller = root.querySelector('.cm-scroller');
        return {
            longLineWrapped: Math.max(...heights) > Math.min(...heights),
            scrollsSideways: scroller.scrollWidth > scroller.clientWidth,
        };
    });
}

function sourceRoom(page) {
    return page.getByTestId('editor-source').evaluate((root) => {
        const pane = root.parentElement.getBoundingClientRect();
        const head = root.parentElement.querySelector('[data-testid=editor-toolbar]').parentElement;
        return {
            editorShort: Math.round(pane.width - root.querySelector('.cm-editor').getBoundingClientRect().width),
            headStart: Math.round(head.firstElementChild.getBoundingClientRect().left - pane.left),
            textStart: Math.round(root.querySelector('.cm-gutters').getBoundingClientRect().left - pane.left),
        };
    });
}

test.describe('editing', () => {
    test.beforeEach(async ({page}) => {
        await signIn(page);
    });

    test('typing updates the preview and the save button writes the file', async ({page}) => {
        const docPath = scratch('save-button');
        writeFixture(docPath, '# Заголовок\n\nстарый текст\n');
        await page.goto(routes.edit(docPath));

        await expect.poll(() => sourceText(page)).toBe('# Заголовок\n\nстарый текст\n');
        await expect(page.getByTestId('editor-preview')).toContainText('Заголовок');

        await setSource(page, '# Заголовок\n\nновый текст\n');
        await expect(page.getByTestId('editor-preview')).toContainText('новый текст');
        await expect(editorStatus(page)).toHaveText(text.status.dirty);
        await expect(editorStatus(page)).toHaveAttribute('data-dirty', 'true');
        await shot(page, 'editing-preview');

        await save(page);
        await expect(editorStatus(page)).toHaveText(text.status.saved);
        expect(readFixture(docPath)).toBe('# Заголовок\n\nновый текст\n');

        await page.reload();
        await expect.poll(() => sourceText(page)).toBe('# Заголовок\n\nновый текст\n');
        await shot(page, 'editing-saved');
        removeFixture(docPath);
    });

    test('the source underlines no heading and no table header', async ({page}) => {
        // arrange
        const docPath = scratch('source-headings');
        writeFixture(docPath, '# Заголовок\n\n| Ресурс | Доля |\n| ------ | ---- |\n| app.js | 61 % |\n');
        await page.goto(routes.edit(docPath));
        await expect(page.locator('.cm-line').first()).toHaveText('# Заголовок');
        await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'light');

        // act
        const underlined = await page.locator('.cm-line span').evaluateAll((spans) => spans
            .filter((span) => getComputedStyle(span).textDecorationLine.includes('underline'))
            .map((span) => span.textContent));

        // assert
        expect(underlined).toEqual([]);

        removeFixture(docPath);
    });

    test('the save shortcut writes the file and stays in the editor', async ({page}) => {
        // arrange
        const docPath = scratch('save-shortcut');
        await editFromReader(page, docPath, 'before\n');
        await setSource(page, 'after the shortcut\n');

        // act
        await page.keyboard.press('ControlOrMeta+s');

        // assert
        await expect(editorStatus(page)).toHaveText(text.status.saved);
        await expect(page).toHaveURL(MAIN.url.edit(docPath));
        await expect(page.getByTestId('editor-source')).toBeVisible();
        expect(readFixture(docPath)).toBe('after the shortcut\n');
        removeFixture(docPath);
    });

    test('trailing whitespace survives a save', async ({page}) => {
        const docPath = scratch('whitespace');
        const body = '- item\n   \n- next\n';
        writeFixture(docPath, body, SHARED);
        await signIn(page, {baseURL: SHARED.baseURL, from: routes.edit(docPath)});
        await expect.poll(() => sourceText(page)).toBe(body);

        await setSource(page, `${body}- third\n`);
        await save(page);

        await expect.poll(() => readFixture(docPath, SHARED)).toBe(`${body}- third\n`);
        removeFixture(docPath, SHARED);
    });

    test('leaving with unsaved changes asks first and keeps a draft', async ({page}) => {
        const docPath = scratch('dirty-guard');
        writeFixture(docPath, 'kept\n');
        await page.goto(routes.edit(docPath));
        await expect.poll(() => sourceText(page)).toBe('kept\n');

        await setSource(page, 'typed but not saved\n');
        await expect(editorStatus(page)).toHaveAttribute('data-dirty', 'true');
        await page.getByTestId('editor-cancel').click();

        await expect(page.locator('.mantine-Modal-title')).toHaveText(text.modal.leave);
        await shot(page, 'editing-leave-guard');
        await page.getByTestId('modal-cancel').click();
        await expect(page).toHaveURL(MAIN.url.edit(docPath));

        await page.waitForTimeout(1000);
        await page.goto(routes.edit(docPath));
        await expect(page.getByTestId('editor-draft')).toContainText(text.editor.draft);
        await shot(page, 'editing-draft-bar');

        await page.getByTestId('editor-draft-restore').click();
        await expect.poll(() => sourceText(page)).toBe('typed but not saved\n');
        await expect(page.getByTestId('editor-draft')).toHaveCount(0);
        expect(readFixture(docPath), 'nothing is written to disk without a save').toBe('kept\n');
        removeFixture(docPath);
    });

    test('Save writes the note and opens the reader', async ({page}) => {
        // arrange
        const docPath = scratch('save-leaves');
        await editFromReader(page, docPath, 'kept\n');
        await setSource(page, 'written\n');

        // act
        await page.getByTestId('editor-save').click();

        // assert
        await expect(page).toHaveURL(MAIN.url.doc(docPath));
        await expect(page.getByTestId('doc')).toContainText('written');
        expect(readFixture(docPath)).toBe('written\n');
        removeFixture(docPath);
    });

    test('Save with nothing changed opens the reader and writes nothing', async ({page}) => {
        // arrange
        const docPath = scratch('save-clean');
        await editFromReader(page, docPath, 'kept\n');
        const writes = [];
        page.on('request', (req) => {
            if (req.method() === 'PUT') {
                writes.push(req.url());
            }
        });

        // act
        await page.getByTestId('editor-save').click();

        // assert
        await expect(page).toHaveURL(MAIN.url.doc(docPath));
        expect(writes).toEqual([]);
        removeFixture(docPath);
    });

    test('Save stays in the editor when the file changed on disk', async ({page}) => {
        // arrange
        const docPath = scratch('save-conflict-stays');
        await editFromReader(page, docPath, 'original\n');
        writeFixture(docPath, 'written by someone else\n');
        await setSource(page, 'my version\n');

        // act
        await page.getByTestId('editor-save').click();
        await expect(page.getByTestId('editor-conflict-overwrite')).toBeVisible();
        await page.getByTestId('editor-conflict-cancel').click();

        // assert
        await expect(page.getByTestId('editor-conflict-overwrite')).toHaveCount(0);
        await expect(page).toHaveURL(MAIN.url.edit(docPath));
        await expect(page.getByTestId('modal-confirm')).toHaveCount(0);
        expect(await sourceText(page)).toBe('my version\n');
        expect(readFixture(docPath)).toBe('written by someone else\n');
        removeFixture(docPath);
    });

    for (const failure of [
        {status: 500, shows: '[data-testid=toast][data-kind="error"]'},
        {status: 401, shows: '[data-testid=editor-session-signin]'},
    ]) {
        test(`Save stays in the editor and keeps the text when the server answers ${failure.status}`, async ({page}) => {
            // arrange
            const docPath = scratch(`save-fails-${failure.status}`);
            await editFromReader(page, docPath, 'kept\n');
            await setSource(page, 'my version\n');
            await failSave(page, failure.status);

            // act
            await page.getByTestId('editor-save').click();

            // assert
            await expect(page.locator(failure.shows)).toBeVisible();
            await expect(page).toHaveURL(MAIN.url.edit(docPath));
            await expect(page.getByTestId('modal-confirm')).toHaveCount(0);
            await expect(editorStatus(page)).toHaveAttribute('data-dirty', 'true');
            expect(await sourceText(page)).toBe('my version\n');
            expect(readFixture(docPath)).toBe('kept\n');
            removeFixture(docPath);
        });
    }

    test('Save stays in the editor when the text changed while the save ran', async ({page}) => {
        // arrange
        const docPath = scratch('save-typed-midway');
        await editFromReader(page, docPath, 'kept\n');
        await setSource(page, 'written\n');
        const {release, reached} = await holdSave(page);

        // act
        await page.getByTestId('editor-save').click();
        await reached;
        await setSource(page, 'written and more\n');
        release();

        // assert
        await expect.poll(() => readFixture(docPath)).toBe('written\n');
        await expect(page.locator('[data-testid=toast][data-kind="ok"]')).toContainText(text.toast.saved);
        await expect(page).toHaveURL(MAIN.url.edit(docPath));
        await expect(editorStatus(page)).toHaveAttribute('data-dirty', 'true');
        expect(await sourceText(page)).toBe('written and more\n');
        removeFixture(docPath);
    });

    test('a Save the person left during does not bring them back when it ends', async ({page}) => {
        // arrange
        const docPath = scratch('save-left-midway');
        await editFromReader(page, docPath, 'kept\n');
        await setSource(page, 'written\n');
        const {release, reached} = await holdSave(page);
        const other = page.locator('[data-testid=tree-row][data-path="guide.md"]').getByTestId('tree-link');

        // act
        await page.getByTestId('editor-save').click();
        await reached;
        await other.click();
        await page.getByTestId('modal-confirm').click();
        await expect(page).toHaveURL(MAIN.url.doc('guide.md'));
        release();

        // assert
        await expect(page.locator('[data-testid=toast][data-kind="ok"]')).toContainText(text.toast.saved);
        await expect(page).toHaveURL(MAIN.url.doc('guide.md'));
        expect(readFixture(docPath)).toBe('written\n');
        removeFixture(docPath);
    });

    test('Save on a note not created yet creates it and opens the reader', async ({page}) => {
        // arrange
        const docPath = scratch('save-new-empty');
        await page.goto(routes.doc(docPath));
        await page.getByTestId('doc-create').click();
        await expect(editorStatus(page)).toHaveAttribute('data-state', 'new');

        // act
        await page.getByTestId('editor-save').click();

        // assert
        await expect(page).toHaveURL(MAIN.url.doc(docPath));
        await expect(page.getByTestId('doc-missing')).toHaveCount(0);
        expect(readFixture(docPath)).toBe('');
        removeFixture(docPath);
    });

    test('a draft can be thrown away instead of restored', async ({page}) => {
        const docPath = scratch('draft-discard');
        writeFixture(docPath, 'kept\n');
        await page.goto(routes.edit(docPath));
        await expect.poll(() => sourceText(page)).toBe('kept\n');

        await setSource(page, 'a draft nobody wants\n');
        await page.waitForTimeout(1000);
        await page.goto(routes.edit(docPath));

        await expect(page.getByTestId('editor-draft')).toBeVisible();
        await page.getByTestId('editor-draft-discard').click();
        await expect(page.getByTestId('editor-draft')).toHaveCount(0);

        await page.goto(routes.edit(docPath));
        await expect(page.getByTestId('editor-draft')).toHaveCount(0);
        removeFixture(docPath);
    });

    test('a file changed behind the browser raises the conflict dialog and overwrite wins', async ({page}) => {
        const docPath = scratch('conflict-overwrite');
        writeFixture(docPath, 'original\n');
        await page.goto(routes.edit(docPath));
        await expect.poll(() => sourceText(page)).toBe('original\n');

        writeFixture(docPath, 'written by someone else\n');
        await setSource(page, 'my version\n');
        await page.getByTestId('editor-save').click();

        const dialog = page.locator('[data-testid=modal][data-variant="conflict"]');
        await expect(dialog).toBeVisible();
        await expect(page.locator('.mantine-Modal-title')).toHaveText(text.modal.conflict);
        await expect(page.getByTestId('editor-conflict-mine')).toHaveText('my version\n');
        await expect(page.getByTestId('editor-conflict-theirs')).toHaveText('written by someone else\n');
        await shot(page, 'editing-conflict');

        await page.getByTestId('editor-conflict-overwrite').click();
        await expect(editorStatus(page)).toHaveText(text.status.saved);
        await expect.poll(() => readFixture(docPath)).toBe('my version\n');
        removeFixture(docPath);
    });

    test('the topbar names the note the editor has open by the same file name as the reader', async ({page}) => {
        // arrange
        const docPath = scratch('editor-crumbs');
        writeFixture(docPath, '# Elsewhere\n');
        await page.goto(routes.doc(docPath));
        const crumbs = page.getByTestId('topbar-crumbs').getByTestId('crumb');
        await expect(crumbs.last()).toHaveText(nameOf(docPath));

        try {
            // act
            await page.getByTestId('doc-edit').click();
            await expect.poll(() => sourceText(page)).toBe('# Elsewhere\n');

            // assert
            await expect(crumbs.last()).toHaveText(nameOf(docPath));
        } finally {
            removeFixture(docPath);
        }
    });

    test('the conflict dialog can keep both versions as a copy', async ({page}) => {
        const docPath = scratch('conflict-copy');
        writeFixture(docPath, 'original\n');
        await page.goto(routes.edit(docPath));
        await expect.poll(() => sourceText(page)).toBe('original\n');

        writeFixture(docPath, 'disk wins\n');
        await setSource(page, 'mine to keep\n');
        await page.getByTestId('editor-save').click();

        await expect(page.locator('[data-testid=modal][data-variant="conflict"]')).toBeVisible();
        await page.getByTestId('editor-conflict-copy').click();

        await expect(page).toHaveURL(/\/edit\/e2e-scratch\/conflict-copy\.conflict-[\d-]+T[\d-]+\.md$/);
        await expect.poll(() => sourceText(page), 'the copy opens with its own text').toBe('mine to keep\n');
        await expect(page.getByTestId('topbar-crumbs').getByTestId('crumb').last())
            .toHaveText(/^conflict-copy\.conflict-[\d-]+T[\d-]+\.md$/);
        const copyPath = decodeURIComponent(
            new URL(page.url()).pathname.replace(`${routes.edit('')}`, ''));
        expect(readFixture(copyPath)).toBe('mine to keep\n');
        expect(readFixture(docPath), 'the disk version must be left alone').toBe('disk wins\n');
        await shot(page, 'editing-conflict-copy');

        removeFixture(copyPath);
        removeFixture(docPath);
    });

    test.describe('a text file that is not a note', () => {
        const TEXT_DIR = 'e2e-scratch/text';

        test.afterEach(() => {
            removeFixture(TEXT_DIR);
        });

        test('opens as plain text with no modes, no toolbar and no preview, and saves as written', async ({page}) => {
            // arrange
            const filePath = `${TEXT_DIR}/plain.txt`;
            const written = '  * not a list\n# not a heading\n';
            writeFixture(filePath, 'before\n');
            const previews = [];
            page.on('request', (request) => {
                if (request.url().includes('/api/preview')) {
                    previews.push(request.url());
                }
            });

            // act
            await page.goto(routes.edit(filePath));
            await expect.poll(() => sourceText(page)).toBe('before\n');
            await setSource(page, written);
            await save(page);

            // assert
            const editor = page.getByTestId('editor');
            await expect(editor).toHaveAttribute('data-kind', 'text');
            await expect(page.getByTestId('editor-language')).toHaveText('Plain text');
            await expect(page.getByTestId('editor-layout-mode')).toHaveCount(0);
            await expect(page.getByTestId('editor-toolbar')).toHaveCount(0);
            await expect(page.getByTestId('editor-preview')).toHaveCount(0);
            await expect.poll(() => readFixture(filePath)).toBe(written);
            expect(previews).toEqual([]);
            await shot(page, 'editing-plain-text');
        });

        test('a file with CRLF line breaks is saved with them and is clean after the save', async ({page}) => {
            // arrange
            const filePath = `${TEXT_DIR}/windows.txt`;
            const written = 'one\r\ntwo\r\n';
            writeFixture(filePath, written);
            await page.goto(routes.edit(filePath));
            await expect.poll(() => sourceText(page)).toBe('one\ntwo\n');

            // act
            await save(page);

            // assert
            await expect(editorStatus(page)).toHaveAttribute('data-dirty', 'false');
            await expect.poll(() => readFixture(filePath)).toBe(written);
        });

        test('an edit to a file with CRLF line breaks keeps them', async ({page}) => {
            // arrange
            const filePath = `${TEXT_DIR}/windows-edited.txt`;
            writeFixture(filePath, 'one\r\ntwo\r\n');
            await page.goto(routes.edit(filePath));
            await expect.poll(() => sourceText(page)).toBe('one\ntwo\n');

            // act
            await setSource(page, 'one\ntwo\nthree\n');
            await save(page);

            // assert
            await expect.poll(() => readFixture(filePath)).toBe('one\r\ntwo\r\nthree\r\n');
        });

        test('a file of a known language is named and colored as code', async ({page}) => {
            // arrange
            const filePath = `${TEXT_DIR}/colored.py`;
            writeFixture(filePath, 'def slugify(title):\n    return title\n');

            // act
            await page.goto(routes.edit(filePath));

            // assert
            await expect(page.getByTestId('editor-language')).toHaveText('Python');
            await expect(page.getByTestId('editor-source').locator('.cm-line span').first()).toBeVisible();
        });

        for (const [file, language, body] of [
            [`${TEXT_DIR}/tools/Makefile`, 'Makefile', 'all:\n\techo "built" # done\n'],
            [`${TEXT_DIR}/Widget.svelte`, 'Svelte', '<script>let count = 0;</script>\n<button>{count}</button>\n'],
            [`${TEXT_DIR}/main.rs`, 'Rust', 'fn main() {\n    println!("hi");\n}\n'],
        ]) {
            test(`${language} opens named and colored`, async ({page}) => {
                // arrange
                writeFixture(file, body);

                // act
                await page.goto(routes.edit(file));

                // assert
                await expect(page.getByTestId('editor')).toHaveAttribute('data-kind', 'text');
                await expect(page.getByTestId('editor-language')).toHaveText(language);
                await expect(page.getByTestId('editor-source').locator('.cm-line span').first()).toBeVisible();
            });
        }

        test('a copy kept from a conflict keeps the file\'s own extension', async ({page}) => {
            // arrange
            const filePath = `${TEXT_DIR}/conflict-copy.txt`;
            writeFixture(filePath, 'original\n');
            await page.goto(routes.edit(filePath));
            await expect.poll(() => sourceText(page)).toBe('original\n');
            writeFixture(filePath, 'disk wins\n');
            await setSource(page, 'mine to keep\n');
            await page.getByTestId('editor-save').click();
            await expect(page.locator('[data-testid=modal][data-variant="conflict"]')).toBeVisible();

            // act
            await page.getByTestId('editor-conflict-copy').click();

            // assert
            await expect(page).toHaveURL(/\/edit\/e2e-scratch\/text\/conflict-copy\.conflict-[\d-]+T[\d-]+\.txt$/);
            const copyPath = decodeURIComponent(new URL(page.url()).pathname.replace(`${routes.edit('')}`, ''));
            expect(readFixture(copyPath)).toBe('mine to keep\n');
        });

        for (const name of ['Makefile', 'go.mod']) {
            test(`a copy kept from a conflict of ${name}, text by its whole name, opens in the editor`, async ({page}) => {
                // arrange
                const filePath = `${TEXT_DIR}/${name}`;
                writeFixture(filePath, 'original\n');
                await page.goto(routes.edit(filePath));
                await expect.poll(() => sourceText(page)).toBe('original\n');
                writeFixture(filePath, 'disk wins\n');
                await setSource(page, 'mine to keep\n');
                await page.getByTestId('editor-save').click();
                await expect(page.locator('[data-testid=modal][data-variant="conflict"]')).toBeVisible();

                // act
                await page.getByTestId('editor-conflict-copy').click();

                // assert
                const escaped = name.replace('.', '\\.');
                await expect(page).toHaveURL(new RegExp(`/edit/e2e-scratch/text/${escaped}\\.conflict-[\\d-]+T[\\d-]+\\.txt$`));
                await expect(page.getByTestId('editor')).toHaveAttribute('data-kind', 'text');
                await expect.poll(() => sourceText(page)).toBe('mine to keep\n');
            });
        }
    });

    test('the editor opens where the reader was, in both panes', async ({page}) => {
        const docPath = scratch('reading-position');
        const filler = (mark) => Array
            .from({length: 30}, (_, index) => `Абзац ${mark}-${index} наполнителя.`).join('\n\n');
        writeFixture(docPath, `# Начало\n\n${filler('a')}\n\n## Середина\n\n${filler('b')}\n`);

        await page.goto(routes.doc(docPath));
        await page.locator('[data-testid=doc] h2').first().evaluate((el) => window.scrollTo({
            top: el.getBoundingClientRect().top + window.scrollY - 150, behavior: 'instant',
        }));

        await page.getByTestId('doc-edit').click();
        await expect(page.getByTestId('editor-source')).toBeVisible();

        const sourceScroll = () => page.locator('[data-testid=editor-source] .cm-scroller')
            .evaluate((el) => el.scrollTop);
        await expect.poll(sourceScroll).toBeGreaterThan(100);

        const preview = page.getByTestId('editor-preview');
        await expect(preview.locator('h2')).toHaveCount(1);
        const headingOffset = () => preview.evaluate((pane) => {
            const heading = pane.querySelector('h2');
            return heading === null
                ? Number.NaN
                : heading.getBoundingClientRect().top - pane.getBoundingClientRect().top;
        });
        await expect.poll(headingOffset).toBeLessThan(250);
        expect(await headingOffset()).toBeGreaterThan(-250);
        await shot(page, 'editing-reading-position');

        removeFixture(docPath);
    });

    test('a scroll in one pane does not come back as a shake in both', async ({page}) => {
        const docPath = await openTallDocument(page, 'scroll-sync');
        const tops = () => page.evaluate(() => ({
            source: Math.round(document.querySelector('.cm-scroller').scrollTop),
            preview: Math.round(document.querySelector('[data-testid=editor-preview]').scrollTop),
        }));

        const sent = await wheelOverSource(page);
        await page.waitForTimeout(400);

        const settled = await tops();
        expect(settled.source).toBeGreaterThan(sent * 0.9);
        expect(settled.preview).toBeGreaterThan(0);

        await page.waitForTimeout(500);
        expect(await tops()).toEqual(settled);

        removeFixture(docPath);
    });

    test('the pane that follows moves with the scroll instead of hopping', async ({page}) => {
        const docPath = await openTallDocument(page, 'scroll-smooth');

        await page.evaluate(() => {
            const source = document.querySelector('.cm-scroller');
            const preview = document.querySelector('[data-testid=editor-preview]');
            window.__frames = [];
            const watch = () => {
                window.__frames.push([source.scrollTop, preview.scrollTop]);
                if (window.__frames.length < 200) requestAnimationFrame(watch);
            };
            requestAnimationFrame(watch);
        });
        await wheelOverSource(page, {steps: 60, delta: 20});
        await page.waitForTimeout(300);

        const moved = await page.evaluate(() => {
            const frames = window.__frames;
            const led = frames.filter((frame, i) => i > 0 && frame[0] !== frames[i - 1][0]);
            const still = frames.filter(
                (frame, i) => i > 0 && frame[0] !== frames[i - 1][0] && frame[1] === frames[i - 1][1]);
            return {led: led.length, still: still.length};
        });

        expect(moved.led).toBeGreaterThan(20);
        expect(moved.still).toBeLessThan(moved.led / 3);

        removeFixture(docPath);
    });

    test('line wrapping is turned off by its button and stays off after a reload', async ({page}) => {
        // arrange
        const docPath = scratch('line-wrap');
        writeFixture(docPath, `короткая\n\n${'длинная строка без переноса '.repeat(40)}\n`);
        await page.goto(routes.edit(docPath));
        await expect.poll(() => sourceLayout(page)).toEqual({longLineWrapped: true, scrollsSideways: false});

        // act
        await page.getByTestId('editor-wrap').click();

        // assert
        await expect.poll(() => sourceLayout(page)).toEqual({longLineWrapped: false, scrollsSideways: true});
        await page.reload();
        await expect(page.getByTestId('editor-wrap')).toHaveAttribute('aria-pressed', 'false');
        await expect.poll(() => sourceLayout(page)).toEqual({longLineWrapped: false, scrollsSideways: true});
    });

    test('the contents button lists the headings under the title as links that open them, and a second press brings it up to date', async ({page}) => {
        // arrange
        const docPath = scratch('toc');
        writeFixture(docPath, '# Заметка\n\nВступление.\n\n## Первый раздел\n\n### Подробности\n\n## Второй `код`\n\n## Первый раздел\n');
        await page.goto(routes.edit(docPath));
        await page.locator('[data-testid=editor-source] .cm-line').nth(2).click();
        await page.keyboard.press('End');
        const block = async () => (await sourceText(page)).replace(/\(#[^)]*\)/g, '(#)');

        // act & assert
        await page.getByTestId('editor-toolbar-toc').click();
        await expect.poll(block).toBe([
            '# Заметка', '', 'Вступление.', '', '<!-- toc -->', '',
            '- [Первый раздел](#)', '  - [Подробности](#)', '- [Второй код](#)', '- [Первый раздел](#)',
            '', '<!-- tocstop -->', '', '## Первый раздел', '', '### Подробности', '', '## Второй `код`', '',
            '## Первый раздел', '',
        ].join('\n'));

        await setSource(page, `${await sourceText(page)}\n## Третий\n`);
        await page.getByTestId('editor-toolbar-toc').click();
        await expect.poll(block).toBe([
            '# Заметка', '', 'Вступление.', '', '<!-- toc -->', '',
            '- [Первый раздел](#)', '  - [Подробности](#)', '- [Второй код](#)', '- [Первый раздел](#)', '- [Третий](#)',
            '', '<!-- tocstop -->', '', '## Первый раздел', '', '### Подробности', '', '## Второй `код`', '',
            '## Первый раздел', '', '## Третий', '',
        ].join('\n'));

        await save(page);
        await page.goto(routes.doc(docPath));
        const links = await page.locator('.markdown-document li > a[href^="#"]').evaluateAll((anchors) => anchors.map(
            (anchor) => [anchor.textContent, document.getElementById(decodeURIComponent(anchor.getAttribute('href').slice(1)))?.textContent.trim(), anchor.getAttribute('href')]));
        expect(links.map(([text]) => text)).toEqual(['Первый раздел', 'Подробности', 'Второй код', 'Первый раздел', 'Третий']);
        expect(links.every(([text, target]) => typeof target === 'string' && target.startsWith(text))).toBe(true);
        expect(new Set(links.map(([, , href]) => href)).size).toBe(links.length);
        removeFixture(docPath);
    });

    test('the contents button says so when the note has no headings under its title, and changes nothing', async ({page}) => {
        // arrange
        const docPath = scratch('toc-none');
        writeFixture(docPath, '# Заметка\n\nТолько текст.\n');
        await page.goto(routes.edit(docPath));

        // act
        await page.getByTestId('editor-toolbar-toc').click();

        // assert
        await expect(page.locator('[data-testid=toast][data-kind="warn"]')).toContainText(text.toast.noHeadings);
        expect(await sourceText(page)).toBe('# Заметка\n\nТолько текст.\n');
        removeFixture(docPath);
    });

    test('the contents button fills in a start marker that has no stop, and keeps the text around it', async ({page}) => {
        // arrange
        const docPath = scratch('toc-lone-start');
        writeFixture(docPath, '# T\n\nIntro.\n\n<!-- toc -->\n\nMore text.\n\n## A\n\n## B\n');
        await page.goto(routes.edit(docPath));
        const filled = [
            '# T', '', 'Intro.', '', '<!-- toc -->', '', '- [A](#a)', '- [B](#b)', '', '<!-- tocstop -->', '',
            'More text.', '', '## A', '', '## B', '',
        ].join('\n');

        // act & assert
        await page.getByTestId('editor-toolbar-toc').click();
        await expect.poll(() => sourceText(page)).toBe(filled);

        await page.getByTestId('editor-toolbar-toc').click();
        await expect.poll(() => sourceText(page)).toBe(filled);
        removeFixture(docPath);
    });

    test('the contents button leaves a stop marker that comes before any start alone', async ({page}) => {
        // arrange
        const docPath = scratch('toc-stop-first');
        writeFixture(docPath, '# T\n\n<!-- tocstop -->\n\nKeep me.\n\n<!-- toc -->\n\n## A\n');
        await page.goto(routes.edit(docPath));
        const filled = [
            '# T', '', '<!-- tocstop -->', '', 'Keep me.', '', '<!-- toc -->', '', '- [A](#a)', '', '<!-- tocstop -->', '',
            '## A', '',
        ].join('\n');

        // act & assert
        await page.getByTestId('editor-toolbar-toc').click();
        await expect.poll(() => sourceText(page)).toBe(filled);

        await page.getByTestId('editor-toolbar-toc').click();
        await expect.poll(() => sourceText(page)).toBe(filled);
        removeFixture(docPath);
    });

    test('the contents button reads markers inside a fenced code block as text', async ({page}) => {
        // arrange
        const docPath = scratch('toc-fenced');
        const example = ['```md', '<!-- toc -->', 'example', '<!-- tocstop -->', '```'];
        writeFixture(docPath, ['# T', '', ...example, '', 'Text.', '', '## A', ''].join('\n'));
        await page.goto(routes.edit(docPath));
        await page.locator('[data-testid=editor-source] .cm-line').nth(0).click();
        await page.keyboard.press('End');
        const filled = [
            '# T', '', '<!-- toc -->', '', '- [A](#a)', '', '<!-- tocstop -->', '', ...example, '', 'Text.', '', '## A', '',
        ].join('\n');

        // act & assert
        await page.getByTestId('editor-toolbar-toc').click();
        await expect.poll(() => sourceText(page)).toBe(filled);

        await page.getByTestId('editor-toolbar-toc').click();
        await expect.poll(() => sourceText(page)).toBe(filled);
        removeFixture(docPath);
    });

    test('the contents button with the cursor in the front matter puts the list after it', async ({page}) => {
        // arrange
        const docPath = scratch('toc-front-matter');
        const note = '---\ntitle: x\n---\n\n# T\n\n## A\n';
        writeFixture(docPath, note);
        await page.goto(routes.edit(docPath));
        await expect.poll(() => sourceText(page)).toBe(note);
        const filled = '---\ntitle: x\n---\n\n<!-- toc -->\n\n- [A](#a)\n\n<!-- tocstop -->\n\n# T\n\n## A\n';

        // act & assert
        await page.getByTestId('editor-toolbar-toc').click();
        await expect.poll(() => sourceText(page)).toBe(filled);

        await page.getByTestId('editor-toolbar-toc').click();
        await expect.poll(() => sourceText(page)).toBe(filled);

        await save(page);
        await page.goto(routes.doc(docPath));
        await expect(page.locator('.markdown-document li > a[href="#a"]')).toHaveText('A');
        removeFixture(docPath);
    });

    test('the contents button reads markers inside the front matter as text', async ({page}) => {
        // arrange
        const docPath = scratch('toc-front-matter-markers');
        const front = ['---', '', '<!-- toc -->', '', '- [A](#a)', '', '<!-- tocstop -->', 'title: x', '---'];
        const note = [...front, '', '## A', ''].join('\n');
        writeFixture(docPath, note);
        await page.goto(routes.edit(docPath));
        await expect.poll(() => sourceText(page)).toBe(note);

        // act
        await page.getByTestId('editor-toolbar-toc').click();

        // assert
        await expect.poll(() => sourceText(page)).toBe(
            [...front, '', '<!-- toc -->', '', '- [A](#a)', '', '<!-- tocstop -->', '', '## A', ''].join('\n'));
        removeFixture(docPath);
    });

    test('the contents button with the cursor in a fenced code block puts the list after the block', async ({page}) => {
        // arrange
        const docPath = scratch('toc-in-code');
        writeFixture(docPath, '# T\n\n```\ncode\n```\n\n## A\n');
        await page.goto(routes.edit(docPath));
        await page.locator('[data-testid=editor-source] .cm-line').nth(3).click();
        await page.keyboard.press('End');
        const filled = '# T\n\n```\ncode\n```\n\n<!-- toc -->\n\n- [A](#a)\n\n<!-- tocstop -->\n\n## A\n';

        // act & assert
        await page.getByTestId('editor-toolbar-toc').click();
        await expect.poll(() => sourceText(page)).toBe(filled);

        await page.getByTestId('editor-toolbar-toc').click();
        await expect.poll(() => sourceText(page)).toBe(filled);
        removeFixture(docPath);
    });

    test('the contents button with the cursor in a table puts the list after the table', async ({page}) => {
        // arrange
        const docPath = scratch('toc-in-table');
        const table = '| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |\n';
        writeFixture(docPath, `# T\n\n${table}\n## A\n`);
        await page.goto(routes.edit(docPath));
        await page.locator('[data-testid=editor-source] .cm-line').nth(4).click();
        await page.keyboard.press('End');
        const filled = `# T\n\n${table}\n<!-- toc -->\n\n- [A](#a)\n\n<!-- tocstop -->\n\n## A\n`;

        // act & assert
        await page.getByTestId('editor-toolbar-toc').click();
        await expect.poll(() => sourceText(page)).toBe(filled);

        await page.getByTestId('editor-toolbar-toc').click();
        await expect.poll(() => sourceText(page)).toBe(filled);
        await expect(page.getByTestId('editor-preview').locator('tbody tr')).toHaveCount(2);
        removeFixture(docPath);
    });

    test('the contents button with the cursor in a math block with a blank line puts the list after the block', async ({page}) => {
        // arrange
        const docPath = scratch('toc-in-math');
        const math = '$$\nx = 1\n\ny = 2\n$$\n';
        writeFixture(docPath, `# T\n\n${math}\n## A\n`);
        await page.goto(routes.edit(docPath));
        await page.locator('[data-testid=editor-source] .cm-line').nth(3).click();
        await page.keyboard.press('End');
        const filled = `# T\n\n${math}\n<!-- toc -->\n\n- [A](#a)\n\n<!-- tocstop -->\n\n## A\n`;

        // act & assert
        await page.getByTestId('editor-toolbar-toc').click();
        await expect.poll(() => sourceText(page)).toBe(filled);

        await page.getByTestId('editor-toolbar-toc').click();
        await expect.poll(() => sourceText(page)).toBe(filled);
        await expect(page.getByTestId('editor-preview').locator('li > a[href="#a"]')).toHaveText('A');
        removeFixture(docPath);
    });

    test('the contents button goes under the last line of a note with no line break at its end', async ({page}) => {
        // arrange
        const docPath = scratch('toc-last-line');
        writeFixture(docPath, '# T\n\n## A');
        await page.goto(routes.edit(docPath));
        await page.locator('[data-testid=editor-source] .cm-line').nth(2).click();
        await page.keyboard.press('End');

        // act
        await page.getByTestId('editor-toolbar-toc').click();

        // assert
        await expect.poll(() => sourceText(page)).toBe('# T\n\n## A\n\n<!-- toc -->\n\n- [A](#a)\n\n<!-- tocstop -->\n');
        removeFixture(docPath);
    });

    test('the contents button on a title right above a heading sets the list apart by blank lines', async ({page}) => {
        // arrange
        const docPath = scratch('toc-title-line');
        writeFixture(docPath, '# T\n## A\n');
        await page.goto(routes.edit(docPath));
        await page.locator('[data-testid=editor-source] .cm-line').nth(0).click();
        await page.keyboard.press('End');

        // act
        await page.getByTestId('editor-toolbar-toc').click();

        // assert
        await expect.poll(() => sourceText(page)).toBe('# T\n\n<!-- toc -->\n\n- [A](#a)\n\n<!-- tocstop -->\n\n## A\n');
        removeFixture(docPath);
    });

    test('the contents button on an empty note says there is nothing to list', async ({page}) => {
        // arrange
        const docPath = scratch('toc-empty');
        writeFixture(docPath, '');
        await page.goto(routes.edit(docPath));

        // act
        await page.getByTestId('editor-toolbar-toc').click();

        // assert
        await expect(page.locator('[data-testid=toast][data-kind="warn"]')).toContainText(text.toast.noHeadings);
        await expect(page.locator('[data-testid=editor-source] .cm-placeholder')).toBeVisible();
        removeFixture(docPath);
    });

    test('the contents lists the headings down to level 4, nested by level, with marks kept as text, but the title, the first of level 1 wherever it stands', async ({page}) => {
        // arrange
        const docPath = scratch('toc-levels');
        const marked = '## Marks \\[x\\] \\_u\\_ \\*s\\* \\<c\\> \\&copy; \\~t\\~ \\$5\\$ \\:smile\\:';
        const caret = '## \\^n';
        const broken = '## A&#10;- B';
        writeFixture(docPath, `${marked}\n\nText.\n\n#### Deep\n\n##### Five\n\n# Second\n\n## Under\n\n${caret}\n\n${broken}\n\n[^n]: Note.\n`);
        await page.goto(routes.edit(docPath));
        await page.locator('[data-testid=editor-source] .cm-line').nth(2).click();
        await page.keyboard.press('End');
        const masked = async () => (await sourceText(page)).replace(/\(#[^)]*\)/g, '(#)');

        // act
        await page.getByTestId('editor-toolbar-toc').click();

        // assert
        await expect.poll(masked).toBe([
            marked, '', 'Text.', '', '<!-- toc -->', '',
            `- [${marked.slice(3)}](#)`, '  - [Deep](#)', '- [Under](#)', `- [${caret.slice(3)}](#)`, '- [A - B](#)',
            '', '<!-- tocstop -->', '', '#### Deep', '', '##### Five', '', '# Second', '', '## Under', '', caret, '', broken, '', '[^n]: Note.', '',
        ].join('\n'));
        const preview = page.getByTestId('editor-preview');
        await expect(preview.locator('li > a[href^="#"]')).toHaveCount(5);
        const pairs = await preview.locator('li > a[href^="#"]').evaluateAll((anchors) => anchors.map((anchor) => [
            anchor.textContent,
            document.getElementById(decodeURIComponent(anchor.getAttribute('href').slice(1)))?.textContent.trim().replace(/\s+/g, ' '),
        ]));
        expect(pairs.map(([label]) => label)).toEqual(pairs.map(([, heading]) => heading));
        removeFixture(docPath);
    });

    test('the contents button says so when the preview fails, and changes nothing', async ({page}) => {
        // arrange
        const docPath = scratch('toc-failed');
        writeFixture(docPath, '# T\n\n## A\n');
        await page.goto(routes.edit(docPath));
        await expect.poll(() => sourceText(page)).toBe('# T\n\n## A\n');
        await page.route('**/api/preview', (route) => route.fulfill({status: 500, body: 'broken'}));

        // act
        await page.getByTestId('editor-toolbar-toc').click();

        // assert
        await expect(page.locator('[data-testid=toast][data-kind="error"]')).toContainText(text.toast.contentsFailed);
        expect(await sourceText(page)).toBe('# T\n\n## A\n');
        removeFixture(docPath);
    });

    test('the contents is built again from the text when it changed while the server answered', async ({page}) => {
        // arrange
        const docPath = scratch('toc-stale');
        writeFixture(docPath, '# T\n\n## A\n');
        await page.goto(routes.edit(docPath));
        await expect.poll(() => sourceText(page)).toBe('# T\n\n## A\n');
        const {release} = await holdRoute(page, '**/api/preview');

        // act
        await page.getByTestId('editor-toolbar-toc').click();
        await setSource(page, '# T\n\n## A\n\n## B\n');
        release();

        // assert
        await expect.poll(() => sourceText(page)).toBe(
            '# T\n\n## A\n\n## B\n\n<!-- toc -->\n\n- [A](#a)\n- [B](#b)\n\n<!-- tocstop -->\n');
        removeFixture(docPath);
    });

    test('the contents still goes into the text when the source was closed for the preview before the server answered', async ({page}) => {
        // arrange
        const docPath = scratch('toc-preview');
        writeFixture(docPath, '# T\n\n## A\n');
        await page.goto(routes.edit(docPath));
        await page.getByTestId('editor-layout-mode').getByText('Source').click();
        await expect.poll(() => sourceText(page)).toBe('# T\n\n## A\n');
        const {release} = await holdRoute(page, '**/api/preview');

        // act
        await page.getByTestId('editor-toolbar-toc').click();
        await page.getByTestId('editor-layout-mode').getByText('Preview').click();
        release();

        // assert
        await expect(page.locator('[data-testid=editor-preview] li > a[href="#a"]')).toBeVisible();
        await page.getByTestId('editor-layout-mode').getByText('Source').click();
        await expect.poll(() => sourceText(page)).toBe('# T\n\n<!-- toc -->\n\n- [A](#a)\n\n<!-- tocstop -->\n\n## A\n');
        removeFixture(docPath);
    });

    test('the leave dialog has the buttons every dialog has: one height, side by side at its end', async ({page}) => {
        // arrange
        const docPath = scratch('leave-buttons');
        writeFixture(docPath, '# Заметка\n');
        await page.goto(routes.edit(docPath));
        await page.locator('[data-testid=editor-source] .cm-content').click();
        await page.keyboard.type('x');

        // act
        await page.getByTestId('editor-cancel').click();

        // assert
        await expect(page.getByTestId('modal-confirm')).toBeVisible();
        const leave = await dialogButtons(page, ['modal-cancel', 'modal-confirm']);
        expect(leave.heights).toEqual([32, 32]);
        expect(leave.rights[0]).toBeLessThan(leave.lefts[1]);
        expect(leave.tops[0]).toBe(leave.tops[1]);
        expect(leave.end).toBe(leave.bodyEnd);
        await page.getByTestId('modal-cancel').click();
        removeFixture(docPath);
    });

    test('the conflict and the session dialogs of the editor set their buttons in one row of 32px at their end', async ({page}) => {
        // arrange
        const docPath = scratch('dialog-buttons');
        writeFixture(docPath, 'original\n');
        await page.goto(routes.edit(docPath));
        await expect.poll(() => sourceText(page)).toBe('original\n');
        writeFixture(docPath, 'written by someone else\n');
        await setSource(page, 'my version\n');
        const conflictIds = ['editor-conflict-cancel', 'editor-conflict-copy', 'editor-conflict-overwrite'];
        const sessionIds = ['editor-session-dismiss', 'editor-session-signin'];

        // act
        await page.getByTestId('editor-save').click();
        await expect(page.getByTestId('editor-conflict-overwrite')).toBeVisible();
        const conflict = await dialogButtons(page, conflictIds);
        await page.getByTestId('editor-conflict-cancel').click();
        await failSave(page, 401);
        await page.getByTestId('editor-save').click();
        await expect(page.getByTestId('editor-session-signin')).toBeVisible();
        const session = await dialogButtons(page, sessionIds);

        // assert
        const row = ({heights, tops, end}) => ({heights, tops, end});
        expect(row(conflict)).toEqual({heights: [32, 32, 32], tops: Array(3).fill(conflict.tops[0]), end: conflict.bodyEnd});
        expect(row(session)).toEqual({heights: [32, 32], tops: Array(2).fill(session.tops[0]), end: session.bodyEnd});
        await page.getByTestId('editor-session-dismiss').click();
        removeFixture(docPath);
    });

    test('in Source the source takes the whole pane and its text and toolbar start where they do in Split', async ({page}) => {
        // arrange
        const docPath = scratch('source-width');
        writeFixture(docPath, 'короткая\n');
        await page.goto(routes.edit(docPath));
        await page.getByTestId('editor-layout-mode').getByText('Split').click();
        await expect(page.getByTestId('editor-panes')).toHaveAttribute('data-mode', 'split');
        const split = await sourceRoom(page);

        // act
        await page.getByTestId('editor-layout-mode').getByText('Source').click();

        // assert
        await expect(page.getByTestId('editor-panes')).toHaveAttribute('data-mode', 'source');
        await expect.poll(() => sourceRoom(page)).toEqual({editorShort: 0, headStart: split.headStart, textStart: split.textStart});
        removeFixture(docPath);
    });

    test('with wrapping off a long line scrolls inside the source and slides under the line numbers', async ({page}) => {
        // arrange
        const docPath = scratch('no-wrap-source');
        writeFixture(docPath, `короткая\n\n${'длинная строка без переноса '.repeat(40)}\n`);
        await page.goto(routes.edit(docPath));
        await page.getByTestId('editor-layout-mode').getByText('Source').click();
        await page.getByTestId('editor-wrap').click();
        await expect.poll(() => sourceLayout(page)).toEqual({longLineWrapped: false, scrollsSideways: true});

        // act
        await page.locator('[data-testid=editor-source] .cm-scroller').evaluate((scroller) => {
            scroller.scrollLeft = 400;
        });

        // assert
        const seen = await page.getByTestId('editor-source').evaluate((root) => {
            const gutters = root.querySelector('.cm-gutters');
            const box = gutters.getBoundingClientRect();
            const number = Array.from(root.querySelectorAll('.cm-lineNumbers .cm-gutterElement'))
                .find((element) => element.textContent === '3').getBoundingClientRect();
            const hit = document.elementFromPoint(box.x - 4, number.y + number.height / 2);
            return {
                numbersOpaque: getComputedStyle(gutters).backgroundColor !== 'rgba(0, 0, 0, 0)',
                textLeftOfNumbers: hit !== null && hit.closest('.cm-content') !== null,
            };
        });
        expect(seen).toEqual({numbersOpaque: true, textLeftOfNumbers: false});
        expect((await sourceRoom(page)).editorShort).toBe(0);
        removeFixture(docPath);
    });

    test.describe('the changes', () => {
        test('show the unsaved edit against the saved note, and nothing once it is saved', async ({page}) => {
            // arrange
            const docPath = scratch('changes-save');
            writeFixture(docPath, '# Заметка\n\nстарый текст\n');
            await page.goto(routes.edit(docPath));
            await expect.poll(() => sourceText(page)).toBe('# Заметка\n\nстарый текст\n');
            await setSource(page, '# Заметка\n\nновый текст\n');

            // act
            await page.getByTestId('editor-layout-mode').getByText('Changes').click();

            // assert
            await expect(page.getByTestId('editor-panes')).toHaveAttribute('data-mode', 'changes');
            await expect(page.getByTestId('editor-source')).toHaveCount(0);
            await expect(page.getByTestId('editor-preview')).toHaveCount(0);
            const diff = page.getByTestId('rendered-diff');
            await expect(diff).toHaveAttribute('data-layout', 'split');
            await expect(diff.locator('[data-testid=diff-row][data-kind=changed] ins')).toHaveText('новый');
            await expect(diff.locator('[data-testid=diff-row][data-kind=changed] del')).toHaveText('старый');
            await shot(page, 'editor-changes');

            // act
            await page.keyboard.press('ControlOrMeta+s');

            // assert
            await expect(page.getByTestId('editor-changes-none')).toBeVisible();
            expect(readFixture(docPath)).toBe('# Заметка\n\nновый текст\n');
            removeFixture(docPath);
        });

        test('are not the layout the editor opens with next time', async ({page}) => {
            // arrange
            const docPath = scratch('changes-not-kept');
            writeFixture(docPath, '# Заметка\n');
            await page.goto(routes.edit(docPath));
            await page.getByTestId('editor-layout-mode').getByText('Preview').click();
            await page.getByTestId('editor-layout-mode').getByText('Changes').click();
            await expect(page.getByTestId('editor-changes-none')).toBeVisible();

            // act
            await page.reload();

            // assert
            await expect(page.getByTestId('editor-panes')).toHaveAttribute('data-mode', 'preview');
            removeFixture(docPath);
        });

        test('ask the server nothing while the note is the same as the saved one', async ({page}) => {
            // arrange
            const docPath = scratch('changes-none');
            writeFixture(docPath, '# Заметка\n');
            await page.goto(routes.edit(docPath));
            await expect.poll(() => sourceText(page)).toBe('# Заметка\n');
            const sent = watchCompares(page);

            // act
            await page.getByTestId('editor-layout-mode').getByText('Changes').click();

            // assert
            await expect(page.getByTestId('editor-changes-none')).toBeVisible();
            await page.waitForTimeout(300);
            expect(sent).toEqual([]);
            removeFixture(docPath);
        });

        test('keep the unsaved text in the source, and ask again only for a new text', async ({page}) => {
            // arrange
            const docPath = scratch('changes-back');
            writeFixture(docPath, '# Заметка\n\nстарый текст\n');
            await page.goto(routes.edit(docPath));
            await expect.poll(() => sourceText(page)).toBe('# Заметка\n\nстарый текст\n');
            await setSource(page, '# Заметка\n\nновый текст\n');
            const sent = watchCompares(page);
            const layoutMode = page.getByTestId('editor-layout-mode');
            const added = page.locator('[data-testid=diff-row][data-kind=changed] ins');
            await layoutMode.getByText('Changes').click();
            await expect(added).toHaveText('новый');

            // act
            await layoutMode.getByText('Source').click();

            // assert
            await expect.poll(() => sourceText(page)).toBe('# Заметка\n\nновый текст\n');

            // act
            await layoutMode.getByText('Changes').click();

            // assert
            await expect(added).toHaveText('новый');
            await page.waitForTimeout(300);
            expect(sent).toEqual([{path: docPath, old: '# Заметка\n\nстарый текст\n', new: '# Заметка\n\nновый текст\n'}]);
            removeFixture(docPath);
        });

        test('say when the note is too large or the server fails, and ask again on the next visit', async ({page}) => {
            // arrange
            const docPath = scratch('changes-notice');
            writeFixture(docPath, '# Заметка\n\nстарый текст\n');
            await page.goto(routes.edit(docPath));
            await expect.poll(() => sourceText(page)).toBe('# Заметка\n\nстарый текст\n');
            await setSource(page, '# Заметка\n\nновый текст\n');
            const layoutMode = page.getByTestId('editor-layout-mode');
            const notice = page.getByTestId('editor-changes-notice');
            await page.route('**/api/compare', (route) => route.fulfill({status: 413, json: {error: 'request body is too large'}}));

            // act
            await layoutMode.getByText('Changes').click();

            // assert
            await expect(notice).toHaveText(text.editor.changesTooLarge);

            // arrange
            await page.unroute('**/api/compare');
            await page.route('**/api/compare', (route) => route.fulfill({status: 500, json: {error: 'broken'}}));

            // act
            await layoutMode.getByText('Source').click();
            await layoutMode.getByText('Changes').click();

            // assert
            await expect(notice).toContainText(text.editor.changesFailed);

            // arrange
            await page.unroute('**/api/compare');

            // act
            await layoutMode.getByText('Source').click();
            await layoutMode.getByText('Changes').click();

            // assert
            await expect(page.locator('[data-testid=diff-row][data-kind=changed] ins')).toHaveText('новый');
            await expect(notice).toHaveCount(0);
            removeFixture(docPath);
        });

        test('keep the diff on screen through a save that formats the note, and ask nothing for the formatted text', async ({page}) => {
            // arrange
            const docPath = scratch('changes-format');
            writeFixture(docPath, '# Заметка\n\nстарый текст\n');
            await page.goto(routes.edit(docPath));
            await expect.poll(() => sourceText(page)).toBe('# Заметка\n\nстарый текст\n');
            await setSource(page, '#  Заметка\n\nновый текст\n');
            const sent = watchCompares(page);
            await page.getByTestId('editor-layout-mode').getByText('Changes').click();
            await expect(page.locator('[data-testid=diff-row][data-kind=changed] ins')).toHaveText('новый');
            await page.evaluate(() => {
                window.changesLoaderShown = false;
                new MutationObserver(() => {
                    if (document.querySelector('[data-testid=editor-changes-loading]') !== null) {
                        window.changesLoaderShown = true;
                    }
                }).observe(document.body, {subtree: true, childList: true});
            });

            // act
            await page.keyboard.press('ControlOrMeta+s');

            // assert
            await expect(page.getByTestId('editor-changes-none')).toBeVisible();
            expect(readFixture(docPath)).toBe('# Заметка\n\nновый текст\n');
            expect(await page.evaluate(() => window.changesLoaderShown)).toBe(false);
            expect(sent).toEqual([{path: docPath, old: '# Заметка\n\nстарый текст\n', new: '#  Заметка\n\nновый текст\n'}]);
            removeFixture(docPath);
        });

        for (const leave of ['cancel', 'save']) {
            test(`keep the reading place, so ${leave === 'save' ? 'Save' : 'Cancel'} opens the reader there`, async ({page}) => {
                // arrange
                const docPath = await openTallDocument(page, `changes-position-${leave}`);
                const layoutMode = page.getByTestId('editor-layout-mode');
                await layoutMode.getByText('Source').click();
                await page.locator('[data-testid=editor-source] .cm-line').first().click();
                await page.keyboard.press('End');
                await page.keyboard.type(' x');
                await wheelOverSource(page);
                await page.waitForTimeout(400);
                const topLine = await page.locator('[data-testid=editor-source] .cm-scroller').evaluate((scroller) => {
                    const top = scroller.getBoundingClientRect().top;
                    return Array.from(scroller.querySelectorAll('.cm-line'))
                        .find((line) => line.getBoundingClientRect().bottom > top && line.textContent.trim().length > 1)
                        .textContent;
                });
                await layoutMode.getByText('Changes').click();
                await expect(page.getByTestId('rendered-diff')).toBeVisible();

                // act
                if (leave === 'save') {
                    await page.getByTestId('editor-save').click();
                } else {
                    await page.getByTestId('editor-cancel').click();
                    await page.getByTestId('modal-confirm').click();
                }

                // assert
                const offset = () => page.locator('[data-testid=doc] p', {hasText: topLine}).evaluate(
                    (el) => el.getBoundingClientRect().top);
                await expect.poll(offset).toBeLessThan(250);
                expect(await offset()).toBeGreaterThan(-250);
                removeFixture(docPath);
            });
        }
    });

    test('the layout switch shows only its icons below the lg width, each named on hover', async ({page}) => {
        // arrange
        const docPath = scratch('layout-icons');
        writeFixture(docPath, '# Заметка\n');
        await page.setViewportSize({width: 1100, height: 900});
        await page.goto(routes.edit(docPath));
        const layoutMode = page.getByTestId('editor-layout-mode');
        await expect(layoutMode).toBeVisible();
        const options = () => layoutMode.locator('[data-segment-text]').evaluateAll((spans) => spans.map((span) => ({
            title: span.parentElement.title,
            shown: span.getBoundingClientRect().width > 1,
        })));

        // act & assert
        expect(await options()).toEqual(['Source', 'Split', 'Preview', 'Changes'].map((title) => ({title, shown: false})));

        // act
        await page.setViewportSize({width: 1440, height: 900});

        // assert
        await expect.poll(options).toEqual(['Source', 'Split', 'Preview', 'Changes'].map((title) => ({title, shown: true})));
        removeFixture(docPath);
    });

    test.describe('the table menu', () => {
        const edits = ['rowAbove', 'rowBelow', 'columnLeft', 'columnRight', 'deleteRow', 'deleteColumn', 'deleteTable'];

        async function putCursor(page, line, key) {
            await page.locator('[data-testid=editor-source] .cm-line').nth(line).click();
            await page.keyboard.press(key);
        }

        async function tableEdit(page, edit) {
            await page.getByTestId('editor-toolbar-table').click();
            await page.getByTestId(`editor-table-${edit}`).click();
        }

        async function menuOffer(page) {
            await page.getByTestId('editor-toolbar-table').click();
            const dropdown = page.getByTestId('editor-table-menu');
            await expect(dropdown).toBeVisible();
            const res = {grid: await dropdown.getByTestId('editor-table-grid').count() > 0, shown: [], enabled: []};
            for (const name of edits) {
                const item = dropdown.getByTestId(`editor-table-${name}`);
                if (await item.count() > 0) {
                    res.shown.push(name);
                    if (await item.isEnabled()) {
                        res.enabled.push(name);
                    }
                }
            }
            await page.keyboard.press('Escape');
            await expect(dropdown).toBeHidden();
            return res;
        }

        test('inserts a table of the chosen size after the line of the cursor, with the cursor in its first cell', async ({page}) => {
            // arrange
            const docPath = scratch('table-insert');
            writeFixture(docPath, '# T\n\nIntro text\n');
            await page.goto(routes.edit(docPath));
            await putCursor(page, 2, 'End');

            await page.getByTestId('editor-toolbar-table').click();
            const grid = page.getByTestId('editor-table-grid');

            // act
            await grid.locator('[data-column="2"][data-row="3"]').hover();
            await expect(page.getByTestId('editor-table-size')).toHaveText('2 × 3');
            const lit = await grid.locator('[data-active=true]').evaluateAll(
                (cells) => cells.map((box) => `${box.dataset.column}:${box.dataset.row}`));
            await grid.locator('[data-column="2"][data-row="3"]').click();
            await page.keyboard.type('A');

            // assert
            expect(lit).toEqual(['1:1', '2:1', '1:2', '2:2', '1:3', '2:3']);
            await expect(page.getByTestId('editor-table-menu')).toBeHidden();
            await expect.poll(() => sourceText(page)).toBe([
                '# T', '', 'Intro text', '', '| A    |     |', '| --- | --- |', '|     |     |', '|     |     |', '',
            ].join('\n'));
            await expect(page.locator('[data-testid=editor-preview] table th')).toHaveCount(2);
            await expect(page.locator('[data-testid=editor-preview] table tbody tr')).toHaveCount(2);
            removeFixture(docPath);
        });

        test('a table inserted on the line under another table stays apart from it', async ({page}) => {
            // arrange
            const docPath = scratch('table-under-table');
            writeFixture(docPath, '| a | b |\n| - | - |\n');
            await page.goto(routes.edit(docPath));
            await putCursor(page, 2, 'End');
            await page.getByTestId('editor-toolbar-table').click();

            // act
            await page.getByTestId('editor-table-grid').locator('[data-column="1"][data-row="2"]').click();

            // assert
            await expect.poll(() => sourceText(page)).toBe([
                '| a | b |', '| - | - |', '', '|     |', '| --- |', '|     |',
            ].join('\n'));
            await expect(page.locator('[data-testid=editor-preview] table')).toHaveCount(2);
            removeFixture(docPath);
        });

        test('the size grid has the focus when the menu opens, takes the arrow keys and Enter, and a table on a blank line takes its place', async ({page}) => {
            // arrange
            const docPath = scratch('table-keys');
            writeFixture(docPath, '# T\n\n\nText\n');
            await page.goto(routes.edit(docPath));
            await putCursor(page, 2, 'End');
            await page.getByTestId('editor-toolbar-table').click();
            await expect(page.getByTestId('editor-table-grid')).toBeFocused();

            // act
            for (const key of ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowDown']) {
                await page.keyboard.press(key);
            }
            await expect(page.getByTestId('editor-table-size')).toHaveText('3 × 2');
            await page.keyboard.press('Enter');

            // assert
            await expect.poll(() => sourceText(page)).toBe([
                '# T', '', '|     |     |     |', '| --- | --- | --- |', '|     |     |     |', '', 'Text', '',
            ].join('\n'));
            removeFixture(docPath);
        });

        test('offers the grid outside a table and the edits inside it, with no row above or row delete on the header', async ({page}) => {
            // arrange
            const docPath = scratch('table-offers');
            writeFixture(docPath, 'Text\n\n| a | b |\n| - | - |\n| 1 | 2 |\n');
            await page.goto(routes.edit(docPath));
            const onHeader = ['rowBelow', 'columnLeft', 'columnRight', 'deleteColumn', 'deleteTable'];

            // act & assert
            await putCursor(page, 0, 'End');
            expect(await menuOffer(page)).toEqual({grid: true, shown: [], enabled: []});

            await putCursor(page, 2, 'Home');
            expect(await menuOffer(page)).toEqual({grid: false, shown: edits, enabled: onHeader});

            await putCursor(page, 3, 'End');
            expect(await menuOffer(page)).toEqual({grid: false, shown: edits, enabled: onHeader});

            await putCursor(page, 4, 'Home');
            expect(await menuOffer(page)).toEqual({grid: false, shown: edits, enabled: edits});

            await putCursor(page, 5, 'Home');
            expect(await menuOffer(page)).toEqual({grid: true, shown: [], enabled: []});
            removeFixture(docPath);
        });

        test('adds and deletes rows and columns where the cursor is, keeps the alignment and deletes the table', async ({page}) => {
            // arrange
            const docPath = scratch('table-edit');
            writeFixture(docPath, '# T\n\n| Name | Age |\n|:--|--:|\n| Ann | 30 |\n\nafter\n');
            await page.goto(routes.edit(docPath));
            const table = ['| Name | Age |', '| :--- | --: |', '| Ann  |  30 |'];
            const note = (...rows) => ['# T', '', ...rows, '', 'after', ''].join('\n');
            await putCursor(page, 4, 'End');

            // act & assert
            await tableEdit(page, 'rowAbove');
            await expect.poll(() => sourceText(page)).toBe(note(table[0], table[1], '|      |     |', table[2]));

            await tableEdit(page, 'columnRight');
            await page.keyboard.type('z');
            await expect.poll(() => sourceText(page)).toBe(note(
                '| Name | Age |     |', '| :--- | --: | --- |', '|      |     | z    |', '| Ann  |  30 |     |',
            ));

            await tableEdit(page, 'deleteColumn');
            await expect.poll(() => sourceText(page)).toBe(note(table[0], table[1], '|      |     |', table[2]));

            await tableEdit(page, 'deleteRow');
            await expect.poll(() => sourceText(page)).toBe(note(...table));

            await tableEdit(page, 'deleteTable');
            await expect.poll(() => sourceText(page)).toBe('# T\n\nafter\n');
            removeFixture(docPath);
        });

        test('a new row of a table in a quote keeps the quote marker', async ({page}) => {
            // arrange
            const docPath = scratch('table-quote');
            writeFixture(docPath, '> | a | b |\n> | --- | --- |\n> | 1 | 2 |\n');
            await page.goto(routes.edit(docPath));
            await putCursor(page, 2, 'End');

            // act
            await tableEdit(page, 'rowBelow');

            // assert
            await expect.poll(() => sourceText(page)).toBe(
                ['> | a   | b   |', '> | --- | --- |', '> | 1   | 2   |', '> |     |     |', ''].join('\n'),
            );
            removeFixture(docPath);
        });

        test('the size grid stops at 1 and at 8, inserts nothing on Enter before a size, and Space inserts', async ({page}) => {
            // arrange
            const docPath = scratch('table-grid-ends');
            writeFixture(docPath, 'Text\n');
            await page.goto(routes.edit(docPath));
            await putCursor(page, 0, 'End');
            await page.getByTestId('editor-toolbar-table').click();
            const size = page.getByTestId('editor-table-size');

            // act & assert
            await page.keyboard.press('Enter');
            await expect(page.getByTestId('editor-table-grid')).toBeVisible();
            await expect(size).toHaveText('Insert table');

            await page.keyboard.press('ArrowLeft');
            await page.keyboard.press('ArrowUp');
            await expect(size).toHaveText('1 × 1');

            for (let step = 0; step < 10; step += 1) {
                await page.keyboard.press('ArrowRight');
                await page.keyboard.press('ArrowDown');
            }
            await expect(size).toHaveText('8 × 8');

            for (let step = 0; step < 7; step += 1) {
                await page.keyboard.press('ArrowDown');
            }
            for (let step = 0; step < 6; step += 1) {
                await page.keyboard.press('ArrowLeft');
            }
            await expect(size).toHaveText('2 × 8');

            for (let step = 0; step < 7; step += 1) {
                await page.keyboard.press('ArrowUp');
            }
            await page.keyboard.press('Space');
            await expect(page.getByTestId('editor-table-menu')).toBeHidden();
            await expect.poll(() => sourceText(page)).toBe(['Text', '', '|     |     |', '| --- | --- |', ''].join('\n'));
            removeFixture(docPath);
        });

        test('the mouse leaving the size grid clears the lit cells', async ({page}) => {
            // arrange
            const docPath = scratch('table-grid-leave');
            writeFixture(docPath, 'Text\n');
            await page.goto(routes.edit(docPath));
            await putCursor(page, 0, 'End');
            await page.getByTestId('editor-toolbar-table').click();
            const grid = page.getByTestId('editor-table-grid');
            await grid.locator('[data-column="3"][data-row="2"]').hover();
            await expect(page.getByTestId('editor-table-size')).toHaveText('3 × 2');
            const box = await grid.boundingBox();

            // act
            await page.mouse.move(box.x + box.width / 2, box.y + box.height + 60);

            // assert
            await expect(page.getByTestId('editor-table-size')).toHaveText('Insert table');
            await expect(grid.locator('[data-active=true]')).toHaveCount(0);
            removeFixture(docPath);
        });

        test('edits on the delimiter row act on the header row and on the column under the cursor', async ({page}) => {
            // arrange
            const docPath = scratch('table-delimiter');
            writeFixture(docPath, '| a | bb | c |\n| - | :-: | - |\n| 1 | 2 | 3 |\n');
            await page.goto(routes.edit(docPath));

            // act & assert
            await putCursor(page, 1, 'End');
            await tableEdit(page, 'deleteColumn');
            await expect.poll(() => sourceText(page)).toBe(['| a   | bb  |', '| --- | :-: |', '| 1   |  2  |', ''].join('\n'));

            await putCursor(page, 1, 'End');
            await tableEdit(page, 'rowBelow');
            await expect.poll(() => sourceText(page)).toBe(
                ['| a   | bb  |', '| --- | :-: |', '|     |     |', '| 1   |  2  |', ''].join('\n'),
            );
            await expect(page.locator('[data-testid=editor-preview] table th')).toHaveCount(2);
            await expect(page.locator('[data-testid=editor-preview] table tbody tr')).toHaveCount(2);
            removeFixture(docPath);
        });

        test('adds a column on the left and a row below, and keeps the cursor in the table after deleting the last row or column', async ({page}) => {
            // arrange
            const docPath = scratch('table-clamps');
            writeFixture(docPath, '| a | b |\n| - | - |\n| 1 | 2 |\n');
            await page.goto(routes.edit(docPath));
            await putCursor(page, 2, 'End');

            // act & assert
            await tableEdit(page, 'columnLeft');
            await page.keyboard.type('x');
            await expect.poll(() => sourceText(page)).toBe(
                ['| a   |     | b   |', '| --- | --- | --- |', '| 1   | x    | 2   |', ''].join('\n'),
            );

            await tableEdit(page, 'deleteRow');
            await page.keyboard.type('y');
            await expect.poll(() => sourceText(page)).toBe(['| a   | y    | b   |', '| --- | --- | --- |', ''].join('\n'));

            await putCursor(page, 0, 'End');
            await tableEdit(page, 'deleteColumn');
            await page.keyboard.type('w');
            await expect.poll(() => sourceText(page)).toBe(['| a   | wy   |', '| --- | --- |', ''].join('\n'));

            await tableEdit(page, 'rowBelow');
            await page.keyboard.type('q');
            await expect.poll(() => sourceText(page)).toBe(['| a   | wy  |', '| --- | --- |', '|     | q    |', ''].join('\n'));
            await expect(page.locator('[data-testid=editor-preview] table th')).toHaveCount(2);
            await expect(page.locator('[data-testid=editor-preview] table tbody tr')).toHaveCount(1);
            removeFixture(docPath);
        });

        test('a row added under the header of a table in a list item stays in that item', async ({page}) => {
            // arrange
            const docPath = scratch('table-list');
            writeFixture(docPath, '- | a | b |\n  | - | - |\n  | 1 | 2 |\n');
            await page.goto(routes.edit(docPath));
            await putCursor(page, 0, 'End');

            // act
            await tableEdit(page, 'rowBelow');

            // assert
            await expect.poll(() => sourceText(page)).toBe(
                ['- | a   | b   |', '  | --- | --- |', '  |     |     |', '  | 1   | 2   |', ''].join('\n'),
            );
            await expect(page.locator('[data-testid=editor-preview] li')).toHaveCount(1);
            await expect(page.locator('[data-testid=editor-preview] li table tbody tr')).toHaveCount(2);
            removeFixture(docPath);
        });

        test('a cursor before the quote marker of a table line counts as in the first column', async ({page}) => {
            // arrange
            const docPath = scratch('table-quote-home');
            writeFixture(docPath, '> | a | b |\n> | - | - |\n> | 1 | 2 |\n');
            await page.goto(routes.edit(docPath));
            await putCursor(page, 0, 'Home');

            // act
            await tableEdit(page, 'columnLeft');

            // assert
            await expect.poll(() => sourceText(page)).toBe(
                ['> |     | a   | b   |', '> | --- | --- | --- |', '> |     | 1   | 2   |', ''].join('\n'),
            );
            removeFixture(docPath);
        });

        test('puts the cursor in the new cell when an emoji stands in a cell before it', async ({page}) => {
            // arrange
            const docPath = scratch('table-emoji');
            writeFixture(docPath, '| 😀 | b |\n| - | - |\n| 1 | 2 |\n');
            await page.goto(routes.edit(docPath));
            await putCursor(page, 0, 'End');

            // act
            await tableEdit(page, 'columnRight');
            await page.keyboard.type('z');

            // assert
            await expect.poll(() => sourceText(page)).toBe(
                ['| 😀   | b   | z    |', '| --- | --- | --- |', '| 1   | 2   |     |', ''].join('\n'),
            );
            removeFixture(docPath);
        });

        test('reads an escaped pipe as text, a table without outer pipes, and rows shorter or longer than the header', async ({page}) => {
            // arrange
            const docPath = scratch('table-shapes');
            writeFixture(docPath, 'a | b\n--- | ---\n1 \\| 2 | 3 | 4\n5 |\n');
            await page.goto(routes.edit(docPath));
            await putCursor(page, 3, 'End');

            // act
            await tableEdit(page, 'rowBelow');

            // assert
            await expect.poll(() => sourceText(page)).toBe([
                '| a      | b   |     |', '| ------ | --- | --- |', '| 1 \\| 2 | 3   | 4   |', '| 5      |     |     |',
                '|        |     |     |', '',
            ].join('\n'));
            removeFixture(docPath);
        });

        for (const [where, before, after] of [
            ['at the start of the file', '| a |\n| - |\n\ntext\n', 'text\n'],
            ['at the end of a file with no newline at its end', 'text\n\n| a |\n| - |', 'text\n'],
            ['with no blank line around it', '# T\n| a |\n| - |\n## U\n', '# T\n## U\n'],
        ]) {
            test(`deletes a table ${where}`, async ({page}) => {
                // arrange
                const docPath = scratch(`table-delete-${where.replaceAll(' ', '-')}`);
                writeFixture(docPath, before);
                await page.goto(routes.edit(docPath));
                await putCursor(page, before.split('\n').findIndex((line) => line === '| a |'), 'End');

                // act
                await tableEdit(page, 'deleteTable');

                // assert
                await expect.poll(() => sourceText(page)).toBe(after);
                removeFixture(docPath);
            });
        }

        test('a pipe after two backslashes is escaped, as the server reads it', async ({page}) => {
            // arrange
            const docPath = scratch('table-backslashes');
            writeFixture(docPath, '| a | b |\n| - | - |\n| x \\\\| y | z |\n');
            await page.goto(routes.edit(docPath));
            await putCursor(page, 2, 'End');

            // act
            await tableEdit(page, 'columnRight');

            // assert
            await expect.poll(() => sourceText(page)).toBe([
                '| a       | b   |     |', '| ------- | --- | --- |', '| x \\\\| y | z   |     |', '',
            ].join('\n'));
            await expect(page.locator('[data-testid=editor-preview] table tbody td')).toHaveText(['x \\| y', 'z', '']);
            removeFixture(docPath);
        });

        test('the last pipe of a row ends it even after a backslash, as the server reads it', async ({page}) => {
            // arrange
            const docPath = scratch('table-trailing-escape');
            writeFixture(docPath, '| a | b |\n| - | - |\n| x \\|\n');
            await page.goto(routes.edit(docPath));
            await putCursor(page, 2, 'End');

            // act
            await tableEdit(page, 'rowBelow');

            // assert
            await expect.poll(() => sourceText(page)).toBe([
                '| a   | b   |', '| --- | --- |', '| x \\ |     |', '|     |     |', '',
            ].join('\n'));
            await expect(page.locator('[data-testid=editor-preview] table tbody td')).toHaveText(['x \\', '', '', '']);
            removeFixture(docPath);
        });
    });

    test.afterAll(() => {
        fs.rmSync(fixtureFile('e2e-scratch'), {recursive: true, force: true});
    });
});
