const fs = require('node:fs');

const {expect, test} = require('../support/test');

const {removeFixture, routes, signIn, writeFixture} = require('../support/helpers');

const NOTE = 'e2e-export.md';
const OTHER = 'e2e-export-other.md';
const SOURCE = '# Export\n\nA picture:\n\n![logo](images/logo.png)\n';
const DIAGRAM = '# Export\n\n```mermaid\nflowchart TD\n  A --> B\n```\n';

async function download(page, format) {
    await page.getByTestId('doc-export').click();
    const [file] = await Promise.all([
        page.waitForEvent('download'),
        page.getByTestId(`doc-export-${format}`).click(),
    ]);
    return {name: file.suggestedFilename(), body: fs.readFileSync(await file.path(), 'utf8')};
}

// print is the browser's dialog, which a test cannot drive: the stub records
// the page as the dialog would have printed it, then closes it
async function stubPrint(page) {
    await page.evaluate(() => {
        window.printed = [];
        window.print = () => {
            const root = document.documentElement;
            window.printed.push({
                title: document.title,
                theme: root.getAttribute('data-scrawl-theme'),
                scheme: root.getAttribute('data-mantine-color-scheme'),
                diagram: document.querySelector('.md-diagram-view svg')?.id ?? null,
            });
            window.dispatchEvent(new Event('afterprint'));
        };
    });
}

test.describe('export', () => {
    test.beforeEach(async ({page}) => {
        await signIn(page);
    });

    test.afterEach(() => {
        removeFixture(NOTE);
    });

    test('markdown is the source of the note', async ({page}) => {
        // arrange
        writeFixture(NOTE, SOURCE);
        await page.goto(routes.doc(NOTE));

        // act
        const file = await download(page, 'md');

        // assert
        expect(file).toEqual({name: NOTE, body: SOURCE});
    });

    test('html is a page of its own with the pictures inside it', async ({page}) => {
        // arrange
        writeFixture(NOTE, SOURCE);
        await page.goto(routes.doc(NOTE));

        // act
        const file = await download(page, 'html');

        // assert
        expect(file.name).toBe('e2e-export.html');
        expect(file.body).toContain('<title>Export</title>');
        expect(file.body).toMatch(/<img src="data:image\/png;base64,[A-Za-z0-9+/=]+" alt="logo">/);
    });

    test('a print leaves the chrome off the paper', async ({page}) => {
        // arrange
        writeFixture(NOTE, SOURCE);
        await page.goto(routes.doc(NOTE));
        await expect(page.getByTestId('doc-export')).toBeVisible();

        // act
        await page.emulateMedia({media: 'print'});

        // assert
        await expect(page.getByTestId('doc').locator('h1')).toBeVisible();
        await expect(page.getByTestId('doc-export')).toBeHidden();
        await expect(page.getByTestId('topbar-burger')).toBeHidden();
    });

    test('a print leaves the browser no room for the address and the date', async ({page}) => {
        // arrange
        writeFixture(NOTE, SOURCE);
        await page.goto(routes.doc(NOTE));
        await expect(page.getByTestId('doc').locator('h1')).toBeVisible();

        // act
        await page.emulateMedia({media: 'print'});

        // assert
        const pageMargins = await page.evaluate(() => {
            const found = [];
            const visit = (rules) => {
                for (const rule of rules) {
                    if (rule instanceof CSSPageRule) {
                        found.push(rule.style.margin);
                    } else if (rule.cssRules !== undefined) {
                        visit(rule.cssRules);
                    }
                }
            };
            for (const sheet of document.styleSheets) {
                visit(sheet.cssRules);
            }
            return found;
        });
        expect(pageMargins).toEqual(['0px']);
        const margin = await page.evaluate(() => parseFloat(getComputedStyle(document.body).paddingTop));
        expect(margin, 'the page keeps a margin of its own').toBeGreaterThan(0);
    });
});

test.describe('export to pdf of wide content', () => {
    test.beforeEach(async ({page}) => {
        await signIn(page);
    });

    test.afterEach(() => {
        removeFixture(NOTE);
    });

    test('a wide table and a wide diagram fit the paper', async ({page}) => {
        // arrange
        const cells = Array.from({length: 8}, (_, index) => `column ${index} ${'holds a long sentence '.repeat(4)}`);
        const nodes = Array.from({length: 30}, (_, index) => `N${index}[node number ${index}]`).join(' --> ');
        writeFixture(NOTE, [
            '# Wide', '',
            `| ${cells.join(' | ')} |`, `|${' --- |'.repeat(cells.length)}`, `| ${cells.join(' | ')} |`, '',
            '```mermaid', `flowchart LR\n  ${nodes}`, '```', '',
        ].join('\n'));
        await page.goto(routes.doc(NOTE));
        const doc = page.getByTestId('doc');
        await expect(doc.locator('.md-diagram[data-state="done"]')).toBeVisible();

        // act
        await page.emulateMedia({media: 'print'});

        // assert
        const overflow = (selector) => doc.locator(selector).evaluate((element) => {
            const width = element.closest('.markdown-document').getBoundingClientRect().width;
            return Math.max(element.scrollWidth, element.getBoundingClientRect().width) - width;
        });
        // scrollWidth is a whole number of pixels and the column is not, so a
        // fit can read as a fraction of a pixel over
        expect(await overflow('table')).toBeLessThan(1);
        expect(await overflow('.md-diagram-view svg')).toBeLessThan(1);
    });
});

