const {expect, test} = require('../support/test');

const docs = require('../support/docs');
const {READONLY, jsonRequest, openSpaceMenu, rightClickPrevented, routes, shot, signIn} = require('../support/helpers');
const text = require('../support/text');

const DOC = docs.doc.path;

test.describe('read-only mode', () => {
    test.beforeEach(async ({page}) => {
        await signIn(page, {baseURL: READONLY.baseURL, from: routes.doc(DOC)});
    });

    test('the reading ui hides every way to write', async ({page}) => {
        await expect(page.getByTestId('doc').locator('h1').first()).toContainText(docs.doc.title);
        await expect(page.getByTestId('sidebar-new')).toHaveCount(0);

        await expect(page.getByTestId('doc-edit')).toHaveCount(0);
        await expect(page.getByTestId('doc-history')).toBeVisible();

        await openSpaceMenu(page);
        await expect(page.getByTestId('space-menu-readonly')).toBeVisible();
        await shot(page, 'readonly-view');
    });

    test('the row menu offers only what reads', async ({page}) => {
        await expect(page.locator(`[data-testid=tree-row][data-path="${DOC}"]`)).toBeVisible();
        await page.locator(`[data-testid=tree-row][data-path="${docs.doc.folder}"] [data-testid=tree-row-menu]`)
            .click();

        const items = page.getByTestId('tree-row-menu-dropdown').locator('[data-testid^="tree-row-menu-"]');
        await expect(items).toHaveCount(2);
        await expect(page.getByTestId('tree-row-menu-open')).toBeVisible();
        await expect(page.getByTestId('tree-row-menu-copy-link')).toBeVisible();
        await expect(page.getByTestId('tree-row-menu-rename')).toHaveCount(0);
        await expect(page.getByTestId('tree-row-menu-delete')).toHaveCount(0);
        await expect(page.getByTestId('tree-row-menu-new-page')).toHaveCount(0);
        await shot(page, 'readonly-tree');
    });

    test('a right click on a folder list or on the tree keeps the browser menu', async ({page}) => {
        // arrange
        await page.goto(READONLY.url.dir(docs.folder.path));
        const row = page.locator(`[data-testid=dir-row][data-path="${docs.folder.entry}"]`);
        await expect(row).toBeVisible();
        const list = await page.getByTestId('dir').boundingBox();
        const tree = await page.getByTestId('tree-root').boundingBox();

        // act
        const onPage = await rightClickPrevented(page, page.getByTestId('dir'), {position: {x: list.width / 2, y: list.height - 20}});
        const onTree = await rightClickPrevented(page, page.getByTestId('tree-root'), {position: {x: tree.width / 2, y: tree.height - 10}});
        const onRow = await rightClickPrevented(page, row);

        // assert
        expect([onPage, onTree, onRow]).toEqual([false, false, true]);
        await expect(page.getByTestId('tree-row-menu-rename')).toHaveCount(0);
        await expect(page.getByTestId('dir-context-menu')).toHaveCount(0);
        await expect(page.getByTestId('tree-context-menu')).toHaveCount(0);
    });

    test('the editor opens as a reader and cannot save', async ({page}) => {
        await page.goto(READONLY.url.edit(DOC));

        await expect(page.getByTestId('editor-readonly')).toContainText(text.editor.readOnly);
        await expect(page.getByTestId('editor-save')).toHaveCount(0);
        await expect(page.getByTestId('editor-toolbar')).toHaveCount(0);
        await expect(page.getByTestId('editor-cancel')).toBeVisible();
        await shot(page, 'readonly-editor-refused');
    });

    test('the write api refuses every mutating call', async ({page}) => {
        const calls = [
            ['PUT', routes.api(`/file/${DOC}`), {content: 'nope', rev: ''}],
            ['POST', routes.api('/file/e2e-readonly.md'), {type: 'file'}],
            ['POST', routes.api('/file/e2e-readonly'), {type: 'dir'}],
            ['DELETE', routes.api(`/file/${DOC}`), undefined],
            ['POST', routes.api('/move'), {from: DOC, to: `${docs.doc.folder}/moved.md`}],
            ['POST', routes.api(`/upload/${docs.doc.folder}`), {}],
            ['POST', routes.api('/trash/restore'), {id: 'any'}],
        ];
        for (const [method, url, body] of calls) {
            const res = await jsonRequest(page, method, url, body);
            expect(res.status, `${method} ${url}`).toBe(403);
            expect(res.body, `${method} ${url}`).toContain('read-only');
        }
    });

    test('reading endpoints keep working', async ({page}) => {
        const searchURL = routes.api(`/search?q=${encodeURIComponent(docs.search.doc)}`);
        const reads = [routes.api('/tree'), routes.api(`/file/${DOC}`), routes.api('/me'), searchURL];
        for (const url of reads) {
            const res = await jsonRequest(page, 'GET', url);
            expect(res.status, url).toBe(200);
        }
        const preview = await jsonRequest(page, 'POST', routes.api('/preview'),
            {content: '# Просмотр\n', path: DOC});
        expect(preview.status, 'preview renders nothing to disk, so it stays open').toBe(200);
    });
});
