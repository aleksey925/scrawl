const {expect, test} = require('../support/test');

const fs = require('fs');

const docs = require('../support/docs');
const {
    MAIN, fixtureFile, modifier, pressShortcut, removeFixture, routes, save, setSource, shot, signIn, writeFixture,
} = require('../support/helpers');
const text = require('../support/text');

const MANY = 'e2e-search/many.md';

// indexed waits for the watcher to bring a fixture written by a test into the
// index, which the search reads
async function indexed(page, word, path) {
    await expect.poll(async () => {
        const res = await page.request.get(`${MAIN.baseURL}${routes.api(`/search?q=${encodeURIComponent(word)}`)}`);
        return (await res.json()).hits.map((found) => found.path);
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
        // arrange
        await openSearch(page);

        // act
        await page.getByTestId('search-input').fill(docs.search.prefix);

        // assert
        await expect(page.getByTestId('search-result').first()).toBeVisible();
        await shot(page, 'search-dialog');
        expect(await page.getByTestId('search-result').count()).toBeGreaterThan(1);
        await expect(page.getByTestId('search-result').first()).toHaveAttribute('data-path', /\.md$/);
        await expect(page.getByTestId('search-line').first()).toHaveAttribute('data-line', /^\d+$/);
        await expect(page.getByTestId('search-line').first().locator('mark').first()).toBeVisible();
        await expect(page.getByTestId('search-stats')).toContainText(' ms');
    });

    test('the slash key opens nothing', async ({page}) => {
        // act
        await pressShortcut(page, '/');

        // assert
        await expect(page.getByTestId('search-dialog')).toHaveCount(0);
    });

    test('a line picked with the arrows opens the note at it with the find filled in', async ({page}) => {
        // arrange
        await openSearch(page);
        await page.getByTestId('search-input').fill(docs.search.palette.query);
        await expect(page.getByTestId('search-line').first()).toBeVisible();
        await page.keyboard.press('ArrowDown');
        await expect(page.locator('[data-testid=search-result][data-active="true"]'))
            .toHaveAttribute('data-path', docs.search.palette.path);
        await page.keyboard.press('ArrowDown');
        await expect(page.locator('[data-testid=search-line][data-active="true"]')).toHaveCount(1);

        // act
        await page.keyboard.press('Enter');

        // assert
        await expect(page).toHaveURL(new RegExp(`${routes.doc(docs.search.palette.path)}\\?.*line=\\d+`));
        await expect(page).toHaveURL(/[?&]q=/);
        const query = new URL(page.url()).searchParams.get('q');
        await expect(page.getByTestId('doc')).toBeVisible();
        await expect(page.getByTestId('doc-find-input')).toHaveValue(query);
        await expect(page.getByTestId('find-hit').first()).toBeVisible();
        await expect(page.locator('[data-testid=find-hit][data-active="true"]').first()).toBeInViewport();
    });

    test('Alt+R turns Regex on, which takes the mode away and says what is wrong with a pattern', async ({page}) => {
        // arrange
        await openSearch(page);
        await page.getByTestId('search-input').fill('(');

        // act
        await page.keyboard.press('Alt+KeyR');

        // assert
        await expect(page.getByTestId('search-regex')).toHaveAttribute('data-on', 'true');
        await expect(page.getByTestId('search-mode').locator('input').first()).toBeDisabled();
        await expect(page.getByTestId('search-error')).toContainText('missing closing )');
        await expect(page.getByTestId('search-hint')).toHaveText(text.search.regexHint);
    });

    test('Exact turns on Match case and Whole word, which narrow the lines', async ({page}) => {
        // arrange
        writeFixture(MANY, '# Many\n\nKumquat here\n\nkumquat there\n\nkumquats elsewhere\n');
        await indexed(page, 'kumquats', MANY);
        await openSearch(page);
        await page.getByTestId('search-input').fill('kumquat');
        const lines = page.locator(`[data-testid=search-result][data-path="${MANY}"] ~ [data-testid=search-line]`);
        await expect(page.getByTestId('search-case')).toBeDisabled();

        // act & assert
        await page.keyboard.press('Alt+KeyF');
        await expect(page.getByTestId('search-mode')).toHaveAttribute('data-mode', 'exact');
        await expect(lines).toHaveCount(3);
        await page.keyboard.press('Alt+KeyW');
        await expect(lines).toHaveCount(2);
        await page.keyboard.press('Alt+KeyC');
        await expect(lines).toHaveCount(1);
    });

    test('a space typed around an exact text is part of what is looked for', async ({page}) => {
        // arrange
        writeFixture(MANY, '# Many\n\nspearmint line\n\nsome pear here\n');
        await indexed(page, 'spearmint', MANY);
        await openSearch(page);
        await page.keyboard.press('Alt+KeyF');
        await expect(page.getByTestId('search-mode')).toHaveAttribute('data-mode', 'exact');
        const lines = page.locator(`[data-testid=search-result][data-path="${MANY}"] ~ [data-testid=search-line]`);
        await page.getByTestId('search-input').fill('pear');
        await expect(lines).toHaveCount(2);

        // act
        await page.getByTestId('search-input').fill(' pear');

        // assert
        await expect(lines).toHaveCount(1);
        await expect(lines).toContainText('some pear here');
        await page.goto(`${routes.search(' pear')}&mode=exact`);
        await expect(page.locator(`[data-testid=search-result][data-path="${MANY}"] ~ [data-testid=search-line]`))
            .toHaveCount(1);
    });

    test('a note shows three lines and the rest on a click', async ({page}) => {
        // arrange
        writeFixture(MANY, `# Many\n\n${Array.from({length: 6}, (_, i) => `zebrafinch ${i}`).join('\n\n')}\n`);
        await indexed(page, 'zebrafinch', MANY);
        await openSearch(page);
        const lines = page.locator(`[data-testid=search-result][data-path="${MANY}"] ~ [data-testid=search-line]`);

        // act
        await page.getByTestId('search-input').fill('zebrafinch');

        // assert
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

    test('a word written with combining marks is found in the note the search opens', async ({page}) => {
        // arrange
        const decomposed = 'e2e-search/decomposed.md';
        const word = 'smörgåskaka';
        writeFixture(decomposed, `# Decomposed\n\nA ${word.normalize('NFD')} for lunch.\n`);
        try {
            await indexed(page, word, decomposed);
            await page.goto(routes.search(word));

            // act
            await page.locator(`[data-testid=search-result][data-path="${decomposed}"]`).click();

            // assert
            await expect(page).toHaveURL(/\?q=/);
            await expect(page.getByTestId('doc-find-count')).toHaveAttribute('data-total', '1');
            await expect(page.getByTestId('find-hit')).toHaveText(word.normalize('NFD'));
        } finally {
            removeFixture(decomposed);
        }
    });

    test('a Korean word written as jamo is found in the note the search opens', async ({page}) => {
        // arrange
        const jamo = 'e2e-search/jamo.md';
        const word = '한국어';
        writeFixture(jamo, `# Jamo\n\nThe ${word.normalize('NFD')} lesson.\n`);
        try {
            await indexed(page, word, jamo);
            await page.goto(routes.search(word));

            // act
            await page.locator(`[data-testid=search-result][data-path="${jamo}"]`).click();

            // assert
            await expect(page).toHaveURL(/\?q=/);
            await expect(page.getByTestId('doc-find-count')).toHaveAttribute('data-total', '1');
            await expect(page.getByTestId('find-hit')).toHaveText(word.normalize('NFD'));
        } finally {
            removeFixture(jamo);
        }
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
            return page.getByTestId('search-result').evaluateAll((heads) => heads.map((el) => el.dataset.path));
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
        // arrange
        await page.goto(routes.home());
        await openSearch(page);

        // act
        await page.getByTestId('search-input').fill('zzzznotinthecorpuszzzz');

        // assert
        await expect(page.getByTestId('search-empty')).toHaveText(text.search.empty);
        await expect(page.getByTestId('search-result')).toHaveCount(0);
    });

    test('an empty field shows the notes opened last', async ({page}) => {
        // arrange
        await page.goto(routes.doc(docs.search.palette.path));
        await expect(page.getByTestId('doc')).toBeVisible();

        // act
        await openSearch(page);

        // assert
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

    test('a line with no match at or after it is scrolled to, and not the first match', async ({page}) => {
        // arrange
        const long = 'e2e-find/long.md';
        const filler = Array.from({length: 60}, (_, index) => `Filler paragraph ${index}.`);
        writeFixture(long, ['# Long', '', 'foo at the top', '', ...filler.flatMap((line) => [line, '']), 'The last block.', ''].join('\n'));
        const lastLine = 5 + 2 * filler.length;
        try {
            // act
            await page.goto(`${routes.doc(long)}?q=foo&line=${lastLine}`);

            // assert
            await expect(page.getByTestId('doc-find-count')).toHaveAttribute('data-total', '1');
            await expect(page.getByTestId('doc').getByText('The last block.')).toBeInViewport();
            await expect(page.getByTestId('find-hit')).not.toBeInViewport();
        } finally {
            removeFixture(long);
        }
    });

    test('a line inside a paragraph, a code block or a table opens at the match on that line', async ({page}) => {
        // arrange
        const lines = 'e2e-find/lines.md';
        writeFixture(lines, [
            '# Lines', '', 'foo one', 'foo two', '', '```', 'foo a', 'foo b', '```', '',
            '| a | b |', '|---|---|', '| foo | 1 |', '| foo | 2 |', '',
        ].join('\n'));
        const counter = page.getByTestId('doc-find-count');
        try {
            for (const [line, position] of [[4, '2'], [8, '4'], [14, '6']]) {
                // act
                await page.goto(`${routes.doc(lines)}?q=foo&line=${line}`);

                // assert
                await expect(counter).toHaveAttribute('data-total', '6');
                await expect(counter).toHaveAttribute('data-position', position);
            }
        } finally {
            removeFixture(lines);
        }
    });

    test('a line in indented code or a fence left open opens at the match on that line', async ({page}) => {
        // arrange
        const open = 'e2e-find/open.md';
        writeFixture(open, ['# Open', '', '    foo i', '    foo j', '', '```', 'foo a', 'foo b', ''].join('\n'));
        const counter = page.getByTestId('doc-find-count');
        try {
            for (const [line, position] of [[4, '2'], [7, '3'], [8, '4']]) {
                // act
                await page.goto(`${routes.doc(open)}?q=foo&line=${line}`);

                // assert
                await expect(counter).toHaveAttribute('data-total', '4');
                await expect(counter).toHaveAttribute('data-position', position);
            }
        } finally {
            removeFixture(open);
        }
    });

    test('two matches inside one composed letter are one mark', async ({page}) => {
        // arrange
        const marks = 'e2e-find/marks.md';
        const letter = 'a\u0300\u0315';
        writeFixture(marks, `# Marks\n\nOne ${letter} here.\n`);
        try {
            // act
            await page.goto(`${routes.doc(marks)}?q=${encodeURIComponent('[\u00e0\u0315]')}&regex=1`);

            // assert
            await expect(page.getByTestId('doc-find-count')).toHaveAttribute('data-total', '1');
            await expect(page.getByTestId('find-hit')).toHaveText(letter);
        } finally {
            removeFixture(marks);
        }
    });

    test('another note opened from a found one is not searched', async ({page}) => {
        // arrange
        const from = 'e2e-find/from.md';
        const next = 'e2e-find/next.md';
        writeFixture(from, '# From\n\nA foo here, then [the next note](next.md).\n');
        writeFixture(next, '# Next\n\nA foo there.\n');
        try {
            await page.goto(`${routes.doc(from)}?q=foo`);
            await expect(page.getByTestId('doc-find-count')).toHaveAttribute('data-total', '1');

            // act
            await page.getByTestId('doc').getByRole('link', {name: 'the next note'}).click();

            // assert
            await expect(page.getByTestId('doc').getByText('A foo there.')).toBeVisible();
            await expect(page.getByTestId('doc-find')).toHaveCount(0);
            await expect(page.getByTestId('find-hit')).toHaveCount(0);
        } finally {
            removeFixture(from);
            removeFixture(next);
        }
    });

    test('Back to the note without the query closes the bar', async ({page}) => {
        // arrange
        const back = 'e2e-find/back.md';
        writeFixture(back, '# Back\n\nA foo here, and [the same with a query](back.md?q=foo).\n');
        try {
            await page.goto(routes.doc(back));
            await page.getByTestId('doc').getByRole('link', {name: 'the same with a query'}).click();
            await expect(page.getByTestId('doc-find-count')).toHaveAttribute('data-total', '1');

            // act
            await page.goBack();

            // assert
            await expect(page).not.toHaveURL(/\?q=/);
            await expect(page.getByTestId('doc-find')).toHaveCount(0);
            await expect(page.getByTestId('find-hit')).toHaveCount(0);
        } finally {
            removeFixture(back);
        }
    });

    test('a pattern written for the search of the space marks its matches in the note', async ({page}) => {
        // arrange
        const pattern = encodeURIComponent('(?i)\\APLAIN FOO BAR HERE\\Q.\\E');

        // act
        await page.goto(`${routes.doc(FIND)}?q=${pattern}&regex=1&case=1`);

        // assert
        await expect(page.getByTestId('doc-find-count')).toHaveAttribute('data-total', '1');
    });

    test('a pattern that runs too long is stopped, and the next one runs', async ({page}) => {
        // arrange
        const slow = 'e2e-find/slow.md';
        writeFixture(slow, `# Slow\n\n${'a'.repeat(40)}!\n`);
        try {
            const counter = page.getByTestId('doc-find-count');
            const input = page.getByTestId('doc-find-input');
            await page.goto(routes.doc(slow));
            await expect(page.getByTestId('doc')).toBeVisible();
            await openFind(page);
            await page.keyboard.press('Alt+KeyR');

            // act
            await input.fill('(a+)+$');

            // assert
            await expect(counter).toHaveAttribute('data-status', 'slow');
            await expect(counter).toHaveText('Pattern too slow');
            await input.fill('a!');
            await expect(counter).toHaveAttribute('data-total', '1');
        } finally {
            removeFixture(slow);
        }
    });

    test('the note menu opens the bar too', async ({page}) => {
        // act
        await page.getByTestId('note-menu').click();
        await page.getByTestId('note-menu-find').click();

        // assert
        await expect(page.getByTestId('doc-find-input')).toBeFocused();
    });

    test('the bar owns its keys: Cmd+B leaves the sidebar and Cmd+F the field alone', async ({page}) => {
        // arrange
        const mod = await modifier(page);
        const sidebar = page.getByTestId('sidebar');
        const input = page.getByTestId('doc-find-input');
        await expect(sidebar).toBeVisible();
        await openFind(page);
        await page.keyboard.type('foo');

        // act
        await page.keyboard.press(`${mod}+b`);
        await page.keyboard.press(`${mod}+f`);
        await page.keyboard.type('x');

        // assert
        await expect(sidebar).toBeVisible();
        await expect(input).toHaveValue('foox');
    });

    test.afterAll(() => {
        fs.rmSync(fixtureFile('e2e-find'), {recursive: true, force: true});
    });
});
