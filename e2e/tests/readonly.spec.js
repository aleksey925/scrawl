const {expect, test} = require('@playwright/test');

const docs = require('../support/docs');
const {READONLY, jsonRequest, shot, signIn} = require('../support/helpers');

const DOC = docs.doc.path;

test.describe('read-only mode', () => {
    test.beforeEach(async ({page}) => {
        await signIn(page, {baseURL: READONLY.baseURL});
    });

    test('the reading ui hides every editing affordance', async ({page}) => {
        await page.goto(`${READONLY.baseURL}/p/${DOC}`);
        await page.waitForLoadState('networkidle');

        await expect(page.locator('#doc h1').first()).toContainText(docs.doc.title);
        await expect(page.locator('.topbar-edit')).toHaveCount(0);
        await expect(page.locator('.doc-foot .doc-edit')).toHaveCount(0);
        await expect(page.locator('.sidebar-foot')).toHaveCount(0);
        await expect(page.locator('#sidebar')).toHaveAttribute('data-readonly', '');
        await shot(page, 'readonly-view');
    });

    test('the tree builds no row action menu', async ({page}) => {
        await page.goto(`${READONLY.baseURL}/p/${DOC}`);
        await page.waitForLoadState('networkidle');
        await expect(page.locator(`#sidebar .tree-row[data-path="${DOC}"]`)).toBeVisible();

        await expect(page.locator('#sidebar .row-more')).toHaveCount(0);
        await expect(page.locator('#sidebar [data-actions]')).toHaveCount(0);
        await shot(page, 'readonly-tree');
    });

    test('the editor route is refused', async ({page}) => {
        const response = await page.goto(`${READONLY.baseURL}/edit/${DOC}`);

        expect(response.status()).toBe(403);
        await expect(page.locator('.error-code')).toHaveText('403');
        await shot(page, 'readonly-editor-refused');
    });

    test('the write api refuses every mutating call', async ({page}) => {
        await page.goto(`${READONLY.baseURL}/p/${DOC}`);

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
        await page.goto(`${READONLY.baseURL}/p/${DOC}`);

        const searchURL = `/api/search?q=${encodeURIComponent(docs.search.doc)}`;
        for (const url of ['/api/tree', `/api/file/${DOC}`, searchURL]) {
            const res = await jsonRequest(page, 'GET', url);
            expect(res.status, url).toBe(200);
        }
        const preview = await jsonRequest(page, 'POST', '/api/preview',
            {content: '# Просмотр\n', path: DOC});
        expect(preview.status, 'preview renders nothing to disk, so it stays open').toBe(200);
    });
});
