const {expect, test} = require('../support/test');

const {otherUser} = require('../support/env');
const {
    MAIN, MULTI, holdRoute, openSpaceMenu, removeFixture, routes, shot, signIn, submitCredentials, writeFixture,
} = require('../support/helpers');

const FOLDER = 'e2e-offline';
const NOTE = `${FOLDER}/everything.md`;
const PDF = `${FOLDER}/paper.pdf`;
const PICTURE = 'images/logo.png';

const EVERYTHING = [
    '# Offline note',
    '',
    'only the copy has it.',
    '',
    '![logo](../images/logo.png)',
    '',
    '$$E = mc^2$$',
    '',
    '```mermaid',
    'flowchart LR',
    '  A[Copy] --> B[Device]',
    '```',
    '',
    '```plantuml',
    '@startuml',
    '!include <C4/C4_Context>',
    'Person(reader, "Reader")',
    '@enduml',
    '```',
    '',
].join('\n');

const PAPER = '%PDF-1.4\n% a paper for the offline copy\n';

function status(page) {
    return page.getByTestId('space-menu-offline-status');
}

function copyRequests(page) {
    const seen = [];
    page.on('request', (request) => {
        if (request.headers()['x-scrawl-offline-copy'] === '1') {
            const url = new URL(request.url());
            seen.push(decodeURIComponent(url.pathname) + url.search);
        }
    });
    return seen;
}

async function turnOn(page) {
    await openSpaceMenu(page);
    const row = page.getByTestId('space-menu-offline');
    await expect(row).toHaveAttribute('data-on', 'false');
    await row.click();
    await expect(row).toHaveAttribute('data-on', 'true');
}

async function copyOn(page, home = routes.home()) {
    await page.goto(home);
    await turnOn(page);
    await expect(status(page)).toContainText('updated at', {timeout: 60_000});
    await page.keyboard.press('Escape');
    await expect.poll(() => workerState(page), {timeout: 60_000}).toBe('activated');
}

function cacheNames(page) {
    return page.evaluate(() => caches.keys());
}

function workerState(page) {
    return page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state ?? 'none');
}

function storedState(page) {
    return page.evaluate(async () => {
        const stored = await caches.match('/__scrawl-offline/state', {cacheName: 'scrawl-data'});
        return stored === undefined ? undefined : stored.json();
    });
}

function storedUrls(page) {
    return page.evaluate(async () => {
        if (!(await caches.has('scrawl-data'))) {
            return [];
        }
        const cache = await caches.open('scrawl-data');
        return (await cache.keys()).map((request) => decodeURIComponent(new URL(request.url).pathname));
    });
}

