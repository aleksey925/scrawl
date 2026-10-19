const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');

const {expect, test} = require('@playwright/test');

const {binary} = require('../support/env');

// a picture of one pixel, which is all the viewer needs to have something to show
const PIXEL = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
);

const filler = (word) => Array.from({length: 30}, () => `${word} `.repeat(14)).join('\n\n');

const NOTES = {
    'index.md': '# Home\n\n[Guide](docs/guide.md), the [docs folder](docs/), [pictures](pictures.md) and [the third part of the guide](docs/guide.md#three)\n',
    'docs/guide.md': [
        '# Guide', '[Back home](../index.md), [the third part](#Three), [the third part again](guide.md#three) and [the word three](guide.md?q=three#three).',
        '## One', filler('one'),
        '## Two', '```sh\necho hi\n```', filler('two'),
        '## Three', filler('three'),
        '## Four', 'A short section.',
        '## Five', 'A short section.',
    ].join('\n\n'),
    'docs/deep/inner.md': '# Inner\n\ntext\n',
    'docs/long.md': ['# Long', filler('long'), '## End', filler('end')].join('\n\n'),
    'docs/README.md': '# Docs\n\nWhat the folder holds.\n',
    'pictures.md': '# Pictures\n\n![one](pics/one.png)\n\n![two](pics/two.png)\n\n```mermaid\ngraph TD;\n  A-->B;\n```\n',
    'pics/one.png': PIXEL,
    'pics/two.png': PIXEL,
    'math.md': '# Math\n\nA formula: $x^2 + 1$.\n',
    // names a url has to escape, and one that looks escaped already
    'odd/100%.md': '# Percent\n',
    'odd/a%20b.md': '# Escaped\n',
    'odd/what? #1.md': '# Question\n',
};

// the address a site is published under: anything but the root of the host
const PREFIX = '/pub/notes/';

const TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml'};

// serve answers a site the way a static host does: a file, a folder's
// index.html, and 404.html for anything else
function serve(root) {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            const url = new URL(req.url, 'http://host');
            if (!url.pathname.startsWith(PREFIX)) {
                res.writeHead(404).end();
                return;
            }
            let file = path.join(root, decodeURIComponent(url.pathname.slice(PREFIX.length)));
            if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
                file = path.join(file, 'index.html');
            }
            const found = fs.existsSync(file);
            const body = fs.readFileSync(found ? file : path.join(root, '404.html'));
            res.writeHead(found ? 200 : 404, {'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream'});
            res.end(body);
        });
        server.listen(0, '127.0.0.1', () => resolve(server));
    });
}

let tmp;
let site;
let server;

test.beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scrawl-site-'));
    const notes = path.join(tmp, 'notes');
    for (const [name, content] of Object.entries(NOTES)) {
        fs.mkdirSync(path.dirname(path.join(notes, name)), {recursive: true});
        fs.writeFileSync(path.join(notes, name), content);
    }
    site = path.join(tmp, 'site');
    execFileSync(binary, ['site', '-o', site, notes]);
    server = await serve(site);
});

test.afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmp, {recursive: true, force: true});
});

// a site is read from disk, the way it is checked before it is published, and
// from a host under a path of its own, the way it is read once it is
const TARGETS = {
    disk: (name) => pathToFileURL(path.join(site, name)).href,
    host: (name) => `http://127.0.0.1:${server.address().port}${PREFIX}${name}`,
};

const active = (page) => page.locator('[data-testid=toc-entry][data-active="true"]');
const row = (page, contentPath) => page.locator(`[data-testid=tree-row][data-path="${contentPath}"]`);

async function chooseTheme(page, name) {
    await page.getByTestId('topbar-more').click();
    const picker = page.getByTestId('topbar-theme');
    await picker.getByText(name, {exact: true}).click();
    await page.keyboard.press('Escape');
}

