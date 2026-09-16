const {expect, test} = require('@playwright/test');

const fs = require('fs');
const path = require('path');
const {execFile} = require('child_process');

const docs = require('../support/docs');
const {binary} = require('../support/env');
const {pushToOrigin, tracked} = require('../support/git');
const {MULTI, save, setSource, shot, signIn} = require('../support/helpers');

const NOTES = MULTI.projects[MULTI.project];
const TEAM = MULTI.projects.team;
const WIKI = MULTI.projects.wiki;

const teamRoot = MULTI.extra.find((extra) => extra.name === 'team').dir;
const wikiRoot = MULTI.extra.find((extra) => extra.name === 'wiki').dir;
const wikiOrigin = MULTI.extra.find((extra) => extra.name === 'wiki').origin;

test.describe('projects', () => {
    test.beforeEach(async ({page}) => {
        await signIn(page, {baseURL: MULTI.baseURL, from: NOTES.home()});
    });

    test('the server root sends the browser to the first project', async ({page}) => {
        await page.goto(MULTI.baseURL);

        await expect(page).toHaveURL(NOTES.home());
        await expect(page.getByTestId('doc').locator('h1').first()).toContainText(docs.home.title);
    });

    test('each project serves only its own notes', async ({page}) => {
        await page.goto(TEAM.doc('team.md'));
        await expect(page.getByTestId('doc').locator('h1').first()).toContainText('Team wiki');

        await page.goto(WIKI.doc('remote.md'));
        await expect(page.getByTestId('doc').locator('h1').first()).toContainText('Remote page');

        // a document of one project is not reachable through another: the
        // content path is relative to its own root, and the project is in the
        // url and never in the path
        await page.goto(NOTES.doc('team.md'));
        await expect(page.getByTestId('doc-missing')).toBeVisible();
    });

    test('the switcher lists every project and goes to one', async ({page}) => {
        await page.goto(NOTES.home());

        await page.getByTestId('topbar-project').click();
        const items = page.getByTestId('topbar-project-item');
        await expect(items).toHaveCount(3);
        await expect(items.filter({hasText: 'Team wiki'})).toBeVisible();
        await shot(page, 'projects-switcher');

        await items.filter({hasText: 'Team wiki'}).click();
        await page.waitForLoadState('networkidle');

        // a full page load, so the shell boots with the new basename
        await expect(page).toHaveURL(TEAM.home());
        await expect(page.locator('#scrawl-app-root')).toHaveAttribute('data-base', '/p/team');
        await expect(page.getByTestId('topbar-project')).toContainText('Team wiki');
    });

    test('a save lands in the root of the project it was made in', async ({page}) => {
        const name = 'e2e-team-note.md';
        await page.goto(TEAM.edit(name));
        await setSource(page, '# Team note\n\nwritten through the team project.\n');
        await save(page);

        expect(fs.readFileSync(path.join(teamRoot, name), 'utf8')).toContain('written through the team project');
        expect(fs.existsSync(path.join(MULTI.root, name)), 'it must not reach the other project').toBe(false);
        fs.rmSync(path.join(teamRoot, name), {force: true});
    });

    // the whole remote mode from the outside: the project's directory is a
    // clone the server made, and a save reaches the origin
    test('a remote project pushes what the app saves', async ({page}) => {
        const name = 'e2e-remote-note.md';
        expect(fs.existsSync(path.join(wikiRoot, '.git')), 'the server cloned into the directory').toBe(true);

        await page.goto(WIKI.edit(name));
        await setSource(page, '# Remote note\n\nsaved in the app.\n');
        await save(page);

        await expect.poll(() => tracked(wikiOrigin), {timeout: 15_000}).toContain(name);
        await expect(page.getByTestId('project-alert')).toHaveCount(0);
    });

    // a second writer moves the branch, and the pull ticker brings it in
    test('a remote project takes what the origin gained', async ({page}) => {
        pushToOrigin(wikiOrigin, 'e2e-upstream.md', '# Upstream note\n\npushed by somebody else.\n');

        await expect.poll(
            async () => {
                await page.goto(WIKI.doc('e2e-upstream.md'));
                return page.getByTestId('doc').isVisible();
            },
            {timeout: 20_000},
        ).toBe(true);
        await expect(page.getByTestId('doc').locator('h1').first()).toContainText('Upstream note');
    });

    test('a project name is required and never invented', async () => {
        const result = await runBinary(['--root=' + MULTI.root, '--listen=127.0.0.1:0', '--auth.disabled']);

        expect(result.code, result.output).not.toBe(0);
        expect(result.output).toContain('every project needs a name');
    });
});

// runBinary starts the server and waits for it to give up, which is what a
// configuration it refuses does.
function runBinary(args) {
    return new Promise((resolve) => {
        execFile(binary, args, {timeout: 20_000}, (error, stdout, stderr) => {
            resolve({code: error === null ? 0 : (error.code ?? 1), output: `${stdout}${stderr}`});
        });
    });
}
