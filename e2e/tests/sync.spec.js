const {expect, test} = require('@playwright/test');

const fs = require('fs');
const path = require('path');

const {breakOrigin, restoreOrigin} = require('../support/git');
const {MULTI, editorStatus, save, setSource, shot, signIn} = require('../support/helpers');

const WIKI = MULTI.projects.wiki;
const wiki = MULTI.extra.find((extra) => extra.name === 'wiki');

// the note every test breaks, written fresh so a previous run cannot decide the
// outcome of this one
const DOC = 'e2e-sync.md';

// the client polls /api/me once a minute, which is finer than the pull interval
// it is watching. A test that waited for it in real time would take longer than
// the whole suite, so the clock is driven instead.
const pollMs = 61_000;

function control(page) {
    return page.getByTestId('sync-control');
}

test.describe('sync state', () => {
    test.beforeEach(async ({page}) => {
        restoreOrigin(wiki.origin);
        fs.writeFileSync(path.join(wiki.dir, DOC), '# Sync\n\nstarting point.\n', 'utf8');
        await signIn(page, {baseURL: MULTI.baseURL, from: WIKI.doc(DOC)});
        // the startup state is whatever the previous test left, so wait for the
        // project to be in step before breaking anything
        await expect.poll(async () => meState(page), {timeout: 20_000}).toMatchObject({sync_error: ''});
    });

    test.afterEach(async ({page}) => {
        restoreOrigin(wiki.origin);
        fs.rmSync(path.join(wiki.dir, DOC), {force: true});
        // leave the project in step, or the next spec inherits a broken one
        await expect.poll(async () => meState(page), {timeout: 20_000}).toMatchObject({sync_error: ''});
    });

    // the first failure has to reach somebody who is looking at the editor and
    // nothing else: a toast now, and two persistent surfaces with no reload
    test('a failed push shows up everywhere without a reload', async ({page}) => {
        await page.goto(WIKI.edit(DOC));
        breakOrigin(wiki.origin);

        await setSource(page, '# Sync\n\nstuck in the container.\n');
        await save(page);

        await expect(page.getByTestId('toast')).toHaveAttribute('data-kind', 'warn');
        await expect(control(page)).toBeVisible();
        await expect(control(page)).toHaveAttribute('data-here', 'true');
        await expect(page.getByTestId('project-alert')).toBeVisible();
        await expect(page.getByTestId('project-alert')).toHaveAttribute('data-kind', 'push');
        await shot(page, 'sync-editor-warned');

        // the badge is on the note, on every surface that lists it
        await page.goto(WIKI.doc(DOC));
        await expect(page.getByTestId('sync-badge').first()).toBeVisible();
        await page.goto(WIKI.search('stuck'));
        await expect(page.getByTestId('search-result').first().getByTestId('sync-badge')).toBeVisible();
        await shot(page, 'sync-search-badge');
    });

    // the reader's own change settles the screen in one round trip, in either
    // direction: refreshing only on a dirty response would leave the warning up
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
        await expect(page.getByTestId('project-alert')).toHaveCount(0);
    });

    // nobody caused this one: the origin comes back, the server's own ticker
    // syncs, and only a poll can tell the page about it
    test('a background sync that succeeded clears the state on a poll', async ({page}) => {
        await page.clock.install();
        await page.goto(WIKI.edit(DOC));
        breakOrigin(wiki.origin);
        await setSource(page, '# Sync\n\nwaiting for the ticker.\n');
        await save(page);
        await expect(control(page)).toBeVisible();

        restoreOrigin(wiki.origin);
        // the server's pull interval is seconds on this instance, the client's
        // is a minute: give the first one real time and the second the clock
        await expect.poll(async () => meState(page), {timeout: 20_000}).toMatchObject({sync_error: ''});
        await page.clock.runFor(pollMs);

        await expect(control(page)).toHaveCount(0);
        await expect(page.getByTestId('project-alert')).toHaveCount(0);
    });

    // a conflict copy is a save like any other, and its response used to be
    // thrown away before the navigation
    test('a conflict copy reports its own push', async ({page}) => {
        await page.goto(WIKI.edit(DOC));
        await setSource(page, '# Sync\n\nmine.\n');
        // somebody else writes the file while this editor holds a stale revision
        fs.writeFileSync(path.join(wiki.dir, DOC), '# Sync\n\ntheirs.\n', 'utf8');
        breakOrigin(wiki.origin);

        await page.locator('[data-testid=editor-save]').click();
        await page.locator('[data-testid=editor-conflict-copy]').click();

        await expect(page).toHaveURL(new RegExp('conflict-'));
        await expect(control(page)).toBeVisible();
        await expect(page.getByTestId('project-alert')).toBeVisible();
    });

    // the route path is not the file whenever a directory is served as its
    // index.md, and the root is that case with an empty path
    test('an index note is the file the control speaks for', async ({page}) => {
        await page.goto(WIKI.edit('index.md'));
        breakOrigin(wiki.origin);
        await setSource(page, '# Remote page\n\nthe root index, stuck.\n');
        await save(page);

        await page.goto(WIKI.home());
        await expect(control(page)).toHaveAttribute('data-here', 'true');
        await expect(control(page)).toHaveAttribute('aria-label', 'This note has not reached the remote');
        await shot(page, 'sync-root-index');

        // a note the remote does have leaves the control speaking for the
        // project and not for the note
        await page.goto(WIKI.doc('remote.md'));
        await expect(control(page)).toHaveAttribute('data-here', 'false');
    });

    // the poll must never replace a good answer with nothing: canWrite hangs off
    // me, so a blank one would flash every write control off once a tick
    test('a slow poll blanks nothing', async ({page}) => {
        await page.clock.install();
        await page.goto(WIKI.doc(DOC));
        await expect(page.getByTestId('tree-row').first()).toBeVisible();

        await page.route(/\/api\/me$/, async (route) => {
            await new Promise((resolve) => setTimeout(resolve, 3_000));
            await route.continue().catch(() => {
                // the page moved on, which is exactly the case the generation
                // counter covers
            });
        });
        await page.clock.runFor(pollMs);
        await page.clock.runFor(pollMs);

        await expect(page.getByTestId('tree-row').first()).toBeVisible();
        await expect(page.getByTestId('doc-edit')).toBeVisible();
    });

    // a poll that met an expired session would otherwise open the editor's
    // session dialog with nobody touching anything
    test('a poll that meets a 401 opens no dialog', async ({page}) => {
        await page.clock.install();
        await page.goto(WIKI.edit(DOC));
        await expect(editorStatus(page)).toBeVisible();

        await page.route(/\/api\/me$/, (route) =>
            route.fulfill({status: 401, contentType: 'application/json', body: '{"error":"unauthorized"}'}));
        await page.clock.runFor(pollMs);
        await page.waitForTimeout(500);
        await page.unroute(/\/api\/me$/);

        // the variant, not a bare modal: the lightbox is mounted closed on
        // every page that renders a document, preview pane included
        await expect(page.locator('[data-testid=modal][data-variant=session]')).toHaveCount(0);
    });
});

// meState reads the project state the page itself would poll, which is what
// makes a wait for the server's own rhythm honest rather than a sleep.
async function meState(page) {
    return page.evaluate(async (url) => {
        const res = await fetch(url, {headers: {accept: 'application/json'}});
        const body = await res.json();
        return body.project;
    }, WIKI.api('/me'));
}
