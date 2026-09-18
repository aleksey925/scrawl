const {expect, test} = require('@playwright/test');

const fs = require('fs');

const {
    MAIN, editorStatus, fixtureFile, modifier, readFixture, removeFixture, routes, save,
    setSource, shot, signIn, sourceText, writeFixture,
} = require('../support/helpers');
const text = require('../support/text');

// scratch keeps every test on its own document, so a failure cannot poison the
// next one and the corpus files stay as they were copied
function scratch(name) {
    return `e2e-scratch/${name}.md`;
}

// openTallDocument writes a note several screens high and opens the editor on
// it, which is what the scroll specs need before they can send a wheel
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

// wheelOverSource sends the deltas a trackpad sends, over the source pane, and
// answers how far it asked the pane to travel
async function wheelOverSource(page, {steps = 20, delta = 60} = {}) {
    const box = await page.getByTestId('editor-source').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < steps; i += 1) {
        await page.mouse.wheel(0, delta);
        await page.waitForTimeout(16);
    }
    return steps * delta;
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

    test('the save shortcut writes the file', async ({page}) => {
        const docPath = scratch('save-shortcut');
        writeFixture(docPath, 'before\n');
        await page.goto(routes.edit(docPath));
        await expect.poll(() => sourceText(page)).toBe('before\n');

        await setSource(page, 'after the shortcut\n');
        await page.keyboard.press(`${await modifier(page)}+s`);

        await expect(editorStatus(page)).toHaveText(text.status.saved);
        await expect.poll(() => readFixture(docPath)).toBe('after the shortcut\n');
        removeFixture(docPath);
    });

    test('trailing whitespace survives a save', async ({page}) => {
        const docPath = scratch('whitespace');
        const body = '- item\n   \n- next\n';
        writeFixture(docPath, body);
        await page.goto(routes.edit(docPath));
        await expect.poll(() => sourceText(page)).toBe(body);

        await setSource(page, `${body}- third\n`);
        await save(page);

        await expect.poll(() => readFixture(docPath)).toBe(`${body}- third\n`);
        removeFixture(docPath);
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

        // the draft is debounced into localStorage and offered on the next load
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

    test('a draft can be thrown away instead of restored', async ({page}) => {
        const docPath = scratch('draft-discard');
        writeFixture(docPath, 'kept\n');
        await page.goto(routes.edit(docPath));
        await expect.poll(() => sourceText(page)).toBe('kept\n');

        await setSource(page, 'a draft nobody wants\n');
        // a reload is not a router navigation, so it leaves without asking and
        // the debounced draft is what is left of the buffer
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
        const copyPath = decodeURIComponent(
            new URL(page.url()).pathname.replace(`${routes.edit('')}`, ''));
        expect(readFixture(copyPath)).toBe('mine to keep\n');
        expect(readFixture(docPath), 'the disk version must be left alone').toBe('disk wins\n');
        await shot(page, 'editing-conflict-copy');

        removeFixture(copyPath);
        removeFixture(docPath);
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

        // the preview arrives after the editor, so it is the pane that says
        // whether the position was held rather than applied once and lost
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

    // the two panes used to answer each other's corrections: a scroll event says
    // an element moved and not who moved it, so each pane kept putting the other
    // back a little off where it had just been. The page shook under a finger
    // that was already scrolling, and a third of the gesture was eaten.
    test('a scroll in one pane does not come back as a shake in both', async ({page}) => {
        const docPath = await openTallDocument(page, 'scroll-sync');
        const tops = () => page.evaluate(() => ({
            source: Math.round(document.querySelector('.cm-scroller').scrollTop),
            preview: Math.round(document.querySelector('[data-testid=editor-preview]').scrollTop),
        }));

        const sent = await wheelOverSource(page);
        await page.waitForTimeout(400);

        const settled = await tops();
        // the wheel was over the source, so the source keeps what it was given
        expect(settled.source).toBeGreaterThan(sent * 0.9);
        // and the preview came along
        expect(settled.preview).toBeGreaterThan(0);

        // nothing moves once the wheel stops
        await page.waitForTimeout(500);
        expect(await tops()).toEqual(settled);

        removeFixture(docPath);
    });

    // the position used to cross as a source line, so the pane that follows
    // could only land where a line did: it stood still for a few frames and
    // then hopped a paragraph's worth at once
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

    test.afterAll(() => {
        fs.rmSync(fixtureFile('e2e-scratch'), {recursive: true, force: true});
    });
});