test.describe('offline access', () => {
    test.beforeEach(async ({page}) => {
        writeFixture(NOTE, EVERYTHING);
        await signIn(page);
    });

    test.afterEach(() => {
        removeFixture(FOLDER);
    });

    test('a plain browser has it off: no worker, no copy', async ({page}) => {
        // act
        await page.goto(routes.home());
        await openSpaceMenu(page);

        // assert
        await expect(page.getByTestId('space-menu-offline')).toHaveAttribute('data-on', 'false');
        await expect(status(page)).toHaveCount(0);
        expect(await workerState(page)).toBe('none');
        expect(await cacheNames(page)).toEqual([]);
    });

    test('turned on, it downloads everything and says when', async ({page}) => {
        // arrange
        await page.goto(routes.home());

        // act
        await turnOn(page);

        // assert
        await expect(status(page)).toContainText('Downloading');
        await expect(status(page)).toContainText(/MB, updated at \d\d:\d\d/, {timeout: 60_000});
        await expect.poll(() => workerState(page), {timeout: 60_000}).toBe('activated');
        const names = await cacheNames(page);
        expect(names).toContain('scrawl-data');
        expect(names.filter((name) => name.startsWith('scrawl-app-'))).toHaveLength(1);
        expect(await storedUrls(page)).toEqual(expect.arrayContaining([
            `/s/notes/api/page/${NOTE}`, `/s/notes/raw/${PICTURE}`, `/s/notes/api/dir/${FOLDER}`, '/api/spaces',
        ]));
    });

    test('a note never opened online is read offline with its picture and diagrams', async ({page, context}) => {
        // arrange
        await copyOn(page);

        // act
        await context.setOffline(true);
        await page.goto(routes.doc(NOTE));

        // assert
        const doc = page.getByTestId('doc');
        await expect(doc.locator('h1').first()).toContainText('Offline note');
        await expect.poll(() => doc.locator('img').first().evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
        await expect(doc.locator('.katex').first()).toBeVisible();
        await expect(doc.locator('.md-diagram[data-state="done"] svg')).toHaveCount(2);
        await shot(page, 'offline-note');
    });

    test('offline the app reads, filters the tree and changes nothing', async ({page, context}) => {
        // arrange
        await copyOn(page);
        await context.setOffline(true);

        // act
        await page.goto(routes.dir(FOLDER));

        // assert
        await expect(page.getByTestId('dir')).toContainText('everything.md');
        await expect(page.getByTestId('offline-mark')).toBeVisible();
        await expect(page.getByTestId('dir-new')).toHaveCount(0);
        await expect(page.getByTestId('sidebar-search')).toHaveCount(0);
        await page.getByTestId('sidebar-filter').fill('replication');
        await expect(page.getByTestId('tree-row').filter({hasText: 'replication.md'})).toBeVisible();
        await page.goto(routes.doc(NOTE));
        await expect(page.getByTestId('doc-edit')).toHaveCount(0);
        await openSpaceMenu(page);
        await expect(status(page)).toContainText(/No network, data from \d\d:\d\d/);
        await expect(page.getByTestId('space-menu-signout')).toHaveCount(0);
        await shot(page, 'offline-menu');
    });

    test('offline a page that needs the server says so', async ({page, context}) => {
        // arrange
        await copyOn(page);
        await context.setOffline(true);

        // act
        await page.goto(routes.edit(NOTE));

        // assert
        await expect(page.getByTestId('app-needs-network')).toBeVisible();
        await page.getByTestId('app-needs-network').getByRole('link').click();
        await expect(page.getByTestId('doc').locator('h1').first()).toContainText('Offline note');
    });

    test('a note not on the device says so', async ({page, context}) => {
        // arrange
        await copyOn(page);
        await context.setOffline(true);

        // act
        await page.goto(routes.doc(`${FOLDER}/never-written.md`));

        // assert
        await expect(page.getByTestId('doc-error')).toContainText('This is not on this device');
    });

    test('offline a file keeps its own headers and a raw url gets the file, not the app', async ({page, context}) => {
        // arrange
        writeFixture(PDF, PAPER);
        await copyOn(page);
        await context.setOffline(true);

        // act
        const fromWorker = await page.evaluate(async ([pdfUrl, pictureUrl]) => {
            const answers = await Promise.all([fetch(pdfUrl), fetch(pictureUrl)]);
            return Promise.all(answers.map(async (answer) => ({
                status: answer.status,
                type: answer.headers.get('content-type'),
                policy: answer.headers.get('content-security-policy'),
                body: (await answer.text()).slice(0, 8),
            })));
        }, [routes.raw(PDF), routes.raw(PICTURE)]);
        await page.goto(MAIN.url.raw(PICTURE));

        // assert
        expect(fromWorker).toEqual([
            {status: 200, type: 'application/pdf', policy: "default-src 'none'; sandbox", body: '%PDF-1.4'},
            {status: 200, type: 'image/png', policy: "default-src 'none'; sandbox", body: expect.any(String)},
        ]);
        await expect(page.locator('img')).toHaveCount(1);
    });

    test('a stalled network shows the note and its picture from the copy', async ({page, context}) => {
        // arrange
        await copyOn(page);
        await context.route(/\/s\/notes\/(doc|raw|api)\//, () => {});

        // act
        await page.goto(routes.doc(NOTE), {waitUntil: 'commit'});

        // assert
        const doc = page.getByTestId('doc');
        await expect(doc.locator('h1').first()).toContainText('Offline note', {timeout: 15_000});
        await expect.poll(() => doc.locator('img').first().evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
        await expect(page.getByTestId('offline-mark')).toBeVisible();
    });

    test('back online, writing comes back only once the account answers', async ({page, context}) => {
        // arrange
        await copyOn(page);
        await context.setOffline(true);
        await page.goto(routes.doc(NOTE));
        await expect(page.getByTestId('offline-mark')).toBeVisible();
        const me = await holdRoute(context, /\/api\/me$/);

        // act
        await context.setOffline(false);
        await page.evaluate(() => window.dispatchEvent(new Event('online')));
        await me.reached;

        // assert
        await expect(page.getByTestId('doc-edit')).toHaveCount(0);
        await expect(page.getByTestId('offline-mark')).toBeVisible();
        me.release();
        await expect(page.getByTestId('offline-mark')).toHaveCount(0);
        await expect(page.getByTestId('doc-edit')).toBeVisible();
    });

    test('a written and a deleted note reach the copy, and only what changed is asked for', async ({page, context}) => {
        // arrange
        writeFixture(`${FOLDER}/gone.md`, '# Gone soon\n');
        await copyOn(page);
        writeFixture(`${FOLDER}/fresh.md`, '# Fresh note\n\nwritten after the first copy.\n');
        removeFixture(`${FOLDER}/gone.md`);
        const asked = copyRequests(page);

        // act
        await page.reload();
        await expect.poll(() => asked.filter((url) => url.includes('/api/me')).length, {timeout: 30_000}).toBe(1);
        await expect.poll(async () => (await storedUrls(page)).includes(`/s/notes/api/page/${FOLDER}/fresh.md`)).toBe(true);

        // assert
        expect(asked.filter((url) => /\/api\/(page|dir)\/|\/raw\//.test(url)).sort()).toEqual([
            '/s/notes/api/dir/', `/s/notes/api/dir/${FOLDER}`, `/s/notes/api/page/${FOLDER}/fresh.md`,
        ]);
        expect(await storedUrls(page)).not.toContain(`/s/notes/api/page/${FOLDER}/gone.md`);
        await context.setOffline(true);
        await page.goto(routes.doc(`${FOLDER}/fresh.md`));
        await expect(page.getByTestId('doc').locator('h1').first()).toContainText('Fresh note');
    });

    test('a round cut short goes on where it stopped', async ({page, context}) => {
        // arrange
        await context.route(/\/api\/page\/db\//, (route) => route.fulfill({status: 500, body: 'down'}));
        await page.goto(routes.home());
        await turnOn(page);
        await expect(status(page)).toContainText('Could not update', {timeout: 60_000});
        expect(await storedUrls(page)).not.toContain('/s/notes/api/page/db/locks.md');
        await context.unroute(/\/api\/page\/db\//);
        const asked = copyRequests(page);

        // act
        await page.reload();
        await expect.poll(async () => (await storedState(page)).error, {timeout: 30_000}).toBe('');

        // assert
        expect(await storedUrls(page)).toContain('/s/notes/api/page/db/locks.md');
        expect(asked.filter((url) => url.includes('/api/page/')).every((url) => url.includes('/api/page/db/'))).toBe(true);
    });

    test('off deletes the copy and the worker at once', async ({page}) => {
        // arrange
        await copyOn(page);
        await openSpaceMenu(page);

        // act
        await page.getByTestId('space-menu-offline').click();

        // assert
        await expect(page.getByTestId('space-menu-offline')).toHaveAttribute('data-on', 'false');
        await expect(status(page)).toHaveCount(0);
        await expect.poll(() => cacheNames(page)).toEqual([]);
        await expect.poll(() => workerState(page)).toBe('none');
    });

    test('sign out deletes the data and keeps the app', async ({page}) => {
        // arrange
        await copyOn(page);
        await openSpaceMenu(page);

        // act
        await page.getByTestId('space-menu-signout').click();
        await page.waitForURL(/\/login/);

        // assert
        const names = await cacheNames(page);
        expect(names).not.toContain('scrawl-data');
        expect(names.filter((name) => name.startsWith('scrawl-app-'))).toHaveLength(1);
    });

    test('two tabs make one round, and the second shows the first one\'s progress', async ({page, context}) => {
        // arrange
        const versions = [];
        context.on('request', (request) => {
            if (request.url().endsWith('/api/versions')) {
                versions.push(request.url());
            }
        });
        const held = await holdRoute(context, /\/api\/page\/db\//);
        await page.goto(routes.home());
        await turnOn(page);
        await held.reached;
        const second = await context.newPage();

        // act
        await second.goto(routes.home());
        await openSpaceMenu(second);

        // assert
        await expect(status(second)).toContainText(/Downloading\.\.\. \d+ of \d+/);
        expect(versions).toHaveLength(1);
        held.release();
        await expect(status(second)).toContainText('updated at', {timeout: 60_000});
        expect(versions).toHaveLength(1);
    });
});

test.describe('offline access of every space', () => {
    test('every space is copied and another one opens offline', async ({page, context}) => {
        // arrange
        await signIn(page, {baseURL: MULTI.baseURL, from: MULTI.url.home()});
        await copyOn(page, MULTI.url.home());
        await context.setOffline(true);
        await page.goto(MULTI.url.home());

        // act
        await openSpaceMenu(page);
        await page.getByTestId('space-menu-space-item').filter({hasText: 'Team wiki'}).click();

        // assert
        await expect(page).toHaveURL(MULTI.spaces.team.home());
        await expect(page.getByTestId('dir')).toContainText('team.md');
        await page.goto(MULTI.spaces.team.doc('team.md'));
        await expect(page.getByTestId('doc').locator('h1').first()).toContainText('Team wiki');
    });

    test('another user who signs in never sees the copy of the one before', async ({page, context}) => {
        // arrange
        await signIn(page, {baseURL: MULTI.baseURL, from: MULTI.url.home()});
        await copyOn(page, MULTI.url.home());
        await context.clearCookies({name: 'scrawl_session'});
        await context.route(/\/api\/me$/, () => {});

        // act
        await page.goto(`${MULTI.baseURL}/login?from=${encodeURIComponent(MULTI.url.home())}`);
        await submitCredentials(page, {name: otherUser});

        // assert
        await expect.poll(() => storedState(page)).toMatchObject({owner: otherUser, updatedAt: 0});
        expect(await storedUrls(page)).toEqual(['/__scrawl-offline/state']);
    });
});

test.describe('offline access of an installed app', () => {
    test('an installed app copies with no tap', async ({page}) => {
        // arrange
        await page.addInitScript(() => {
            const original = window.matchMedia.bind(window);
            window.matchMedia = (query) => (query === '(display-mode: standalone)'
                ? {...original(query), matches: true, media: query}
                : original(query));
        });
        await signIn(page);

        // act
        await page.goto(routes.home());

        // assert
        await expect.poll(async () => (await storedState(page))?.updatedAt ?? 0, {timeout: 60_000}).toBeGreaterThan(0);
        await openSpaceMenu(page);
        await expect(page.getByTestId('space-menu-offline')).toHaveAttribute('data-on', 'true');
    });
});
