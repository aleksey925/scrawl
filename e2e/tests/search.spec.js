const {expect, test} = require('../support/test');

const fs = require('fs');

const docs = require('../support/docs');
const {
    MAIN, fixtureFile, modifier, pressShortcut, routes, save, setSource, shot, signIn, writeFixture,
} = require('../support/helpers');
const text = require('../support/text');

const MANY = 'e2e-search/many.md';

// indexed waits for the watcher to bring a fixture written by a test into the
// index, which the search reads
async function indexed(page, word, path) {
    await expect.poll(async () => {
        const res = await page.request.get(`${MAIN.baseURL}${routes.api(`/search?q=${encodeURIComponent(word)}`)}`);
        return (await res.json()).hits.map((hit) => hit.path);
    }).toContain(path);
}

async function openSearch(page) {
    await pressShortcut(page, `${await modifier(page)}+k`);
    await expect(page.getByTestId('search-input')).toBeFocused();
}

test.describe('search', () => {
    test.beforeEach(async ({page}) => {
        await signIn(page);
    });

    test('Cmd+K opens the search, which lists notes with their matching lines', async ({page}) => {
        await openSearch(page);

        await page.getByTestId('search-input').fill(docs.search.prefix);
        await expect(page.getByTestId('search-result').first()).toBeVisible();
        await shot(page, 'search-dialog');

        expect(await page.getByTestId('search-result').count()).toBeGreaterThan(1);
        await expect(page.getByTestId('search-result').first()).toHaveAttribute('data-path', /\.md$/);
        await expect(page.getByTestId('search-line').first()).toHaveAttribute('data-line', /^\d+$/);
        await expect(page.getByTestId('search-line').first().locator('mark').first()).toBeVisible();
        await expect(page.getByTestId('search-stats')).toContainText(' ms');
    });

    test('the slash key opens nothing', async ({page}) => {
        await pressShortcut(page, '/');

        await expect(page.getByTestId('search-dialog')).toHaveCount(0);
    });

    test('a line picked with the arrows opens the note at it with the find filled in', async ({page}) => {
        await openSearch(page);
        await page.getByTestId('search-input').fill(docs.search.palette.query);
        await expect(page.getByTestId('search-line').first()).toBeVisible();

        await page.keyboard.press('ArrowDown');
        await expect(page.locator('[data-testid=search-result][data-active="true"]'))
            .toHaveAttribute('data-path', docs.search.palette.path);
        await page.keyboard.press('ArrowDown');
        await expect(page.locator('[data-testid=search-line][data-active="true"]')).toHaveCount(1);

        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(new RegExp(`${routes.doc(docs.search.palette.path)}\\?.*line=\\d+`));
        await expect(page).toHaveURL(/[?&]q=/);
        await expect(page.getByTestId('doc')).toBeVisible();
    });

    test('Alt+R turns Regex on, which takes the mode away and says what is wrong with a pattern', async ({page}) => {
        await openSearch(page);
        await page.getByTestId('search-input').fill('(');

        await page.keyboard.press('Alt+KeyR');

        await expect(page.getByTestId('search-regex')).toHaveAttribute('data-on', 'true');
        await expect(page.getByTestId('search-mode').locator('input').first()).toBeDisabled();
        await expect(page.getByTestId('search-error')).toContainText('missing closing )');
        await expect(page.getByTestId('search-hint')).toHaveText(text.search.regexHint);
    });

    test('Exact turns on Match case and Whole word, which narrow the lines', async ({page}) => {
        writeFixture(MANY, '# Many\n\nKumquat here\n\nkumquat there\n\nkumquats elsewhere\n');
        await indexed(page, 'kumquats', MANY);
        await openSearch(page);
        await page.getByTestId('search-input').fill('kumquat');
        const lines = page.locator(`[data-testid=search-result][data-path="${MANY}"] ~ [data-testid=search-line]`);
        await expect(page.getByTestId('search-case')).toBeDisabled();

        await page.keyboard.press('Alt+KeyF');
        await expect(page.getByTestId('search-mode')).toHaveAttribute('data-mode', 'exact');
        await expect(lines).toHaveCount(3);
        await page.keyboard.press('Alt+KeyW');
        await expect(lines).toHaveCount(2);
        await page.keyboard.press('Alt+KeyC');
        await expect(lines).toHaveCount(1);
    });

    test('a note shows three lines and the rest on a click', async ({page}) => {
        writeFixture(MANY, `# Many\n\n${Array.from({length: 6}, (_, i) => `zebrafinch ${i}`).join('\n\n')}\n`);
        await indexed(page, 'zebrafinch', MANY);
        await openSearch(page);
        await page.getByTestId('search-input').fill('zebrafinch');
        const lines = page.locator(`[data-testid=search-result][data-path="${MANY}"] ~ [data-testid=search-line]`);

        await expect(lines).toHaveCount(3);
        await expect(page.getByTestId('search-more')).toHaveText('3 more lines');
        await page.getByTestId('search-more').click();
        await expect(lines).toHaveCount(6);
    });

    test('the search page works from a direct url', async ({page}) => {
        await page.goto(routes.search(docs.search.word));

        await expect(page.getByTestId('search-title')).toContainText(docs.search.word);
        const hits = page.getByTestId('search-result');
        expect(await hits.count()).toBeGreaterThan(1);
        await expect(page.getByTestId('search-count')).toContainText(text.search.results);
        await expect(page.getByTestId('search-count'))
            .toHaveAttribute('data-total', String(await hits.count()));
        await expect(page.getByTestId('search-line').first().locator('mark').first()).toBeVisible();
        await shot(page, 'search-page');

        await hits.first().click();
        await expect(page.getByTestId('doc')).toBeVisible();
    });

    test('a result jumps to the match and steps through the others', async ({page}) => {
        await page.goto(routes.search(docs.search.word));
        await page.getByTestId('search-result').first().click();
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
            return page.getByTestId('search-result').evaluateAll((heads) => heads.map((head) => head.dataset.path));
        }).toEqual([docPath]);
        await shot(page, 'search-after-edit');

        fs.rmSync(fixtureFile('e2e-search'), {recursive: true, force: true});
    });

    test('the search page reports an empty result', async ({page}) => {
        await page.goto(routes.search('zzzznotinthecorpuszzzz'));

        await expect(page.getByTestId('search-empty')).toHaveText(text.search.empty);
        await expect(page.getByTestId('search-count')).toHaveCount(0);
    });

    test('the search says so when nothing matches', async ({page}) => {
        await page.goto(routes.home());
        await openSearch(page);
        await page.getByTestId('search-input').fill('zzzznotinthecorpuszzzz');

        await expect(page.getByTestId('search-empty')).toHaveText(text.search.empty);
        await expect(page.getByTestId('search-result')).toHaveCount(0);
    });

    test('an empty field shows the notes opened last', async ({page}) => {
        await page.goto(routes.doc(docs.search.palette.path));
        await expect(page.getByTestId('doc')).toBeVisible();
        await openSearch(page);

        await expect(page.getByTestId('search-recent-item').first()).toContainText(docs.search.palette.path);
    });

    test.afterAll(() => {
        fs.rmSync(fixtureFile('e2e-search'), {recursive: true, force: true});
    });
});

