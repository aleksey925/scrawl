const {expect, test} = require('../support/test');

const fs = require('fs');
const path = require('path');

const {breakOrigin, git, pushToOrigin, restoreOrigin} = require('../support/git');
const {MULTI, editorStatus, inStep, mockMe, save, setSource, shot, signIn} = require('../support/helpers');

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
        await page.unrouteAll({behavior: 'ignoreErrors'});
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

        await expect(control(page)).toHaveAttribute('data-state', 'warning');
        await expect(control(page)).toHaveAttribute('data-here', 'true');
        const alert = page.getByTestId('space-alert');
        await expect(alert).toBeVisible();
        await expect(alert).toContainText('Retrying in a minute.');
        const kind = await alert.getAttribute('data-kind');
        expect(['push', 'fetch']).toContain(kind);
        await expect(control(page)).toHaveText(kind === 'fetch' ? 'No connection' : 'Not synced');
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

        await expect(control(page)).toHaveAttribute('data-state', 'sent');
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

        await expect(control(page)).toHaveAttribute('data-state', 'sent');
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
        await expect(control(page)).toHaveAttribute('data-state', 'warning');
        await expect(control(page)).toHaveAttribute('data-here', 'true');
        await expect(control(page)).toHaveAttribute('aria-label', /^(Not synced|No connection)\. This note is not sent yet$/);
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
        await expect(control(page)).toHaveAttribute('data-state', 'blocked');
        await expect(control(page)).toHaveText('Conflict');
        await expect(page.getByTestId('space-alert')).not.toContainText('Retrying');
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
        await expect(control(page)).toHaveAttribute('data-state', 'sent');
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
        await mockMe(page, {
            unpublished: true,
            push_refused: true,
            retrying: false,
            sync_error: 'push: git push origin HEAD:refs/heads/main: exit status 128: ' +
                "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
        });
        await page.goto(WIKI.doc(DOC));

        const alert = page.getByTestId('space-alert');
        await expect(alert).toContainText('The remote refuses changes');
        await expect(alert).toContainText('Use a token with write access, or make the space read-only.');
        await expect(alert).not.toContainText('Retrying');
        await expect(control(page)).toHaveAttribute('data-state', 'blocked');
        await expect(control(page)).toHaveText('Access refused');
        await expect(alert.getByTestId('space-alert-reason')).toHaveCount(0);
        await shot(page, 'sync-push-refused');
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

    test('a change on its way spins, then shows a quiet check', async ({page}) => {
        // arrange
        const me = await mockMe(page, {pushing: true});

        // act
        await page.goto(WIKI.doc(DOC));

        // assert
        await expect(control(page)).toHaveAttribute('data-state', 'sending');
        await expect(control(page).getByTestId('sync-spinner')).toBeVisible();
        await expect(control(page)).toHaveText('');
        await expect(control(page)).toHaveAttribute('aria-label', 'Syncing…');
        await shot(page, 'sync-sending');
        me.set({pushing: false});
        await expect(control(page)).toHaveAttribute('data-state', 'sent');
        await expect(control(page)).toHaveText('');
        await expect(control(page)).toHaveAttribute('aria-label', 'Synced');
        await control(page).click();
        await expect(page.getByTestId('sync-popover')).toHaveText('Synced');
        await shot(page, 'sync-sent');
    });

    test('a change waiting for its retry is asked about every five seconds', async ({page}) => {
        // arrange
        const me = await mockMe(page, {unpublished: true, retrying: true, sync_error: 'push: the remote is down'});
        await page.goto(WIKI.doc(DOC));
        await expect(control(page)).toHaveAttribute('data-state', 'warning');
        const waiting = me.hits();

        // act
        await expect.poll(() => me.hits(), {timeout: 15_000}).toBeGreaterThanOrEqual(waiting + 2);
        me.set({pushing: true});

        // assert
        const [first, second] = me.times().slice(waiting, waiting + 2);
        expect(second - first).toBeGreaterThan(4_000);
        expect(second - first).toBeLessThan(7_000);
        await expect(control(page)).toHaveAttribute('data-state', 'sending', {timeout: 8_000});
        me.set({pushing: false, retrying: false, unpublished: false, sync_error: ''});
        await expect(control(page)).toHaveAttribute('data-state', 'sent');
        await expect(page.getByTestId('space-alert')).toHaveCount(0);
    });

    test('a poll that fails does not stop the polling', async ({page}) => {
        // arrange
        const me = await mockMe(page, {pushing: true});
        await page.goto(WIKI.doc(DOC));
        await expect(control(page)).toHaveAttribute('data-state', 'sending');

        // act
        me.failNext();
        await expect.poll(() => me.failed(), {timeout: 8_000}).toBe(1);
        me.set({pushing: false});

        // assert
        await expect(control(page)).toHaveAttribute('data-state', 'sent');
    });

    test('a poll slower than its wait still lands', async ({page}) => {
        // arrange
        const me = await mockMe(page, {pushing: true});
        await page.goto(WIKI.doc(DOC));
        await expect(control(page)).toHaveAttribute('data-state', 'sending');

        // act
        me.delay(3_000);
        me.set({pushing: false});

        // assert
        await expect(control(page)).toHaveAttribute('data-state', 'sent', {timeout: 10_000});
    });

    test('a poll that never answers does not stop the polling', async ({page}) => {
        // arrange
        await page.clock.install();
        const me = await mockMe(page, {pushing: true});
        await page.goto(WIKI.doc(DOC));
        await expect(control(page)).toHaveAttribute('data-state', 'sending');
        me.hangNext();
        await page.clock.runFor(2_000);
        await expect.poll(() => me.hung()).toBe(1);
        me.set({pushing: false});

        // act
        await page.clock.runFor(32_000);

        // assert
        await expect(control(page)).toHaveAttribute('data-state', 'sent');
    });

    test('a hidden tab does not poll, and polls at once when shown again', async ({page}) => {
        // arrange
        await page.clock.install();
        const me = await mockMe(page, {pushing: true});
        await page.goto(WIKI.doc(DOC));
        await expect(control(page)).toHaveAttribute('data-state', 'sending');
        await setHidden(page, true);
        await page.waitForTimeout(500);
        const hidden = me.hits();

        // act
        await page.clock.runFor(pollMs);
        await page.waitForTimeout(500);
        const whileHidden = me.hits();
        await setHidden(page, false);

        // assert
        expect(whileHidden).toBe(hidden);
        await expect.poll(() => me.hits(), {timeout: 3_000}).toBeGreaterThan(hidden);
    });

    test('a failed push that waits for the next save says so', async ({page}) => {
        // arrange
        await mockMe(page, {unpublished: true, retrying: false, sync_error: 'push: the remote is down'});

        // act
        await page.goto(WIKI.doc(DOC));

        // assert
        await expect(control(page)).toHaveAttribute('data-state', 'warning');
        await expect(control(page)).toHaveText('Not synced');
        const alert = page.getByTestId('space-alert');
        await expect(alert).toContainText('The next save will try again.');
        await expect(alert).not.toContainText('in a minute');
    });

    test('a failed fetch with nothing waiting is a warning', async ({page}) => {
        // arrange
        await mockMe(page, {
            unpublished: false,
            sync_error: "fetch: git fetch --prune origin main: exit status 128: fatal: unable to access 'origin'",
        });

        // act
        await page.goto(WIKI.doc(DOC));

        // assert
        await expect(control(page)).toHaveAttribute('data-state', 'warning');
        await expect(control(page)).toHaveText('No connection');
        const alert = page.getByTestId('space-alert');
        await expect(alert).toHaveAttribute('data-kind', 'fetch');
        await expect(alert).toContainText('No connection to the remote');
    });

    test('a read-only remote space shows no sync control', async ({page}) => {
        // arrange
        await mockMe(page, {read_only: true});

        // act
        await page.goto(WIKI.doc(DOC));

        // assert
        await expect(page.getByText('starting point.')).toBeVisible();
        await expect(control(page)).toHaveCount(0);
    });

    test('history that was not recorded is not called unsent', async ({page}) => {
        // arrange
        await mockMe(page, {}, {history_degraded: true});

        // act
        await page.goto(WIKI.doc(DOC));

        // assert
        await expect(control(page)).toHaveAttribute('data-state', 'warning');
        await expect(control(page)).toHaveText('Not synced');
        await expect(page.getByTestId('space-alert')).toHaveAttribute('data-kind', 'degraded');
    });

    test('a diverged space whose fetch fails still says it diverged', async ({page}) => {
        // arrange
        await mockMe(page, {
            unpublished: true,
            diverged: true,
            sync_error: "fetch: git fetch --prune origin main: exit status 128: fatal: unable to access 'origin'",
        });

        // act
        await page.goto(WIKI.doc(DOC));

        // assert
        await expect(control(page)).toHaveAttribute('data-state', 'blocked');
        await expect(control(page)).toHaveText('Conflict');
        const alert = page.getByTestId('space-alert');
        await expect(alert).toHaveAttribute('data-kind', 'merge');
        await expect(alert).toContainText('Conflict with the remote repository');
        await expect(alert.getByTestId('sync-reset')).toBeVisible();
        await expect(alert.getByTestId('space-alert-reason')).toHaveText(/^fetch: /);
        await expect(alert).not.toContainText('Retrying');
    });

    test('a refused fetch asks for a token that may read the remote', async ({page}) => {
        // arrange
        await mockMe(page, {
            unpublished: true,
            push_refused: true,
            sync_error: 'fetch: git fetch --prune origin main: exit status 128: ' +
                "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
        });

        // act
        await page.goto(WIKI.doc(DOC));

        // assert
        await expect(control(page)).toHaveAttribute('data-state', 'blocked');
        await expect(control(page)).toHaveText('Access refused');
        const alert = page.getByTestId('space-alert');
        await expect(alert).toContainText('The remote refuses the token');
        await expect(alert).toContainText('Use a token that can read the remote');
        await expect(alert).not.toContainText('Retrying');
    });

    test('a change on its way to a note that is open shows that note in the calm tip', async ({page}) => {
        // arrange
        await mockMe(page, {pushing: true, unpublished: true, unsynced: {paths: [DOC], many: false}});
        await page.goto(WIKI.doc(DOC));
        await expect(control(page)).toHaveAttribute('data-state', 'sending');

        // act
        await control(page).click();

        // assert
        await expect(page.getByTestId('sync-popover').locator('[data-testid=status-tip] > div')).toHaveText([
            'Syncing…', 'This note is not sent yet',
        ]);
    });

    test('a conflict banner points at the sync status, whose popover lists the files', async ({page}) => {
        // arrange
        await mockMe(page, {unpublished: true, diverged: true, can_reset: true, unsynced: {paths: [DOC], many: false}});
        await page.goto(WIKI.doc(DOC));

        // act
        await control(page).click();

        // assert
        await expect(page.getByTestId('space-alert')).toContainText(
            'The local copy no longer matches the remote repository, so sync is paused. ' +
            'Click the sync status at the top to see the conflicting files.',
        );
        const popover = page.getByTestId('sync-popover');
        await expect(popover).toContainText('The local copy no longer matches the remote repository, so sync is paused.');
        await expect(popover).not.toContainText('Click the sync status');
        await expect(popover).toContainText('Conflicting files:');
        await expect(popover.getByTestId('sync-popover-paths').getByRole('listitem')).toHaveText([DOC]);
    });

    test('a failed push banner points at the sync status, whose popover lists the files under no conflict', async ({page}) => {
        // arrange
        await mockMe(page, {
            unpublished: true, retrying: false, sync_error: 'push: the remote is down', unsynced: {paths: [DOC], many: false},
        });
        await page.goto(WIKI.doc(DOC));

        // act
        await control(page).click();

        // assert
        await expect(page.getByTestId('space-alert')).toContainText(
            'Saved here, but not sent yet. The next save will try again. ' +
            'To see the changes that were not synced, click the sync status at the top.',
        );
        const popover = page.getByTestId('sync-popover');
        await expect(popover).toContainText('Saved here, but not sent yet. The next save will try again.');
        await expect(popover).not.toContainText('To see the changes');
        await expect(popover).not.toContainText('Conflicting files:');
        await expect(popover.getByTestId('sync-popover-paths').getByRole('listitem')).toHaveText([DOC]);
    });

    test('too many files to list says so in the banner and the popover', async ({page}) => {
        // arrange
        await mockMe(page, {
            unpublished: true, retrying: false, sync_error: 'push: the remote is down', unsynced: {paths: [], many: true},
        });
        await page.goto(WIKI.doc(DOC));

        // act
        await control(page).click();

        // assert
        const said = 'Saved here, but not sent yet. The next save will try again. Too many files to list.';
        await expect(page.getByTestId('space-alert')).toContainText(said);
        await expect(page.getByTestId('sync-popover')).toContainText(said);
        await expect(page.getByTestId('sync-popover-paths')).toHaveCount(0);
    });

    test('a conflict the person cannot reset says who can, and offers no reset', async ({page}) => {
        // act
        await mockMe(page, {unpublished: true, diverged: true, can_reset: false});
        await page.goto(WIKI.doc(DOC));

        // assert
        const alert = page.getByTestId('space-alert');
        await expect(alert).toContainText(
            'The local copy no longer matches the remote repository, so sync is paused. ' +
            'Someone who can write to this space can fix it.',
        );
        await expect(alert.getByTestId('sync-reset')).toHaveCount(0);
    });

    const resetLosses = [
        {
            name: 'too many files to list',
            lost: {paths: [], many: true},
            text: 'Too many conflicting files to list.',
        },
        {
            name: 'files that could not be listed',
            lost: {paths: [], many: false},
            text: 'The conflicting files could not be listed, so treat every local change as conflicting.',
        },
    ];

    for (const loss of resetLosses) {
        test(`a replace with ${loss.name} keeps a backup it was told not to push`, async ({page}) => {
            // arrange
            const resets = await routeReset(page, {json: {backup: 'scrawl-backup/kept', backup_pushed: false}});
            const dialog = await openReset(page, {json: divergence({lost: loss.lost})});
            const box = dialog.getByTestId('reset-push-backup');
            await expect(box).toBeChecked();

            // act
            await box.uncheck();
            await dialog.getByTestId('modal-confirm').click();

            // assert
            await expect(dialog).toHaveAttribute('data-step', 'done');
            expect(resets).toEqual([{head: 'local-head', remote: 'remote-head', push_backup: false}]);
            await expect(page.locator('.mantine-Modal-title')).toHaveText('Local copy replaced');
            await expect(dialog.getByTestId('reset-done')).toHaveText(
                'The local version is saved to the branch scrawl-backup/kept. It was not pushed to remote.',
            );
        });

        test(`a replace with ${loss.name} says so before it starts`, async ({page}) => {
            // act
            const dialog = await openReset(page, {json: divergence({lost: loss.lost})});

            // assert
            await expect(page.locator('.mantine-Modal-title')).toHaveText('Replace local copy?');
            await expect(dialog.getByTestId('reset-lost')).toHaveText(
                'After this, the local copy matches the remote repository and sync resumes. ' +
                `${loss.text} The local version is saved to a backup branch first, so nothing is lost.`,
            );
        });
    }

    test('a clean replace offers no backup and makes none', async ({page}) => {
        // arrange
        const resets = await routeReset(page, {json: {backup: '', backup_pushed: false}});

        // act
        const dialog = await openReset(page, {json: divergence({clean: true})});

        // assert
        await expect(dialog.getByTestId('reset-clean')).toHaveText(
            'After this, the local copy matches the remote repository and sync resumes. ' +
            'All local changes are already in the remote repository, so nothing will be lost.',
        );
        await expect(dialog.getByTestId('reset-push-backup')).toHaveCount(0);

        // act
        await dialog.getByTestId('modal-confirm').click();

        // assert
        await expect(dialog).toHaveAttribute('data-step', 'done');
        expect(resets).toEqual([{head: 'local-head', remote: 'remote-head', push_backup: false}]);
        await expect(dialog.getByTestId('reset-done')).toHaveText('Nothing was lost, so no backup branch was made.');
    });

    test('a copy already in step has nothing to replace', async ({page}) => {
        // act
        const dialog = await openReset(page, {status: 409, headers: {'app-name': 'scrawl'}, json: {error: 'in step'}});

        // assert
        await expect(dialog).toHaveAttribute('data-step', 'failed');
        await expect(page.locator('.mantine-Modal-title')).toHaveText('Nothing to replace');
        await expect(dialog.getByTestId('reset-in-step')).toHaveText('The local copy already matches the remote repository.');
        await expect(dialog.getByTestId('reset-retry')).toHaveCount(0);
    });

    test('a check that fails says why and can be tried again', async ({page}) => {
        // act
        const dialog = await openReset(page, {
            status: 500, headers: {'app-name': 'scrawl'}, json: {error: 'the remote could not be read'},
        });

        // assert
        await expect(dialog).toHaveAttribute('data-step', 'failed');
        await expect(page.locator('.mantine-Modal-title')).toHaveText('The local copy was not replaced');
        await expect(dialog.getByTestId('reset-failed')).toHaveText('the remote could not be read');
        await expect(dialog.getByTestId('reset-retry')).toBeVisible();
    });

    test('a local space shows no sync control', async ({page}) => {
        // act
        await page.goto(MULTI.spaces.team.doc('team.md'));

        // assert
        await expect(page.getByText('only this space has it.')).toBeVisible();
        await expect(control(page)).toHaveCount(0);
    });
});

