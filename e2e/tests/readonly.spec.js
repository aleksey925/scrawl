const {expect, test} = require('@playwright/test');

const docs = require('../support/docs');
const {READONLY, jsonRequest, routes, shot, signIn} = require('../support/helpers');
const text = require('../support/text');

const DOC = docs.doc.path;

test.describe('read-only mode', () => {
    test.beforeEach(async ({page}) => {
        await signIn(page, {baseURL: READONLY.baseURL, from: routes.doc(DOC)});
    });

    test('the reading ui hides every way to write', async ({page}) => {
        await expect(page.getByTestId('doc').locator('h1').first()).toContainText(docs.doc.title);
        await expect(page.getByTestId('sidebar-new-page')).toHaveCount(0);
        await expect(page.getByTestId('sidebar-new-folder')).toHaveCount(0);

        // History reads, so it stays; Edit leads to a save the api refuses, and
        // the ui does not offer what it cannot do
        await expect(page.getByTestId('doc-edit')).toHaveCount(0);
        await expect(page.getByTestId('doc-history')).toBeVisible();

        await page.getByTestId('topbar-account').click();
        await expect(page.getByTestId('topbar-account-readonly')).toBeVisible();
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

    test('the editor opens as a reader and cannot save', async ({page}) => {
        // the legacy route answered 403 outright; the app serves the source with
        // every way to write it taken off the screen
        await page.goto(READONLY.url.edit(DOC));

        await expect(page.getByTestId('editor-readonly')).toContainText(text.editor.readOnly);
        await expect(page.getByTestId('editor-save')).toHaveCount(0);
        await expect(page.getByTestId('editor-toolbar')).toHaveCount(0);
        await expect(page.getByTestId('editor-cancel')).toBeVisible();
        await shot(page, 'readonly-editor-refused');
    });

    test('the write api refuses every mutating call', async ({page}) => {
        const calls = [
            ['PUT', `/api/file/${DOC}`, {content: 'nope', rev: ''}],
            ['POST', '/api/file/e2e-readonly.md', {type: 'file'}],
            ['POST', '/api/file/e2e-readonly', {type: 'dir'}],
            ['DELETE', `/api/file/${DOC}`, undefined],
            ['POST', '/api/move', {from: DOC, to: `${docs.doc.folder}/moved.md`}],
            ['POST', `/api/upload/${docs.doc.folder}`, {}],
        ];
        for (const [method, url, body] of calls) {
            const res = await jsonRequest(page, method, url, body);
            expect(res.status, `${method} ${url}`).toBe(403);
            expect(res.body, `${method} ${url}`).toContain('read-only');
        }
    });

    test('reading endpoints keep working', async ({page}) => {
        const searchURL = `/api/search?q=${encodeURIComponent(docs.search.doc)}`;
        for (const url of ['/api/tree', `/api/file/${DOC}`, '/api/me', searchURL]) {
            const res = await jsonRequest(page, 'GET', url);
            expect(res.status, url).toBe(200);
        }
        const preview = await jsonRequest(page, 'POST', '/api/preview',
            {content: '# Просмотр\n', path: DOC});
        expect(preview.status, 'preview renders nothing to disk, so it stays open').toBe(200);
    });
});