test.describe('find in the note', () => {
    const FIND = 'e2e-find/note.md';

    test.beforeAll(() => {
        writeFixture(FIND, [
            '# Find',
            '',
            'Plain foo **bar** here. Foobar too.',
            '',
            'Second Foo line.',
            '',
            '<details>',
            '<summary>More</summary>',
            '',
            'The hidden kumquat sits here.',
            '',
            '</details>',
            '',
        ].join('\n'));
    });

    test.beforeEach(async ({page}) => {
        await signIn(page);
        await page.goto(routes.doc(FIND));
        await expect(page.getByTestId('doc')).toBeVisible();
    });

    async function openFind(page) {
        await pressShortcut(page, `${await modifier(page)}+f`);
        await expect(page.getByTestId('doc-find-input')).toBeFocused();
    }

    test('Cmd+F opens the bar, which counts and steps through the matches', async ({page}) => {
        // arrange
        const counter = page.getByTestId('doc-find-count');
        await openFind(page);

        // act
        await page.keyboard.type('foo');

        // assert
        await expect(counter).toHaveAttribute('data-total', '3');
        await expect(counter).toHaveAttribute('data-position', '1');
        await page.keyboard.press('Enter');
        await expect(counter).toHaveAttribute('data-position', '2');
        await page.keyboard.press('Shift+Enter');
        await expect(counter).toHaveAttribute('data-position', '1');
        await shot(page, 'find-in-note');
    });

    test('Case and Whole word narrow the matches', async ({page}) => {
        // arrange
        const counter = page.getByTestId('doc-find-count');
        await openFind(page);
        await page.keyboard.type('foo');
        await expect(counter).toHaveAttribute('data-total', '3');

        // act & assert
        await page.getByTestId('doc-find-case').click();
        await expect(counter).toHaveAttribute('data-total', '1');
        await page.getByTestId('doc-find-case').click();
        await page.getByTestId('doc-find-word').click();
        await expect(counter).toHaveAttribute('data-total', '2');
    });

    test('a phrase across bold is one match', async ({page}) => {
        // arrange
        await openFind(page);

        // act
        await page.keyboard.type('foo bar');

        // assert
        await expect(page.getByTestId('doc-find-count')).toHaveAttribute('data-total', '1');
        await expect(page.getByTestId('find-hit')).toHaveText(['foo ', 'bar']);
    });

    test('a bad pattern says so and an empty match counts nothing', async ({page}) => {
        // arrange
        const counter = page.getByTestId('doc-find-count');
        const input = page.getByTestId('doc-find-input');
        await openFind(page);
        await page.keyboard.press('Alt+KeyR');
        await expect(page.getByTestId('doc-find-regex')).toHaveAttribute('data-on', 'true');

        // act & assert
        await input.fill('(');
        await expect(counter).toHaveText('Bad pattern');
        for (const pattern of ['^', '$', 'z*']) {
            await input.fill(pattern);
            await expect(counter).toHaveText('No results');
        }
        await input.fill('^Second');
        await expect(counter).toHaveAttribute('data-total', '1');
    });

    test('a match in a closed details opens it', async ({page}) => {
        // arrange
        const details = page.locator('[data-testid=doc] details');
        await expect(details).not.toHaveAttribute('open', '');
        await openFind(page);

        // act
        await page.keyboard.type('kumquat');

        // assert
        await expect(details).toHaveAttribute('open', '');
        await expect(page.getByTestId('find-hit')).toBeVisible();
    });

    test('Esc closes the bar and takes the marks and the query away', async ({page}) => {
        // arrange
        await page.goto(`${routes.doc(FIND)}?q=foo`);
        await expect(page.getByTestId('doc-find-count')).toHaveAttribute('data-total', '3');
        await page.getByTestId('doc-find-input').focus();

        // act
        await page.keyboard.press('Escape');

        // assert
        await expect(page.getByTestId('doc-find')).toHaveCount(0);
        await expect(page.getByTestId('find-hit')).toHaveCount(0);
        await expect(page).not.toHaveURL(/\?q=/);
    });

    test('the note menu opens the bar too', async ({page}) => {
        // act
        await page.getByTestId('note-menu').click();
        await page.getByTestId('note-menu-find').click();

        // assert
        await expect(page.getByTestId('doc-find-input')).toBeFocused();
    });

    test.afterAll(() => {
        fs.rmSync(fixtureFile('e2e-find'), {recursive: true, force: true});
    });
});