async function setHidden(page, hidden) {
    await page.evaluate((value) => {
        Object.defineProperty(document, 'hidden', {configurable: true, get: () => value});
        document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
}

async function meState(page) {
    return page.evaluate(async (url) => {
        const res = await fetch(url, {headers: {accept: 'application/json'}});
        const body = await res.json();
        return body.space;
    }, WIKI.api('/me'));
}

function divergence(patch) {
    return {
        head: 'local-head',
        remote: 'remote-head',
        clean: false,
        lost: {paths: [], many: false},
        can_push_backup: true,
        ...patch,
    };
}

async function openReset(page, check) {
    await mockMe(page, {unpublished: true, diverged: true, can_reset: true});
    await page.route(/\/api\/sync\/check$/, (route) => route.fulfill(check));
    await page.goto(WIKI.doc(DOC));
    await page.getByTestId('space-alert').getByTestId('sync-reset').click();
    const dialog = page.locator('[data-testid=modal][data-variant=reset]');
    await expect(dialog).not.toHaveAttribute('data-step', 'checking');
    return dialog;
}

async function routeReset(page, answer) {
    const asked = [];
    await page.route(/\/api\/sync\/reset$/, (route) => {
        asked.push(route.request().postDataJSON());
        return route.fulfill(answer);
    });
    return asked;
}