for (const [target, at] of Object.entries(TARGETS)) {
    test.describe(`site from the ${target}`, () => {
        test('the tree marks the note on the page and opens the folder it is in', async ({page}) => {
            // act
            await page.goto(at('docs/deep/inner.html'));

            // assert
            await expect(page.locator('[data-testid=tree-row][data-current="true"]')).toHaveAttribute('data-path', 'docs/deep/inner.md');
            await expect(row(page, 'docs').getByTestId('tree-twisty')).toHaveAttribute('data-open', 'true');
            await expect(row(page, 'docs/deep').getByTestId('tree-twisty')).toHaveAttribute('data-open', 'true');
            await expect(row(page, '').getByTestId('tree-link')).toHaveText('Home');
        });

        test('a link of the tree opens its note and the folder opened stays open', async ({page, browserName}) => {
            // arrange
            await page.goto(at('index.html'));
            await row(page, 'docs').getByTestId('tree-twisty').click();

            // act
            await row(page, 'docs/guide.md').getByTestId('tree-link').click();

            // assert
            await expect(page).toHaveURL(at('docs/guide.html'));
            await expect(page.getByTestId('doc').locator('h1')).toHaveText('Guide');
            // Firefox keeps a storage per page opened from disk, so there only
            // the way to the note is open on the next page
            if (!(browserName === 'firefox' && target === 'disk')) {
                await expect(row(page, 'docs').getByTestId('tree-twisty')).toHaveAttribute('data-open', 'true');
            }
        });

        test('the outline marks the section being read and reaches the last ones', async ({page}) => {
            // arrange
            await page.goto(at('docs/guide.html'));
            await expect(page.getByTestId('toc')).toBeVisible();

            // act
            await page.locator('[data-testid=doc] h2#two').evaluate((el) => {
                window.scrollTo({top: el.getBoundingClientRect().top + window.scrollY - 100, behavior: 'instant'});
            });

            // assert
            await expect(active(page)).toHaveText('Two');
            await page.evaluate(() => window.scrollTo({top: document.documentElement.scrollHeight, behavior: 'instant'}));
            await expect(active(page)).toHaveText('Five');
        });

        test('an outline entry moves the page and the address, and stays on the page', async ({page}) => {
            // arrange
            await page.goto(at('docs/guide.html'));
            await page.evaluate(() => {
                window.marker = 'same page';
            });

            // act
            await page.locator('[data-testid=toc-entry]', {hasText: 'Four'}).click();

            // assert
            await expect(page).toHaveURL(`${at('docs/guide.html')}#four`);
            await expect(active(page)).toHaveText('Four');
            expect(await page.evaluate(() => window.marker)).toBe('same page');
        });

        test('a link to a section written in another case still lands on it', async ({page}) => {
            // arrange
            await page.goto(at('docs/guide.html'));
            await page.evaluate(() => {
                window.marker = 'same page';
            });

            // act
            await page.getByRole('link', {name: 'the third part', exact: true}).click();

            // assert
            await expect(page).toHaveURL(/#Three$/);
            await expect.poll(() => page.locator('h2#three').evaluate((el) => Math.round(el.getBoundingClientRect().top)))
                .toBeLessThan(120);
            expect(await page.evaluate(() => window.marker)).toBe('same page');
        });

        test('a link to a heading of this very note by its file lands on the heading', async ({page}) => {
            // arrange
            await page.goto(at('docs/guide.html'));
            await page.evaluate(() => {
                window.marker = 'same page';
            });

            // act
            await page.getByRole('link', {name: 'the third part again'}).click();

            // assert
            await expect(page).toHaveURL(/#three$/);
            await expect.poll(() => page.locator('h2#three').evaluate((el) => Math.round(el.getBoundingClientRect().top)))
                .toBeLessThan(120);
            expect(await page.evaluate(() => window.marker)).toBe('same page');
        });

        test('a link to this very note with a query brings the query along', async ({page}) => {
            // arrange
            await page.goto(at('docs/guide.html'));

            // act
            await page.getByRole('link', {name: 'the word three'}).click();

            // assert
            await expect(page).toHaveURL(/\?q=three#three$/);
            await expect(page.locator('[data-testid=doc] mark.md-find').first()).toBeVisible();
        });

        test('a link of a note opens the note it names', async ({page}) => {
            // arrange
            await page.goto(at('docs/guide.html'));

            // act
            await page.getByRole('link', {name: 'Back home'}).click();

            // assert
            await expect(page).toHaveURL(at('index.html'));
            await expect(page.getByTestId('doc').locator('h1')).toHaveText('Home');
        });

        test('a folder without an index is its listing, with its readme below', async ({page}) => {
            // act
            await page.goto(at('index.html'));
            await page.getByRole('link', {name: 'docs folder'}).click();

            // assert
            await expect(page).toHaveURL(at('docs/index.html'));
            await expect(page.locator('[data-testid=crumb][data-current="true"]')).toHaveText('docs');
            await expect(page.getByTestId('doc')).toContainText('What the folder holds.');
            await expect(page.getByTestId('dir-row')).toHaveCount(4);
            const list = await page.getByTestId('dir-table').boundingBox();
            const readme = await page.getByTestId('doc').boundingBox();
            expect(readme.y).toBeGreaterThan(list.y + list.height);
            await page.locator('[data-testid=dir-row][data-path="docs/guide.md"] [data-testid=dir-row-name]').click();
            await expect(page).toHaveURL(at('docs/guide.html'));
        });

        test('a note whose name a url has to escape opens from its folder', async ({page}) => {
            for (const [name, title] of [['100%.md', 'Percent'], ['a%20b.md', 'Escaped'], ['what? #1.md', 'Question']]) {
                // arrange
                await page.goto(at('odd/index.html'));

                // act
                await page.locator(`[data-testid=dir-row][data-path="odd/${name}"] [data-testid=dir-row-name]`).click();

                // assert
                await expect(page.getByTestId('doc').locator('h1')).toHaveText(title);
                await expect(page.locator(`[data-testid=tree-row][data-current="true"]`)).toHaveAttribute('data-path', `odd/${name}`);
            }
        });

        test('the path leads back to the folders above', async ({page}) => {
            // arrange
            await page.goto(at('docs/deep/inner.html'));
            const crumbs = page.getByTestId('page-breadcrumbs').getByTestId('crumb');
            await expect(crumbs).toHaveText(['Home', 'docs', 'deep', 'inner.md']);

            // act
            await crumbs.filter({hasText: 'docs'}).click();

            // assert
            await expect(page).toHaveURL(at('docs/index.html'));
        });

        test('a theme picked on one page holds on the next and after Back', async ({page}) => {
            // arrange
            await page.goto(at('index.html'));
            await chooseTheme(page, 'Dark');

            // act
            await page.getByRole('link', {name: 'Guide', exact: true}).click();

            // assert
            await expect(page).toHaveURL(at('docs/guide.html'));
            await expect(page.locator('html')).toHaveAttribute('data-scrawl-theme', 'dark');
            await chooseTheme(page, 'Light');
            await page.goBack();
            await expect(page.locator('html')).toHaveAttribute('data-scrawl-theme', 'light');
            await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'light');
        });

        test('auto picked on a page holds on the next', async ({page}) => {
            // arrange
            await page.goto(at('index.html'));
            await chooseTheme(page, 'Dark');
            await chooseTheme(page, 'Auto');

            // act
            await page.getByRole('link', {name: 'Guide', exact: true}).click();

            // assert
            await expect(page).toHaveURL(at('docs/guide.html'));
            await expect(page.locator('html')).not.toHaveAttribute('data-scrawl-theme', /.*/);
        });

        test('a code block copies its code', async ({context, page, browserName}) => {
            // the clipboard cannot be read back in Firefox under playwright
            test.skip(browserName === 'firefox', 'the clipboard is not readable in Firefox');

            // arrange
            await context.grantPermissions(['clipboard-read', 'clipboard-write']);
            await page.goto(at('docs/guide.html'));
            const copy = page.getByTestId('code-copy');

            // act
            await copy.click();

            // assert
            await expect(copy).toHaveAttribute('data-done', 'true');
            expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('echo hi\n');
        });

        test('the viewer steps through the pictures and closes on a click beside them', async ({page}) => {
            // arrange
            await page.goto(at('pictures.html'));
            await page.getByRole('button', {name: 'Open image: one'}).click();
            await expect(page.getByTestId('doc-lightbox-count')).toHaveText('1 / 2');

            // act
            await page.keyboard.press('ArrowRight');

            // assert
            await expect(page.getByTestId('doc-lightbox-caption')).toHaveText('two');
            await page.mouse.click(8, page.viewportSize().height - 8);
            await expect(page.getByTestId('doc-lightbox')).toHaveCount(0);
        });

        test('a diagram is drawn by the renderer beside the pages', async ({page}) => {
            // act
            await page.goto(at('pictures.html'));

            // assert
            await expect(page.locator('.md-diagram[data-state="done"] svg')).toBeVisible({timeout: 20_000});
        });

        test('a formula is typeset by the renderer beside the pages', async ({page}) => {
            // act
            await page.goto(at('math.html'));

            // assert
            await expect(page.locator('.math.is-typeset .katex')).toBeVisible({timeout: 20_000});
        });

        test('a site offers no search and asks nothing of a server', async ({page}) => {
            // arrange
            const asked = [];
            page.on('request', (req) => asked.push(req.url()));

            // act
            await page.goto(at('docs/guide.html'));
            await expect(page.getByTestId('doc').locator('h1')).toHaveText('Guide');
            await page.keyboard.press('Control+K');

            // assert
            await expect(page.getByTestId('topbar-search')).toHaveCount(0);
            await expect(page.getByTestId('palette-input')).toHaveCount(0);
            await expect(page.getByTestId('topbar-account')).toHaveCount(0);
            await expect(page.getByTestId('doc-edit')).toHaveCount(0);
            await expect(page.getByTestId('doc-history')).toHaveCount(0);
            expect(asked.filter((url) => !url.startsWith(at('')) && !url.startsWith('data:'))).toEqual([]);
        });

        test('a reader without javascript gets the note, its path and what a folder holds', async ({browser}) => {
            // arrange
            const context = await browser.newContext({javaScriptEnabled: false});
            const page = await context.newPage();

            // act
            await page.goto(at('docs/index.html'));

            // assert
            await expect(page.locator('article.markdown-document')).toContainText('What the folder holds.');
            await expect(page.locator('.scrawl-static-crumbs li')).toHaveText(['Home', 'docs']);
            await page.getByRole('link', {name: 'guide.md'}).click();
            await expect(page).toHaveURL(at('docs/guide.html'));
            await expect(page.locator('article.markdown-document h1')).toHaveText('Guide');
            await context.close();
        });
    });

    test.describe(`site from the ${target} on a phone`, () => {
        test.use({viewport: {width: 390, height: 844}, hasTouch: true});

        test('the outline is a sheet the top bar opens, and an entry closes it', async ({page}) => {
            // arrange
            await page.goto(at('docs/guide.html'));

            // act
            await page.getByTestId('topbar-toc').click();

            // assert
            await expect(page.getByTestId('toc-entry')).toHaveText(['One', 'Two', 'Three', 'Four', 'Five']);
            await page.getByTestId('toc-entry').filter({hasText: 'Three'}).click();
            await expect(page.getByTestId('toc-entry')).toHaveCount(0);
            await expect(page).toHaveURL(/#three$/);
            await page.getByTestId('topbar-toc').click();
            await expect(active(page)).toHaveText('Three');
        });

        test('the tree is a drawer, and a note picked in it opens', async ({page}) => {
            // arrange
            await page.goto(at('index.html'));

            // act
            await page.getByTestId('topbar-burger').click();

            // assert
            const drawer = page.getByTestId('sidebar-drawer');
            await expect(drawer.getByTestId('tree-row').first()).toBeVisible();
            await drawer.locator('[data-testid=tree-row][data-path="pictures.md"] [data-testid=tree-link]').click();
            await expect(page).toHaveURL(at('pictures.html'));
            await expect(page.getByTestId('doc').locator('h1')).toHaveText('Pictures');
            await expect(page.getByTestId('sidebar-drawer').getByTestId('tree-row')).toHaveCount(0);
        });

        test('the bar is one row of icons and the path sits on the page', async ({page}) => {
            // act
            await page.goto(at('docs/deep/inner.html'));

            // assert
            await expect(page.getByTestId('page-breadcrumbs').getByTestId('crumb')).toHaveText(['Home', 'docs', 'deep', 'inner.md']);
            const box = await page.getByTestId('topbar').boundingBox();
            expect(box.height).toBeLessThanOrEqual(56);
        });
    });
}

// a page from a host reads the next page and shows it with no page load, the
// way the app moves between notes; a value left on the window says whether
// the page was loaded again
test.describe('site from a host moves between notes without a page load', () => {
    const at = (name) => TARGETS.host(name);
    const mark = (page) => page.evaluate(() => {
        window.marker = 'still here';
    });
    const marked = (page) => page.evaluate(() => window.marker);
    const scrollY = (page) => page.evaluate(() => Math.round(window.scrollY));

    test('a link of the tree shows its note, and the address and the title follow', async ({page}) => {
        // arrange
        await page.goto(at('index.html'));
        await mark(page);

        // act
        await row(page, 'docs').getByTestId('tree-twisty').click();
        await row(page, 'docs/guide.md').getByTestId('tree-link').click();

        // assert
        await expect(page.getByTestId('doc').locator('h1')).toHaveText('Guide');
        await expect(page).toHaveURL(at('docs/guide.html'));
        await expect(page).toHaveTitle('Guide');
        expect(await marked(page)).toBe('still here');
        await expect(page.locator('[data-testid=tree-row][data-current="true"]')).toHaveAttribute('data-path', 'docs/guide.md');
    });

    test('a link of a note moves the same way, and the links of the next one work', async ({page}) => {
        // arrange
        await page.goto(at('docs/guide.html'));
        await mark(page);

        // act
        await page.getByRole('link', {name: 'Back home'}).click();
        await expect(page.getByTestId('doc').locator('h1')).toHaveText('Home');
        await page.getByRole('link', {name: 'pictures', exact: true}).click();

        // assert
        await expect(page.getByTestId('doc').locator('h1')).toHaveText('Pictures');
        await expect(page).toHaveURL(at('pictures.html'));
        await expect(page.getByTestId('doc').locator('img').first()).toHaveJSProperty('naturalWidth', 1);
        expect(await marked(page)).toBe('still here');
    });

    test('a link to a section of another note lands on the section', async ({page}) => {
        // arrange
        await page.goto(at('index.html'));
        await mark(page);

        // act
        await page.getByRole('link', {name: 'the third part of the guide'}).click();

        // assert
        await expect(page).toHaveURL(`${at('docs/guide.html')}#three`);
        await expect.poll(() => page.locator('h2#three').evaluate((el) => Math.round(el.getBoundingClientRect().top)))
            .toBeLessThan(120);
        expect(await marked(page)).toBe('still here');
    });

    test('a new note starts at its top, and Back and Forward put each where it was', async ({page}) => {
        // arrange
        await page.goto(at('docs/guide.html'));
        await mark(page);
        await page.evaluate(() => window.scrollTo({top: 1200, behavior: 'instant'}));
        await expect.poll(() => scrollY(page)).toBe(1200);

        // act
        await row(page, 'pictures.md').getByTestId('tree-link').click();
        await expect(page.getByTestId('doc').locator('h1')).toHaveText('Pictures');

        // assert
        expect(await scrollY(page)).toBe(0);
        await page.goBack();
        await expect(page.getByTestId('doc').locator('h1')).toHaveText('Guide');
        await expect(page).toHaveTitle('Guide');
        await expect.poll(() => scrollY(page)).toBe(1200);
        await page.goForward();
        await expect(page.getByTestId('doc').locator('h1')).toHaveText('Pictures');
        await expect.poll(() => scrollY(page)).toBe(0);
        expect(await marked(page)).toBe('still here');
    });

    test('a note left at its top comes back at its top', async ({page}) => {
        // arrange
        await page.goto(at('docs/guide.html'));
        await row(page, 'docs/long.md').getByTestId('tree-link').click();
        await expect(page.getByTestId('doc').locator('h1')).toHaveText('Long');
        await page.evaluate(() => window.scrollTo({top: 1200, behavior: 'instant'}));
        await expect.poll(() => scrollY(page)).toBe(1200);

        // act
        await page.goBack();

        // assert
        await expect(page.getByTestId('doc').locator('h1')).toHaveText('Guide');
        await page.waitForTimeout(500);
        expect(await scrollY(page)).toBe(0);
    });

    test('a position survives a reload of the page moved to', async ({page}) => {
        // arrange
        await page.goto(at('docs/guide.html'));
        await page.evaluate(() => window.scrollTo({top: 1200, behavior: 'instant'}));
        await expect.poll(() => scrollY(page)).toBe(1200);
        await row(page, 'pictures.md').getByTestId('tree-link').click();
        await expect(page.getByTestId('doc').locator('h1')).toHaveText('Pictures');
        await page.reload();
        await expect(page.getByTestId('doc').locator('h1')).toHaveText('Pictures');

        // act
        await page.goBack();

        // assert
        await expect(page.getByTestId('doc').locator('h1')).toHaveText('Guide');
        await expect.poll(() => scrollY(page)).toBe(1200);
    });

    test('a position left by a quick Back survives a reload', async ({page}) => {
        // arrange
        await page.goto(at('docs/guide.html'));
        await row(page, 'docs/long.md').getByTestId('tree-link').click();
        await expect(page.getByTestId('doc').locator('h1')).toHaveText('Long');
        await page.evaluate(() => window.scrollTo({top: 1800, behavior: 'instant'}));
        const left = await scrollY(page);
        await page.goBack();
        await expect(page.getByTestId('doc').locator('h1')).toHaveText('Guide');
        await page.reload();
        await expect(page.getByTestId('doc').locator('h1')).toHaveText('Guide');

        // act
        await page.goForward();

        // assert
        await expect(page.getByTestId('doc').locator('h1')).toHaveText('Long');
        await expect.poll(() => scrollY(page)).toBe(left);
    });

    test('Back puts a note opened at a heading where the reader left it, not at the heading', async ({page}) => {
        // arrange
        await page.goto(at('docs/guide.html#two'));
        await expect.poll(() => page.locator('h2#two').evaluate((el) => Math.round(el.getBoundingClientRect().top)))
            .toBeLessThan(120);
        await page.mouse.wheel(0, 600);
        await expect.poll(() => page.locator('h2#two').evaluate((el) => Math.round(el.getBoundingClientRect().top)))
            .toBeLessThan(-400);
        const left = await scrollY(page);
        await row(page, 'pictures.md').getByTestId('tree-link').click();
        await expect(page.getByTestId('doc').locator('h1')).toHaveText('Pictures');

        // act
        await page.goBack();

        // assert
        await expect(page.getByTestId('doc').locator('h1')).toHaveText('Guide');
        await page.waitForTimeout(1000);
        expect(await scrollY(page)).toBe(left);
    });

    test('a page still on its way is not shown over the move made after it', async ({page}) => {
        // arrange
        let release;
        const held = new Promise((resolve) => {
            release = resolve;
        });
        await page.goto(at('index.html'));
        await page.getByRole('link', {name: 'Guide', exact: true}).click();
        await expect(page.getByTestId('doc').locator('h1')).toHaveText('Guide');
        await page.reload();
        await expect(page.getByTestId('doc').locator('h1')).toHaveText('Guide');
        await page.route('**/index.html', async (route) => {
            if (route.request().resourceType() === 'fetch') {
                await held;
            }
            await route.continue();
        });

        // act
        await page.goBack({waitUntil: 'commit'});
        await page.goForward({waitUntil: 'commit'});
        release();

        // assert
        await page.waitForTimeout(1000);
        await expect(page.getByTestId('doc').locator('h1')).toHaveText('Guide');
        await expect(page).toHaveTitle('Guide');
        await expect(page).toHaveURL(at('docs/guide.html'));
    });

    test('what the reader typed into the filter stays when a note is picked from it', async ({page}) => {
        // arrange
        await page.goto(at('index.html'));
        await page.getByTestId('sidebar-filter').fill('pic');

        // act
        await row(page, 'pictures.md').getByTestId('tree-link').click();

        // assert
        await expect(page.getByTestId('doc').locator('h1')).toHaveText('Pictures');
        await expect(page.getByTestId('sidebar-filter')).toHaveValue('pic');
    });

    test('a page that cannot be read is loaded instead', async ({page}) => {
        // arrange
        await page.route('**/pictures.html', (route) => (route.request().resourceType() === 'fetch' ? route.abort() : route.continue()));
        await page.goto(at('index.html'));
        await mark(page);

        // act
        await page.getByRole('link', {name: 'pictures', exact: true}).click();

        // assert
        await expect(page.getByTestId('doc').locator('h1')).toHaveText('Pictures');
        await expect(page).toHaveURL(at('pictures.html'));
        expect(await marked(page)).toBeUndefined();
    });

    test('a reload after a move shows the note moved to', async ({page}) => {
        // arrange
        await page.goto(at('index.html'));
        await page.getByRole('link', {name: 'Guide', exact: true}).click();
        await expect(page.getByTestId('doc').locator('h1')).toHaveText('Guide');

        // act
        await page.reload();

        // assert
        await expect(page.getByTestId('doc').locator('h1')).toHaveText('Guide');
        await page.goBack();
        await expect(page.getByTestId('doc').locator('h1')).toHaveText('Home');
    });
});

test('from disk a move to another note is a page load', async ({page}) => {
    // arrange
    await page.goto(TARGETS.disk('index.html'));
    await page.evaluate(() => {
        window.marker = 'still here';
    });

    // act
    await page.getByRole('link', {name: 'Guide', exact: true}).click();

    // assert
    await expect(page.getByTestId('doc').locator('h1')).toHaveText('Guide');
    expect(await page.evaluate(() => window.marker)).toBeUndefined();
});

// Back after a page load brings the page out of the browser's cache as it was
// left: a link of a site from disk loads the next page, and from a host so does
// an address typed or a link to the site from elsewhere.
// Playwright turns that cache off in Chromium, and its headless shell has none,
// so this test runs the whole browser with the cache back on.
test('a page Back brings out of the cache takes the theme picked since and closes its drawer', async ({playwright, browserName}) => {
    // arrange
    const browser = await playwright[browserName].launch(browserName === 'chromium'
        ? {channel: 'chromium', ignoreDefaultArgs: ['--disable-back-forward-cache']}
        : {});
    const context = await browser.newContext({viewport: {width: 390, height: 844}, hasTouch: true});
    const page = await context.newPage();
    await page.goto(TARGETS.host('index.html'));
    await page.evaluate(() => window.addEventListener('pageshow', (event) => {
        window.restored = event.persisted;
    }));
    await page.getByTestId('topbar-burger').click();
    await expect(page.getByTestId('sidebar-drawer').getByTestId('tree-row').first()).toBeVisible();
    await page.goto(TARGETS.host('pictures.html'));
    await chooseTheme(page, 'Dark');

    // act
    // a page out of the cache fires no load event
    await page.goBack({waitUntil: 'commit'});

    // assert
    if (browserName === 'chromium') {
        await expect.poll(() => page.evaluate(() => window.restored)).toBe(true);
    }
    await expect(page.locator('html')).toHaveAttribute('data-scrawl-theme', 'dark');
    await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'dark');
    await expect(page.getByTestId('sidebar-drawer').getByTestId('tree-row')).toHaveCount(0);
    expect(await page.evaluate(() => document.querySelectorAll('[inert]').length)).toBe(0);
    await browser.close();
});

test('a missing address of a host gets the page that says so', async ({page}) => {
    // act
    const res = await page.goto(TARGETS.host('docs/gone.html'));

    // assert
    expect(res.status()).toBe(404);
    await expect(page.getByRole('heading', {name: 'Nothing here'})).toBeVisible();
});
