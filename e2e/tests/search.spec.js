const {expect, test} = require('@playwright/test');

const fs = require('fs');

const docs = require('../support/docs');
const {
    fixtureFile, modifier, pressShortcut, shot, signIn, writeFixture,
} = require('../support/helpers');

test.describe('search', () => {
    test.beforeEach(async ({page}) => {
        await signIn(page);
    });

    test('the palette opens with the keyboard and its hits highlight the term', async ({page}) => {
        await pressShortcut(page, `${await modifier(page)}+k`);

        const palette = page.locator('#palette');
        await expect(palette).toBeVisible();
        await expect(page.locator('#palette-input')).toBeFocused();

        await page.locator('#palette-input').fill(docs.search.prefix);
        await expect(page.locator('#palette-results .palette-item').first()).toBeVisible();
        await expect(page.locator('#palette-results .palette-item mark').first()).toBeVisible();
        await shot(page, 'search-palette');

        const hits = await page.locator('#palette-results .palette-item').count();
        expect(hits).toBeGreaterThan(1);
    });

    test('enter opens the highlighted hit', async ({page}) => {
        await pressShortcut(page, `${await modifier(page)}+k`);
        await page.locator('#palette-input').fill(docs.search.doc);
        const first = page.locator('#palette-results .palette-item.is-active');
        await expect(first).toBeVisible();

        await page.locator('#palette-input').press('Enter');
        await expect(page).toHaveURL(new RegExp(`/p/${docs.doc.path}$`));
        await expect(page.locator('#doc h1').first()).toContainText(docs.doc.title);
    });

    test('the search page works from a direct url', async ({page}) => {
        await page.goto(`/search?q=${encodeURIComponent(docs.search.word)}`);

        await expect(page.locator('.search-count')).toContainText(docs.search.word);
        const hits = page.locator('.hits .hit');
        expect(await hits.count()).toBeGreaterThan(1);
        await expect(hits.first().locator('.hit-snippet mark').first()).toBeVisible();
        await shot(page, 'search-page');

        await hits.first().locator('.hit-link').click();
        await expect(page.locator('#doc')).toBeVisible();
    });

    test('a saved edit shows up in the index', async ({page}) => {
        const docPath = 'e2e-search/indexed.md';
        const word = 'кракозябра';
        writeFixture(docPath, '# Индексируемая\n\nпусто\n');
        await page.goto(`/edit/${docPath}`);

        await page.locator('#editor-source').fill(`# Индексируемая\n\n${word}\n`);
        await page.click('[data-editor-save]');
        await expect(page.locator('#status-state')).toHaveText('Saved');

        await expect.poll(async () => {
            await page.goto(`/search?q=${encodeURIComponent(word)}`);
            return page.locator('.hits .hit-path').allTextContents();
        }).toEqual([docPath]);
        await shot(page, 'search-after-edit');

        fs.rmSync(fixtureFile('e2e-search'), {recursive: true, force: true});
    });

    test('the search page reports an empty result', async ({page}) => {
        await page.goto('/search?q=zzzznotinthecorpuszzzz');

        await expect(page.locator('.search-count')).toContainText('0 results');
        await expect(page.locator('.empty-title')).toContainText('Nothing found');
    });
});
