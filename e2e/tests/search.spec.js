const {expect, test} = require('@playwright/test');

const fs = require('fs');

const docs = require('../support/docs');
const {
    MAIN, fixtureFile, modifier, pressShortcut, routes, save, setSource, shot, signIn, writeFixture,
} = require('../support/helpers');
const text = require('../support/text');

test.describe('search', () => {
    test.beforeEach(async ({page}) => {
        await signIn(page);
    });

    test('the palette opens with the keyboard and lists the hits', async ({page}) => {
        await pressShortcut(page, `${await modifier(page)}+k`);

        await expect(page.getByTestId('palette-input')).toBeVisible();
        await expect(page.getByTestId('palette-input')).toBeFocused();

        await page.getByTestId('palette-input').fill(docs.search.prefix);
        await expect(page.getByTestId('palette-item').first()).toBeVisible();
        await shot(page, 'search-palette');

        expect(await page.getByTestId('palette-item').count()).toBeGreaterThan(1);
        await expect(page.getByTestId('palette-item').first()).toHaveAttribute('data-path', /\.md$/);
    });

    test('the slash key opens the palette too', async ({page}) => {
        await pressShortcut(page, '/');

        await expect(page.getByTestId('palette-input')).toBeVisible();
        await expect(page.getByTestId('palette-input')).toBeFocused();
    });

    test('arrowing to a hit and pressing enter opens it', async ({page}) => {
        await pressShortcut(page, `${await modifier(page)}+k`);
        await page.getByTestId('palette-input').fill(docs.search.palette.query);
        await expect(page.getByTestId('palette-item').first()).toBeVisible();

        // nothing is highlighted until the reader arrows onto it, so enter on a
        // freshly typed query would go nowhere
        await expect(page.locator('[data-testid=palette-item][data-selected]')).toHaveCount(0);
        await page.keyboard.press('ArrowDown');
        const selected = page.locator('[data-testid=palette-item][data-selected]');
        await expect(selected).toHaveCount(1);
        await expect(selected).toHaveAttribute('data-path', docs.search.palette.path);

        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(new RegExp(`${routes.doc(docs.search.palette.path)}\\?q=`));
        await expect(page.getByTestId('doc')).toBeVisible();
    });

    test('the search page works from a direct url', async ({page}) => {
        await page.goto(routes.search(docs.search.word));

        await expect(page.getByTestId('search-title')).toContainText(docs.search.word);
        const hits = page.getByTestId('search-result');
        expect(await hits.count()).toBeGreaterThan(1);
        await expect(page.getByTestId('search-count')).toContainText(text.search.results);
        await expect(page.getByTestId('search-count'))
            .toHaveAttribute('data-total', String(await hits.count()));
        await expect(hits.first().getByTestId('search-result-snippet').locator('mark').first()).toBeVisible();
        await shot(page, 'search-page');

        await hits.first().getByTestId('search-result-link').click();
        await expect(page.getByTestId('doc')).toBeVisible();
    });

    test('a result jumps to the match and steps through the others', async ({page}) => {
        await page.goto(routes.search(docs.search.word));
        await page.getByTestId('search-result-link').first().click();

        await expect(page).toHaveURL(/\?q=/);
        // the document is fetched after the navigation and the marks go in once
        // it is on the page, so the bar showing up is the gate to count on
        const counter = page.getByTestId('doc-find-count');
        await expect(counter).toBeVisible();

        const hits = page.getByTestId('find-hit');
        expect(await hits.count()).toBeGreaterThan(0);
        await expect(page.locator('[data-testid=find-hit][data-active="true"]')).toHaveCount(1);
        await expect(counter).toHaveAttribute('data-position', '1');
        await expect(counter).toHaveAttribute('data-total', String(await hits.count()));
        await shot(page, 'search-jump-to-match');

        await page.getByTestId('doc-find-next').click();
        await expect(counter).toHaveAttribute('data-position', '2');
        await page.getByTestId('doc-find-prev').click();
        await expect(counter).toHaveAttribute('data-position', '1');

        // the query leaves the url with the highlighting, so a reload does not
        // light the page up again
        await page.getByTestId('doc-find-close').click();
        await expect(page.getByTestId('doc-find')).toHaveCount(0);
        await expect(hits).toHaveCount(0);
        await expect(page).not.toHaveURL(/\?q=/);
    });

    test('a saved edit shows up in the index', async ({page}) => {
        const docPath = 'e2e-search/indexed.md';
        const word = 'кракозябра';
        writeFixture(docPath, '# Индексируемая\n\nпусто\n');
        await page.goto(routes.edit(docPath));

        await setSource(page, `# Индексируемая\n\n${word}\n`);
        await save(page);

        await expect.poll(async () => {
            await page.goto(routes.search(word));
            return page.getByTestId('search-result-path').allTextContents();
        }).toEqual([docPath]);
        await shot(page, 'search-after-edit');

        fs.rmSync(fixtureFile('e2e-search'), {recursive: true, force: true});
    });

    test('the search page reports an empty result', async ({page}) => {
        await page.goto(routes.search('zzzznotinthecorpuszzzz'));

        await expect(page.getByTestId('search-empty')).toHaveText(text.search.empty);
        await expect(page.getByTestId('search-count')).toHaveCount(0);
    });

    test('the palette says so when nothing matches', async ({page}) => {
        await page.goto(routes.home());
        await pressShortcut(page, `${await modifier(page)}+k`);
        await page.getByTestId('palette-input').fill('zzzznotinthecorpuszzzz');

        await expect(page.getByTestId('palette-empty')).toBeVisible();
        await expect(page.getByTestId('palette-empty')).toHaveAttribute('data-kind', 'none');
        await expect(page.getByTestId('palette-item')).toHaveCount(0);
    });

    // the palette labels a hit with the title of the note and does not mark the
    // term inside it, which the legacy palette did
    test.fixme('the palette highlights the term in its hits', async ({page}) => {
        await pressShortcut(page, `${await modifier(page)}+k`);
        await page.getByTestId('palette-input').fill(docs.search.prefix);

        await expect(page.getByTestId('palette-item').first().locator('mark')).toBeVisible();
    });

    test.afterAll(() => {
        fs.rmSync(fixtureFile('e2e-search'), {recursive: true, force: true});
    });
});
