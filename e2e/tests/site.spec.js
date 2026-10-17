const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');

const {expect, test} = require('../support/test');

const {binary} = require('../support/env');

// a picture of one pixel, which is all the viewer needs to have something to show
const PIXEL = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
);

const NOTES = {
    'index.md': '# Home\n\n[Guide](docs/guide.md)\n',
    'pictures.md': '# Pictures\n\n![one](pics/one.png)\n\n![two](pics/two.png)\n\n```mermaid\ngraph TD;\n  A-->B;\n```\n',
    'pics/one.png': PIXEL,
    'pics/two.png': PIXEL,
    'docs/guide.md': '# Guide\n\n## One\n\ntext\n\n## Two\n\n```sh\necho hi\n```\n\n## Three\n\ntext\n',
};

// a site opened from disk, the way a reader previews one before it is
// published, and the way Firefox gives every page an origin of its own
let tmp;
let site;

const at = (name) => pathToFileURL(path.join(site, name)).href;

test.describe('site', () => {
    test.beforeAll(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scrawl-site-'));
        const notes = path.join(tmp, 'notes');
        for (const [name, content] of Object.entries(NOTES)) {
            fs.mkdirSync(path.dirname(path.join(notes, name)), {recursive: true});
            fs.writeFileSync(path.join(notes, name), content);
        }
        site = path.join(tmp, 'site');
        execFileSync(binary, ['site', '-o', site, notes]);
    });

    test.afterAll(() => {
        fs.rmSync(tmp, {recursive: true, force: true});
    });

    test('a theme picked on one page holds on the next', async ({page}) => {
        // arrange
        await page.goto(at('index.html'));
        await page.getByRole('button', {name: 'Dark', exact: true}).click();

        // act
        await page.getByRole('link', {name: 'Guide'}).click();

        // assert
        await expect(page.locator('html')).toHaveAttribute('data-scrawl-theme', 'dark');
        await expect(page.getByRole('button', {name: 'Dark', exact: true})).toHaveAttribute('aria-pressed', 'true');
    });

    test('auto picked on a page holds on the next', async ({page}) => {
        // arrange
        await page.goto(at('index.html'));
        await page.getByRole('button', {name: 'Dark', exact: true}).click();
        await page.getByRole('link', {name: 'Guide'}).click();
        await page.getByRole('button', {name: 'Auto', exact: true}).click();

        // act
        await page.locator('.page-home').click();

        // assert
        await expect(page.locator('html')).not.toHaveAttribute('data-scrawl-theme', /.*/);
        await expect(page.getByRole('button', {name: 'Auto', exact: true})).toHaveAttribute('aria-pressed', 'true');
    });

    test('back shows the theme picked last', async ({page}) => {
        // arrange
        await page.goto(at('index.html'));
        await page.getByRole('button', {name: 'Dark', exact: true}).click();
        await page.getByRole('link', {name: 'Guide'}).click();
        await page.getByRole('button', {name: 'Light', exact: true}).click();

        // act
        await page.goBack();

        // assert
        await expect(page.locator('html')).toHaveAttribute('data-scrawl-theme', 'light');
    });

    test('the tree marks the note on the page and opens the folder it is in', async ({page}) => {
        // act
        await page.goto(at('docs/guide.html'));

        // assert
        const tree = page.getByRole('navigation', {name: 'Notes'});
        await expect(tree.locator('[aria-current="page"]')).toHaveText('guide.md');
        await expect(tree.locator('details', {hasText: 'docs'})).toHaveAttribute('open', '');
    });

    test('the outline lists the sections of the note', async ({page}) => {
        // act
        await page.goto(at('docs/guide.html'));

        // assert
        await expect(page.getByRole('navigation', {name: 'On this page'}).getByRole('link'))
            .toHaveText(['One', 'Two', 'Three']);
    });

    test('a code block copies its code', async ({context, page}) => {
        // arrange
        // the config grants the clipboard to the app's origin, and a file has none
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await page.goto(at('docs/guide.html'));
        const copy = page.getByTestId('code-copy');

        // act
        await copy.click();

        // assert
        await expect(copy).toHaveText('Copied');
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('echo hi\n');
    });

    test('on a phone the tree is a drawer the menu opens and Escape closes', async ({page}) => {
        // arrange
        await page.setViewportSize({width: 390, height: 844});
        await page.goto(at('docs/guide.html'));
        const tree = page.getByRole('navigation', {name: 'Notes'});
        await expect(tree).toBeHidden();

        // act
        await page.getByRole('button', {name: 'Notes'}).click();

        // assert
        await expect(tree).toBeVisible();
        expect(await page.locator('.site-main').evaluate((main) => main.inert)).toBe(true);
        await page.keyboard.press('Escape');
        await expect(tree).toBeHidden();
        expect(await page.locator('.site-main').evaluate((main) => main.inert)).toBe(false);
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
        await expect(page.getByTestId('doc-lightbox-count')).toHaveText('2 / 2');
        await page.mouse.click(8, page.viewportSize().height - 8);
        await expect(page.getByTestId('doc-lightbox')).toHaveCount(0);
    });

    test('a diagram is drawn from the renderer beside the page', async ({page}) => {
        // act
        await page.goto(at('pictures.html'));

        // assert
        await expect(page.locator('.md-diagram[data-state="done"] svg')).toBeVisible({timeout: 20_000});
    });
});
