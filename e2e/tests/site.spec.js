const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');

const {expect, test} = require('@playwright/test');

const {binary} = require('../support/env');

const NOTES = {
    'index.md': '# Home\n\n[Guide](docs/guide.md)\n',
    'docs/guide.md': '# Guide\n\ntext\n',
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
});