test.describe('export to pdf of a formula', () => {
    test.beforeEach(async ({page}) => {
        await signIn(page);
    });

    test.afterEach(() => {
        removeFixture(NOTE);
    });

    test('a print started before katex arrives waits for the formula', async ({page}) => {
        // arrange
        writeFixture(NOTE, '# Export\n\n$$\n\\frac{a}{b}\n$$\n');
        await page.route(/\/katex-[^/]*\.js$/, async (route) => {
            await new Promise((resolve) => setTimeout(resolve, 1_500));
            await route.continue();
        });
        await page.goto(routes.doc(NOTE));
        await expect(page.getByTestId('doc').locator('h1')).toBeVisible();
        await page.evaluate(() => {
            window.typeset = [];
            window.print = () => window.typeset.push(document.querySelectorAll('.markdown-document .katex').length);
        });

        // act
        await page.getByTestId('doc-export').click();
        await page.getByTestId('doc-export-pdf').click();

        // assert
        await expect.poll(() => page.evaluate(() => window.typeset)).toEqual([1]);
    });
});

test.describe('export to pdf on a dark screen', () => {
    test.use({colorScheme: 'dark'});

    test.beforeEach(async ({page}) => {
        await signIn(page);
    });

    test.afterEach(() => {
        removeFixture(NOTE);
        removeFixture(OTHER);
    });

    test('prints the note in the light theme under its own name, then puts the page back', async ({page}) => {
        // arrange
        writeFixture(NOTE, DIAGRAM);
        await page.goto(routes.doc(NOTE));
        await expect(page.getByTestId('doc').locator('.md-diagram[data-state="done"]')).toBeVisible();
        await stubPrint(page);
        const title = await page.title();
        const drawn = await page.getByTestId('doc').locator('.md-diagram-view svg').getAttribute('id');

        // act
        await page.getByTestId('doc-export').click();
        await page.getByTestId('doc-export-pdf').click();

        // assert
        await expect.poll(() => page.evaluate(() => window.printed.length)).toBe(1);
        const [printed] = await page.evaluate(() => window.printed);
        expect(printed).toMatchObject({title: 'e2e-export', theme: 'light', scheme: 'light'});
        expect(printed.diagram, 'the diagram is drawn again for the paper').not.toBe(drawn);
        await expect(page).toHaveTitle(title);
        await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'dark');
        await expect(page.locator('html')).not.toHaveAttribute('data-scrawl-theme', /.*/);
    });

    test('a note left while its print waits is not printed', async ({page}) => {
        // arrange
        writeFixture(NOTE, `# Export\n\n[next](${OTHER})\n\n![slow](images/slow.png)\n`);
        writeFixture(OTHER, '# Other\n');
        // a picture that never arrives keeps the print waiting for it
        await page.route('**/raw/images/slow.png', () => {});
        await page.goto(routes.doc(NOTE));
        await stubPrint(page);
        const title = await page.title();

        // act
        await page.getByTestId('doc-export').click();
        await page.getByTestId('doc-export-pdf').click();
        await page.getByTestId('doc').getByRole('link', {name: 'next'}).click();

        // assert
        await expect(page.getByTestId('doc').locator('h1')).toHaveText('Other');
        await expect(page).toHaveTitle(title);
        await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'dark');
        // past the longest wait of a print
        await page.waitForTimeout(6_000);
        expect(await page.evaluate(() => window.printed)).toEqual([]);
    });

    test('a print from the browser menu is light too', async ({page}) => {
        // arrange
        writeFixture(NOTE, SOURCE);
        await page.goto(routes.doc(NOTE));
        await expect(page.getByTestId('doc').locator('h1')).toBeVisible();

        // act
        const during = await page.evaluate(() => {
            window.dispatchEvent(new Event('beforeprint'));
            const scheme = document.documentElement.getAttribute('data-mantine-color-scheme');
            window.dispatchEvent(new Event('afterprint'));
            return scheme;
        });

        // assert
        expect(during).toBe('light');
        await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'dark');
    });
});
