const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');

const {expect, test} = require('@playwright/test');

const {binary} = require('../support/env');

const NOTES = {
    'index.md': '# Home\n\n[Guide](docs/guide.md)\n',
    'docs/guide.md': '# Guide\n\n[Part](#part)\n\n## Part\n\ntext\n',
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

    test('a theme picked on one page follows the links to the next', async ({page}) => {
        // arrange
        await page.goto(at('index.html'));
        await page.getByRole('button', {name: 'Dark', exact: true}).click();

        // act
        await page.getByRole('link', {name: 'Guide'}).click();

        // assert
        await expect(page).toHaveURL(/\/docs\/guide\.html\?theme=dark$/);
        await expect(page.locator('html')).toHaveAttribute('data-scrawl-theme', 'dark');
        await expect(page.locator('.page-home')).toHaveAttribute('href', /\/site\/index\.html\?theme=dark$/);
    });

    test('the address carries the theme when the storage is empty', async ({browser}) => {
        // arrange
        const context = await browser.newContext();
        const page = await context.newPage();

        // act
        await page.goto(`${at('docs/guide.html')}?theme=dark`);

        // assert
        await expect(page.locator('html')).toHaveAttribute('data-scrawl-theme', 'dark');
        await expect(page.getByRole('button', {name: 'Dark', exact: true})).toHaveAttribute('aria-pressed', 'true');
        await context.close();
    });

    test('a link to a heading on the page stays an anchor', async ({page}) => {
        // arrange
        await page.goto(at('docs/guide.html'));

        // act
        await page.getByRole('button', {name: 'Dark', exact: true}).click();

        // assert
        await expect(page.getByRole('link', {name: 'Part', exact: true})).toHaveAttribute('href', '#part');
        await expect(page).toHaveURL(/\/docs\/guide\.html\?theme=dark$/);
    });
});
