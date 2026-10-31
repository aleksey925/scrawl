const {expect, test} = require('../support/test');

const fs = require('fs');
const path = require('path');

const {breakOrigin, git, pushToOrigin, restoreOrigin} = require('../support/git');
const {MULTI, editorStatus, inStep, save, setSource, shot, signIn} = require('../support/helpers');

const WIKI = MULTI.spaces.wiki;
const wiki = MULTI.extra.find((extra) => extra.name === 'wiki');

const DOC = 'e2e-sync.md';

const FOLDER = 'e2e-sync-folder';
const FOLDER_DOC = `${FOLDER}/index.md`;

const THEIRS = 'e2e-sync-theirs.md';

const LATE = 'e2e-sync-late.md';

const pollMs = 61_000;

function control(page) {
    return page.getByTestId('sync-control');
}

test.describe('sync state', () => {
    test.beforeEach(async ({page}) => {
        restoreOrigin(wiki.origin);
        fs.writeFileSync(path.join(wiki.dir, DOC), '# Sync\n\nstarting point.\n', 'utf8');
        await signIn(page, {baseURL: MULTI.baseURL, from: WIKI.doc(DOC)});
        await inStep(page, WIKI);
    });

    test.afterEach(async ({page}) => {
        restoreOrigin(wiki.origin);
        fs.rmSync(path.join(wiki.dir, DOC), {force: true});
        fs.rmSync(path.join(wiki.dir, FOLDER), {recursive: true, force: true});
        fs.rmSync(path.join(wiki.dir, THEIRS), {force: true});
        fs.rmSync(path.join(wiki.dir, LATE), {force: true});
        await inStep(page, WIKI);
    });

    test('a failed push shows up everywhere without a reload', async ({page}) => {
        await page.goto(WIKI.edit(DOC));
        breakOrigin(wiki.origin);

        await setSource(page, '# Sync\n\nstuck in the container.\n');
        await save(page);

        await expect(page.getByTestId('toast')).toHaveAttribute('data-kind', 'warn');
        await expect(control(page)).toBeVisible();
        await expect(control(page)).toHaveAttribute('data-here', 'true');
        const alert = page.getByTestId('space-alert');
        await expect(alert).toBeVisible();
        const kind = await alert.getAttribute('data-kind');
        expect(['push', 'fetch']).toContain(kind);
        await expect(alert.getByTestId('space-alert-reason')).toHaveText(new RegExp(`^${kind}: `));
        await shot(page, 'sync-editor-warned');

        await page.goto(WIKI.doc(DOC));
        await expect(page.getByTestId('sync-badge').first()).toBeVisible();
        await page.goto(WIKI.search('stuck'));
        await expect(page.getByTestId('search-result').first().getByTestId('sync-badge')).toBeVisible();
        await shot(page, 'sync-search-badge');
    });

    test('a save that finally pushes clears the state on its own', async ({page}) => {
        await page.goto(WIKI.edit(DOC));
        breakOrigin(wiki.origin);
        await setSource(page, '# Sync\n\nfirst try.\n');
        await save(page);
        await expect(control(page)).toBeVisible();

        restoreOrigin(wiki.origin);
        await setSource(page, '# Sync\n\nsecond try.\n');
        await save(page);

        await expect(control(page)).toHaveCount(0);
        await expect(page.getByTestId('space-alert')).toHaveCount(0);
    });

    test('a background sync that succeeded clears the state on a poll', async ({page}) => {
        await page.clock.install();
        await page.goto(WIKI.edit(DOC));
        breakOrigin(wiki.origin);
        await setSource(page, '# Sync\n\nwaiting for the ticker.\n');
        await save(page);
        await expect(control(page)).toBeVisible();

        restoreOrigin(wiki.origin);
        await expect.poll(async () => meState(page), {timeout: 20_000}).toMatchObject({sync_error: ''});
        await page.clock.runFor(pollMs);

        await expect(control(page)).toHaveCount(0);
        await expect(page.getByTestId('space-alert')).toHaveCount(0);
    });

    test('a conflict copy reports its own push', async ({page}) => {
        await page.goto(WIKI.edit(DOC));
        await setSource(page, '# Sync\n\nmine.\n');
        fs.writeFileSync(path.join(wiki.dir, DOC), '# Sync\n\ntheirs.\n', 'utf8');
        breakOrigin(wiki.origin);

        await page.locator('[data-testid=editor-save]').click();
        await page.locator('[data-testid=editor-conflict-copy]').click();

        await expect(page).toHaveURL(new RegExp('conflict-'));
        await expect(control(page)).toBeVisible();
        await expect(page.getByTestId('space-alert')).toBeVisible();
    });

    test('an index note is spoken for under its own address', async ({page}) => {
        await page.goto(WIKI.edit('index.md'));
        breakOrigin(wiki.origin);
        await setSource(page, `# Remote page\n\nthe root index, stuck at ${Date.now()}.\n`);
        await save(page);

        await page.goto(WIKI.doc('index.md'));
        await expect(control(page)).toHaveAttribute('data-here', 'true');
        await expect(control(page)).toHaveAttribute('aria-label', 'This note has not reached the remote');
        await shot(page, 'sync-root-index');

        await page.goto(WIKI.edit(FOLDER_DOC));
        await setSource(page, '# Guide\n\nthe folder index, stuck.\n');
        await save(page);

        await page.goto(WIKI.doc(FOLDER_DOC));
        await expect(control(page)).toHaveAttribute('data-here', 'true');

        await page.goto(WIKI.doc('remote.md'));
        await expect(control(page)).toHaveAttribute('data-here', 'false');
    });

    test('a diverged space is reset from the page', async ({page}) => {
        await page.goto(WIKI.edit(DOC));
        breakOrigin(wiki.origin);
        await setSource(page, '# Sync\n\nwritten here only.\n');
        await save(page);
        pushToOrigin(`${wiki.origin}-aside`, THEIRS, '# Theirs\n\nwritten on the other side.\n');
        restoreOrigin(wiki.origin);
        await expect.poll(async () => meState(page), {timeout: 20_000}).toMatchObject({diverged: true});

        await page.goto(WIKI.doc(DOC));
        await expect(page.getByTestId('space-alert')).toHaveAttribute('data-kind', 'merge');
        await expect(page.getByTestId('space-alert')).not.toContainText('git ');
        await page.getByTestId('space-alert').getByTestId('sync-reset').click();

        const dialog = page.locator('[data-testid=modal][data-variant=reset]');
        await expect(dialog.getByTestId('reset-lost-paths')).toContainText(DOC);
        await shot(page, 'sync-reset-check');

        const checked = git(wiki.dir, ['rev-parse', 'HEAD']);
        fs.writeFileSync(path.join(wiki.dir, LATE), '# Late\n\nlanded after the check.\n', 'utf8');
        await expect.poll(() => git(wiki.dir, ['rev-parse', 'HEAD']), {timeout: 15_000}).not.toBe(checked);
        await dialog.getByTestId('modal-confirm').click();
        await expect(dialog.getByTestId('reset-moved')).toBeVisible();
        await expect(dialog.getByTestId('reset-lost-paths')).toContainText(LATE);

        await expect(async () => {
            if (await dialog.getAttribute('data-step') === 'ready') {
                await dialog.getByTestId('modal-confirm').click();
            }
            await expect(dialog).toHaveAttribute('data-step', 'done', {timeout: 3_000});
        }).toPass({timeout: 30_000});

        await expect(dialog.getByTestId('reset-backup')).toContainText('scrawl-backup/');
        const backup = await dialog.getByTestId('reset-backup').innerText();
        expect(git(wiki.origin, ['show', `${backup}:${DOC}`])).toContain('written here only.');
        expect(git(wiki.origin, ['show', `${backup}:${LATE}`])).toContain('landed after the check.');
        await shot(page, 'sync-reset-done');

        await dialog.getByTestId('reset-reload').click();
        await expect(page.getByTestId('space-alert')).toHaveCount(0);
        await expect(control(page)).toHaveCount(0);
        await page.goto(WIKI.doc(THEIRS));
        await expect(page.getByText('written on the other side.')).toBeVisible();
    });

    test('a slow poll blanks nothing', async ({page}) => {
        await page.clock.install();
        await page.goto(WIKI.doc(DOC));
        await expect(page.getByTestId('tree-row').first()).toBeVisible();

        await page.route(/\/api\/me$/, async (route) => {
            await new Promise((resolve) => setTimeout(resolve, 3_000));
            await route.continue().catch(() => {
            });
        });
        await page.clock.runFor(pollMs);
        await page.clock.runFor(pollMs);

        await expect(page.getByTestId('tree-row').first()).toBeVisible();
        await expect(page.getByTestId('doc-edit')).toBeVisible();
    });

    test('a refused push says what to do and not what git said', async ({page}) => {
        await page.route(/\/api\/me$/, async (route) => {
            const res = await route.fetch();
            const body = await res.json();
            Object.assign(body.space, {
                unpublished: true,
                push_refused: true,
                sync_error: 'push: git push origin HEAD:refs/heads/main: exit status 128: ' +
                    "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
            });
            await route.fulfill({response: res, json: body});
        });
        await page.goto(WIKI.doc(DOC));

        const alert = page.getByTestId('space-alert');
        await expect(alert).toContainText('The remote does not take changes from this space');
        await expect(alert).toContainText('Give the space a token with write access, or make it read-only.');
        await expect(alert.getByTestId('space-alert-reason')).toHaveCount(0);
        await shot(page, 'sync-push-refused');
        await page.unroute(/\/api\/me$/);
    });

    test('a poll that meets a 401 opens no dialog', async ({page}) => {
        await page.clock.install();
        await page.goto(WIKI.edit(DOC));
        await expect(editorStatus(page)).toBeVisible();

        await page.route(/\/api\/me$/, (route) =>
            route.fulfill({status: 401, contentType: 'application/json', body: '{"error":"unauthorized"}'}));
        await page.clock.runFor(pollMs);
        await page.waitForTimeout(500);
        await page.unroute(/\/api\/me$/);

        await expect(page.locator('[data-testid=modal][data-variant=session]')).toHaveCount(0);
    });
});

async function meState(page) {
    return page.evaluate(async (url) => {
        const res = await fetch(url, {headers: {accept: 'application/json'}});
        const body = await res.json();
        return body.space;
    }, WIKI.api('/me'));
}
