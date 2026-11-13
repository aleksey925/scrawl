const fs = require('fs');

const {expect, test} = require('../support/test');

const {otherUser, user} = require('../support/env');
const {
    MAIN, MULTI, fixtureFile, holdRoute, openSpaceMenu, readFixture, removeFixture, routes, save, setSource, shot,
    signIn, stays, submitCredentials, writeFixture,
} = require('../support/helpers');

const FOLDER = 'e2e-offline';
const NOTE = `${FOLDER}/everything.md`;
const PDF = `${FOLDER}/paper.pdf`;
const ARCHIVE = `${FOLDER}/archive.bin`;
const TEXT = `${FOLDER}/data.txt`;
const PICTURE = 'images/logo.png';
const ODD_NAME = 'odd $&+,:;=@ б.png';

const EVERYTHING = [
    '# Offline note',
    '',
    'only the copy has it.',
    '',
    '![logo](../images/logo.png)',
    '',
    `![odd](<./${ODD_NAME}>)`,
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

const SPACE_RECORD = '/__scrawl-offline/space/notes';

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

function storedBody(page, url) {
    return page.evaluate(async (key) => {
        const stored = await caches.match(key, {cacheName: 'scrawl-data'});
        return stored === undefined ? undefined : stored.text();
    }, url);
}

function storedReleases(page) {
    return page.evaluate(async (key) => {
        const stored = await caches.match(key, {cacheName: 'scrawl-data'});
        const record = await stored.json();
        return [...new Set(Object.values(record.entries).map((kept) => kept.release))];
    }, SPACE_RECORD);
}

function storeAsRelease(page, release) {
    return page.evaluate(async ([key, next]) => {
        const cache = await caches.open('scrawl-data');
        const record = await (await cache.match(key)).json();
        for (const kept of Object.values(record.entries)) {
            kept.release = next;
        }
        record.etag = '';
        await cache.put(key, new Response(JSON.stringify(record), {headers: {'Content-Type': 'application/json'}}));
    }, [SPACE_RECORD, release]);
}

function rawAnswers(page, urls) {
    return page.evaluate((list) => Promise.all(list.map(async (url) => {
        const answer = await fetch(url, {cache: 'no-store'});
        return {
            status: answer.status,
            type: answer.headers.get('content-type'),
            policy: answer.headers.get('content-security-policy'),
            disposition: answer.headers.get('content-disposition'),
            sniff: answer.headers.get('x-content-type-options'),
            body: Array.from(new Uint8Array(await answer.arrayBuffer())),
        };
    })), urls);
}

function rangeAnswers(page, url, ranges) {
    return page.evaluate(([address, list]) => Promise.all(list.map(async (range) => {
        const answer = await fetch(address, {headers: {Range: range}});
        return {
            status: answer.status,
            range: answer.headers.get('content-range'),
            length: answer.headers.get('content-length'),
            body: await answer.text(),
        };
    })), [url, ranges]);
}

async function pretendInstalled(page) {
    await page.addInitScript(() => {
        const original = window.matchMedia.bind(window);
        window.matchMedia = (query) => (query === '(display-mode: standalone)'
            ? {...original(query), matches: true, media: query}
            : original(query));
    });
}

test.describe('offline access', () => {
    test.beforeEach(async ({page}) => {
        writeFixture(NOTE, EVERYTHING);
        fs.copyFileSync(fixtureFile(PICTURE), fixtureFile(`${FOLDER}/${ODD_NAME}`));
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
        expect(names.filter((entry) => entry.startsWith('scrawl-app-'))).toHaveLength(1);
        expect(await storedUrls(page)).toEqual(expect.arrayContaining([
            `/s/notes/api/page/${NOTE}`, `/s/notes/raw/${PICTURE}`, `/s/notes/api/dir/${FOLDER}`, '/api/spaces',
        ]));
    });

    test('a note never opened online is read offline with its pictures and diagrams', async ({page, context}) => {
        // arrange
        await copyOn(page);

        // act
        await context.setOffline(true);
        await page.goto(routes.doc(NOTE));

        // assert
        const doc = page.getByTestId('doc');
        await expect(doc.locator('h1').first()).toContainText('Offline note');
        await expect.poll(() => doc.locator('img').evaluateAll((pictures) => pictures.map((img) => img.naturalWidth > 0)))
            .toEqual([true, true]);
        await expect(doc.locator('.katex').first()).toBeVisible();
        await expect(doc.locator('.md-diagram[data-state="done"] svg')).toHaveCount(2);
        await shot(page, 'offline-note');
    });

    test('offline the app reads, filters the tree and changes nothing', async ({page, context}) => {
        // arrange
        await copyOn(page);
        await context.setOffline(true);

        // act & assert
        await page.goto(routes.dir(FOLDER));
        await expect(page.getByTestId('dir')).toContainText('everything.md');
        await expect(page.getByTestId('offline-mark')).toBeVisible();
        await expect(page.getByTestId('dir-new')).toHaveCount(0);
        await expect(page.getByTestId('sidebar-search')).toHaveCount(0);
        await page.getByTestId('sidebar-filter').fill('replication');
        await expect(page.getByTestId('tree-row').filter({hasText: 'replication.md'})).toBeVisible();
        await page.goto(routes.doc(NOTE));
        await expect(page.getByTestId('doc-edit')).toHaveCount(0);
        await page.getByTestId('note-menu').click();
        await expect(page.getByTestId('doc-export-pdf')).toBeVisible();
        await expect(page.getByTestId('doc-export-md')).toHaveCount(0);
        await expect(page.getByTestId('doc-export-html')).toHaveCount(0);
        await page.keyboard.press('Escape');
        await openSpaceMenu(page);
        await expect(status(page)).toContainText(/No network, data from \d\d:\d\d/);
        await expect(page.getByTestId('space-menu-signout')).toHaveCount(0);
        await expect(page.getByTestId('space-menu-readonly')).toHaveCount(0);
        await shot(page, 'offline-menu');
    });

    test('offline a page that needs the server says so', async ({page, context}) => {
        // arrange
        await copyOn(page);
        await context.setOffline(true);
        const needs = page.getByTestId('app-needs-network');

        // act & assert
        await page.goto(routes.history(NOTE));
        await expect(needs).toBeVisible();
        await page.goto(routes.search('copy'));
        await expect(needs).toBeVisible();
        await page.goto(routes.edit(NOTE));
        await expect(needs).toBeVisible();
        await needs.getByRole('link').click();
        await expect(page.getByTestId('doc').locator('h1').first()).toContainText('Offline note');
    });

    test('an editor open when the network goes stays open', async ({page, context}) => {
        // arrange
        await copyOn(page);
        await page.goto(routes.edit(NOTE));
        await expect(page.getByTestId('editor-source')).toBeVisible();

        // act
        await context.setOffline(true);
        await page.evaluate(() => window.dispatchEvent(new Event('offline')));

        // assert
        await expect(page.getByTestId('offline-mark')).toBeVisible();
        await expect(page.getByTestId('editor-source')).toBeVisible();
        await expect(page.getByTestId('app-needs-network')).toHaveCount(0);
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
        writeFixture(ARCHIVE, 'not a picture');
        await copyOn(page);
        const urls = [routes.raw(PDF), routes.raw(ARCHIVE), routes.raw(PICTURE)];
        const online = await rawAnswers(page, urls);
        await context.setOffline(true);

        // act
        const fromWorker = await rawAnswers(page, urls);
        await page.goto(MAIN.url.raw(PICTURE));

        // assert
        expect(fromWorker).toEqual(online);
        expect(online).toEqual([
            expect.objectContaining({status: 200, type: 'application/pdf', disposition: null}),
            expect.objectContaining({status: 200, disposition: 'attachment; filename=archive.bin'}),
            expect.objectContaining({status: 200, type: 'image/png', disposition: null}),
        ]);
        expect(online.map((answer) => [answer.policy, answer.sniff])).toEqual(urls.map(() => ["default-src 'none'; sandbox", 'nosniff']));
        await expect(page.locator('img')).toHaveCount(1);
    });

    test('offline a range of a file is cut from the copy', async ({page, context}) => {
        // arrange
        writeFixture(PDF, PAPER);
        await copyOn(page);
        await context.setOffline(true);
        const size = PAPER.length;

        // act
        const got = await rangeAnswers(page, routes.raw(PDF), [
            'bytes=0-3', 'bytes=-4', 'bytes=4-', `bytes=2-${size + 100}`, `bytes=${size}-`,
        ]);

        // assert
        expect(got).toEqual([
            {status: 206, range: `bytes 0-3/${size}`, length: '4', body: PAPER.slice(0, 4)},
            {status: 206, range: `bytes ${size - 4}-${size - 1}/${size}`, length: '4', body: PAPER.slice(-4)},
            {status: 206, range: `bytes 4-${size - 1}/${size}`, length: String(size - 4), body: PAPER.slice(4)},
            {status: 206, range: `bytes 2-${size - 1}/${size}`, length: String(size - 2), body: PAPER.slice(2)},
            {status: 416, range: `bytes */${size}`, length: null, body: ''},
        ]);
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

    test('a stalled network in the middle of reading shows the next note from the copy', async ({page, context}) => {
        // arrange
        await copyOn(page, routes.dir(FOLDER));
        await context.route(/\/s\/notes\/api\/|\/ping$/, () => {});

        // act
        await page.getByTestId('dir').getByRole('link', {name: 'everything'}).click();

        // assert
        await expect(page.getByTestId('offline-mark')).toBeVisible({timeout: 10_000});
        await expect(page.getByTestId('doc').locator('h1').first()).toContainText('Offline note');
    });

    test('a stalled note while the copy downloads leaves the round going', async ({page, context}) => {
        // arrange
        const late = `${FOLDER}/late.txt`;
        await copyOn(page, routes.dir(FOLDER));
        writeFixture(late, 'stored after a stall\n');
        const download = await holdRoute(
            context, new RegExp(`/raw/${late}$`), (request) => request.headers()['x-scrawl-offline-copy'] === '1');
        await context.route(new RegExp(`/api/page/${NOTE}$`), async (route) => {
            if (route.request().headers()['x-scrawl-offline-copy'] === '1') {
                await route.continue();
            }
        });
        await context.route(/\/ping$/, () => {});
        const asked = copyRequests(page);
        await page.reload();
        await download.reached;

        // act
        await page.getByTestId('dir').getByRole('link', {name: 'everything'}).click();
        await expect(page.getByTestId('offline-mark')).toBeVisible({timeout: 10_000});
        download.release();

        // assert
        await expect.poll(() => storedBody(page, routes.raw(late)), {timeout: 30_000}).toBe(readFixture(late));
        expect(asked.filter((url) => url.endsWith(`/raw/${late}`))).toEqual([`/s/notes/raw/${late}`]);
        await expect(page.getByTestId('doc').locator('h1').first()).toContainText('Offline note');
    });

    test('a copy request with no answer stops the round and the next round stores the file', async ({page, context}) => {
        // arrange
        const stuck = `${FOLDER}/stuck.txt`;
        await page.clock.install();
        await copyOn(page, routes.dir(FOLDER));
        writeFixture(stuck, 'stored after a dead link\n');
        let held = false;
        await context.route(new RegExp(`/raw/${stuck}$`), async (route) => {
            if (!held && route.request().headers()['x-scrawl-offline-copy'] === '1') {
                held = true;
                return;
            }
            await route.continue();
        });
        const asked = copyRequests(page);
        await page.reload();
        await expect.poll(() => held).toBe(true);

        // act
        await page.clock.runFor(30_000);

        // assert
        await expect.poll(() => storedBody(page, routes.raw(stuck)), {timeout: 30_000}).toBe(readFixture(stuck));
        expect(asked.filter((url) => url.endsWith(`/raw/${stuck}`)))
            .toEqual([`/s/notes/raw/${stuck}`, `/s/notes/raw/${stuck}`]);
    });

    test('a slow note that is not in the copy waits for the network', async ({page, context}) => {
        // arrange
        const slow = `${FOLDER}/slow.md`;
        writeFixture(slow, '# Slow note\n');
        await context.route(new RegExp(`/api/page/${slow}$`), async (route) => {
            if (route.request().headers()['x-scrawl-offline-copy'] === '1') {
                await route.fulfill({status: 404, contentType: 'application/json', body: '{"error":"not found"}'});
                return;
            }
            await new Promise((resolve) => setTimeout(resolve, 4_000));
            await route.continue();
        });
        await copyOn(page, routes.dir(FOLDER));

        // act
        await page.getByTestId('dir').getByRole('link', {name: 'slow'}).click();

        // assert
        await expect(page.getByTestId('doc').locator('h1').first()).toContainText('Slow note', {timeout: 15_000});
        await expect(page.getByTestId('offline-mark')).toHaveCount(0);
    });

    test('offline a note left before its copy was read stays off the screen of the next one', async ({page, context}) => {
        // arrange
        const second = `${FOLDER}/second.md`;
        writeFixture(second, '# Second note\n\n[everything](everything.md)\n');
        await copyOn(page);
        await page.addInitScript((slow) => {
            window.slowReads = 0;
            const match = CacheStorage.prototype.match;
            CacheStorage.prototype.match = async function (request, options) {
                const answer = await match.call(this, request, options);
                if (String(request).endsWith(slow)) {
                    window.slowReads += 1;
                    await new Promise((resolve) => setTimeout(resolve, 1_500));
                }
                return answer;
            };
        }, `/api/page/${NOTE}`);
        await context.setOffline(true);
        await page.goto(routes.doc(second));
        const title = page.getByTestId('doc').locator('h1').first();
        await expect(title).toContainText('Second note');

        // act
        await page.getByTestId('doc').getByRole('link', {name: 'everything'}).click();
        await expect.poll(() => page.evaluate(() => window.slowReads)).toBe(1);
        await page.goBack();

        // assert
        await expect(title).toContainText('Second note');
        await stays(() => title.textContent(), 'Second note', 2_500);
    });

    test('online a changed file comes from the network, and the next round stores it', async ({page}) => {
        // arrange
        writeFixture(TEXT, 'the first version\n');
        await copyOn(page);
        const url = routes.raw(TEXT);
        const first = await page.evaluate((address) => fetch(address).then((answer) => answer.text()), url);
        writeFixture(TEXT, 'the second version, a longer one\n');

        // act & assert
        const online = await page.evaluate(
            (address) => fetch(address, {cache: 'no-store'}).then((answer) => answer.text()), url);
        expect(online).toBe(readFixture(TEXT));
        expect(await storedBody(page, url)).toBe(first);
        await page.reload();
        await expect.poll(() => storedBody(page, url), {timeout: 30_000}).toBe(readFixture(TEXT));
    });

    test('a gateway error takes the app offline, and scrawl\'s own 503 does not', async ({page, context}) => {
        // arrange
        await copyOn(page);
        const answer = new RegExp(`/api/page/${NOTE}$`);
        await context.route(answer, (route) => route.fulfill({
            status: 503,
            headers: {'content-type': 'application/json', 'app-name': 'scrawl'},
            body: '{"error":"the note took too long to render"}',
        }));

        // act & assert
        await page.goto(routes.doc(NOTE));
        await expect(page.getByTestId('doc-error')).toBeVisible();
        await expect(page.getByTestId('offline-mark')).toHaveCount(0);
        await context.unroute(answer);
        await context.route(answer, (route) => route.fulfill({
            status: 502, contentType: 'application/json', body: '{"message":"Bad gateway"}',
        }));
        await page.goto(routes.doc(NOTE));
        await expect(page.getByTestId('offline-mark')).toBeVisible();
        await expect(page.getByTestId('doc').locator('h1').first()).toContainText('Offline note');
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

        // act
        me.release();

        // assert
        await expect(page.getByTestId('offline-mark')).toHaveCount(0);
        await expect(page.getByTestId('doc-edit')).toBeVisible();
    });

    test('a note opens from the copy at once and turns writable when the account answers', async ({page, context}) => {
        // arrange
        await copyOn(page);
        const me = await holdRoute(context, /\/api\/me$/);

        // act
        await page.goto(routes.doc(NOTE));

        // assert
        await expect(page.locator('#scrawl-app-root')).toHaveAttribute('data-base', '');
        await expect(page.getByTestId('doc').locator('h1').first()).toContainText('Offline note');
        await me.reached;
        await expect(page.getByTestId('offline-mark')).toHaveCount(0);
        await expect(page.getByTestId('doc-edit')).toHaveCount(0);

        // act
        me.release();

        // assert
        await expect(page.getByTestId('doc-edit')).toBeVisible();
        await expect(page.getByTestId('offline-mark')).toHaveCount(0);
    });

    test('a space whose account the copy does not hold opens from the network', async ({page}) => {
        // arrange
        await copyOn(page);
        await page.evaluate((key) => caches.open('scrawl-data').then((cache) => cache.delete(key)), routes.api('/me'));

        // act
        await page.goto(routes.doc(NOTE));

        // assert
        await expect(page.locator('#scrawl-app-root')).toHaveAttribute('data-base', routes.prefix());
    });

    test('a page opened while a sign-in is pending comes from the network', async ({page, context}) => {
        // arrange
        await copyOn(page);
        await context.addCookies([{name: 'scrawl_signin', value: user, url: MAIN.baseURL}]);

        // act
        await page.goto(routes.doc(NOTE));

        // assert
        await expect(page.locator('#scrawl-app-root')).toHaveAttribute('data-base', routes.prefix());
    });

    test('an account that does not answer at start shows offline and is not asked again', async ({page, context}) => {
        // arrange
        await copyOn(page);
        const asked = [];
        context.on('request', (request) => {
            if (request.url().endsWith('/api/me')) {
                asked.push(request.url());
            }
        });
        const me = await holdRoute(context, /\/api\/me$/);

        // act
        await page.goto(routes.doc(NOTE));

        // assert
        await expect(page.getByTestId('offline-mark')).toBeVisible({timeout: 10_000});
        await stays(() => asked.length, 1, 2_000);

        // act
        me.release();

        // assert
        await expect(page.getByTestId('offline-mark')).toHaveCount(0);
        await expect(page.getByTestId('doc-edit')).toBeVisible();
    });

    test('an account that fails at start shows offline at once', async ({page, context}) => {
        // arrange
        await copyOn(page);
        await context.route(/\/api\/me$/, (route) => route.abort());
        const pinged = page.waitForRequest(/\/ping$/, {timeout: 10_000});

        // act
        await page.goto(routes.doc(NOTE));

        // assert
        await pinged;
        await expect(page.getByTestId('offline-mark')).toBeVisible();
    });

    test('at start a note not in the copy comes from the network', async ({page, context}) => {
        // arrange
        await copyOn(page);
        const fresh = `${FOLDER}/fresh.md`;
        writeFixture(fresh, '# Fresh note\n');
        await holdRoute(context, /\/api\/me$/);

        // act
        await page.goto(routes.doc(fresh));

        // assert
        await expect(page.getByTestId('doc').locator('h1').first()).toContainText('Fresh note');
        await expect(page.getByTestId('doc-error')).toHaveCount(0);
    });

    test('at start a folder not in the copy comes from the network', async ({page, context}) => {
        // arrange
        await copyOn(page);
        const fresh = `${FOLDER}/fresh/inside.md`;
        writeFixture(fresh, '# Inside\n');
        await holdRoute(context, /\/api\/me$/);

        // act
        await page.goto(routes.dir(`${FOLDER}/fresh`));

        // assert
        await expect(page.locator(`[data-testid=dir-row][data-path="${fresh}"]`)).toBeVisible();
        await expect(page.getByTestId('doc-error')).toHaveCount(0);
    });

    test('at start a page that needs the server waits for the account and stays when the network goes', async ({page, context}) => {
        // arrange
        await copyOn(page);
        const me = await holdRoute(context, /\/api\/me$/);

        // act
        await page.goto(routes.edit(NOTE));
        await me.reached;

        // assert
        await expect(page.getByTestId('tree-row').first()).toBeVisible();
        await expect(page.getByTestId('app-needs-network')).toHaveCount(0);
        await expect(page.getByTestId('editor-source')).toHaveCount(0);

        // act
        me.release();

        // assert
        await expect(page.getByTestId('editor-source')).toBeVisible();
        await expect(page.getByTestId('app-needs-network')).toHaveCount(0);

        // act
        await context.setOffline(true);
        await page.evaluate(() => window.dispatchEvent(new Event('offline')));

        // assert
        await expect(page.getByTestId('offline-mark')).toBeVisible();
        await expect(page.getByTestId('editor-source')).toBeVisible();
        await expect(page.getByTestId('app-needs-network')).toHaveCount(0);
    });

    test('at start a page that needs the server says so when the account does not answer, then stays once it opened', async ({page, context}) => {
        // arrange
        await copyOn(page);
        const me = await holdRoute(context, /\/api\/me$/);

        // act
        await page.goto(routes.edit(NOTE));

        // assert
        await expect(page.getByTestId('app-needs-network')).toBeVisible({timeout: 10_000});
        await expect(page.getByTestId('editor-source')).toHaveCount(0);

        // act
        me.release();

        // assert
        await expect(page.getByTestId('editor-source')).toBeVisible();

        // act
        await context.setOffline(true);
        await page.evaluate(() => window.dispatchEvent(new Event('offline')));

        // assert
        await expect(page.getByTestId('offline-mark')).toBeVisible();
        await expect(page.getByTestId('editor-source')).toBeVisible();
        await expect(page.getByTestId('app-needs-network')).toHaveCount(0);
    });

    test('a session that ended opens the copy, then the sign-in page', async ({page, context}) => {
        // arrange
        await copyOn(page);
        await context.clearCookies({name: 'scrawl_session'});
        const me = await holdRoute(context, /\/api\/me$/);

        // act
        await page.goto(routes.doc(NOTE));

        // assert
        await expect(page.getByTestId('doc').locator('h1').first()).toContainText('Offline note');

        // act
        me.release();

        // assert
        await page.waitForURL(/\/login/);
    });

    const gatewayAnswers = [
        {name: 'a redirect to another site', status: 302, headers: {location: 'https://gateway.invalid/sign-in'}},
        {name: 'a 403', status: 403, headers: {'content-type': 'text/html'}, body: '<p>Forbidden</p>'},
        {name: 'its sign-in page', status: 200, headers: {'content-type': 'text/html'}, body: '<form>Sign in</form>'},
    ];

    async function gatewayAsksToSignIn(context, answer) {
        const asked = /\/api\/me$|\/ping$/;
        const signInPage = /\/login\?/;
        await context.route(asked, (route) => route.fulfill({status: answer.status, headers: answer.headers, body: answer.body}));
        await context.route(signInPage, (route) => route.fulfill({
            status: 200, contentType: 'text/html', body: '<h1 data-testid="gateway-sign-in">Gateway sign-in</h1>',
        }));
        return async () => {
            await context.unroute(asked);
            await context.unroute(signInPage);
        };
    }

    for (const answer of gatewayAnswers) {
        test(`a gateway that answers the account with ${answer.name} at start opens its sign-in, then the note`, async ({page, context}) => {
            // arrange
            await copyOn(page);
            const signedIn = await gatewayAsksToSignIn(context, answer);

            // act
            await page.goto(routes.doc(NOTE));

            // assert
            await expect(page.getByTestId('gateway-sign-in')).toBeVisible();
            expect(new URL(page.url()).searchParams.get('from')).toBe(routes.doc(NOTE));

            // act
            await signedIn();
            await page.reload();

            // assert
            await page.waitForURL((url) => url.pathname === routes.doc(NOTE));
            await expect(page.getByTestId('doc-edit')).toBeVisible();
            await expect(page.getByTestId('offline-mark')).toHaveCount(0);
        });
    }

    test('offline, a gateway that asks to sign in opens its sign-in once the network is back', async ({page, context}) => {
        // arrange
        await copyOn(page);
        await context.setOffline(true);
        await page.goto(routes.doc(NOTE));
        await expect(page.getByTestId('offline-mark')).toBeVisible();
        await gatewayAsksToSignIn(context, gatewayAnswers[0]);

        // act
        await context.setOffline(false);
        await page.evaluate(() => window.dispatchEvent(new Event('online')));

        // assert
        await expect(page.getByTestId('gateway-sign-in')).toBeVisible();
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
        await expect.poll(() => asked.filter((url) => url.includes('/api/me')).length, {timeout: 30_000}).toBe(2);
        await expect.poll(async () => (await storedUrls(page)).includes(`/s/notes/api/page/${FOLDER}/fresh.md`)).toBe(true);

        // assert
        expect(asked.filter((url) => /\/api\/(page|dir)\/|\/raw\//.test(url)).sort()).toEqual([
            '/s/notes/api/dir/', `/s/notes/api/dir/${FOLDER}`, `/s/notes/api/page/${FOLDER}/fresh.md`,
        ]);
        expect(await storedUrls(page)).not.toContain(`/s/notes/api/page/${FOLDER}/gone.md`);

        // act
        await context.setOffline(true);
        await page.goto(routes.doc(`${FOLDER}/fresh.md`));

        // assert
        await expect(page.getByTestId('doc').locator('h1').first()).toContainText('Fresh note');
    });

    test('a note written in the app reaches the copy soon', async ({page}) => {
        // arrange
        await copyOn(page);
        await page.goto(routes.edit(NOTE));
        await setSource(page, '# Written here\n\nsaved in the app.\n');

        // act
        await save(page);

        // assert
        await expect.poll(async () => (await storedBody(page, `/s/notes/api/page/${NOTE}`)) ?? '', {timeout: 10_000})
            .toContain('Written here');
    });

    test('a round that failed somewhere asks next time only for what is missing', async ({page, context}) => {
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
        const fetched = asked.filter((url) => /\/api\/(page|dir)\/|\/raw\//.test(url));
        expect(fetched).toContain('/s/notes/api/page/db/locks.md');
        expect(fetched.filter((url) => !url.startsWith('/s/notes/api/page/db/'))).toEqual([]);
    });

    test('a file the server refuses is left out, the round still ends, and it is asked for again', async ({page, context}) => {
        // arrange
        const refused = /\/api\/page\/db\/locks\.md$/;
        await context.route(refused, (route) => route.fulfill({status: 403, body: 'refused'}));
        await page.goto(routes.home());

        // act
        await turnOn(page);

        // assert
        await expect(status(page)).toContainText('updated at', {timeout: 60_000});
        expect(await storedState(page)).toMatchObject({error: ''});
        expect(await storedUrls(page)).not.toContain('/s/notes/api/page/db/locks.md');
        expect(JSON.parse(await storedBody(page, SPACE_RECORD)).etag).toBe('');
        await context.unroute(refused);
        await page.reload();
        await expect.poll(() => storedUrls(page), {timeout: 30_000}).toContain('/s/notes/api/page/db/locks.md');
        await expect.poll(async () => JSON.parse(await storedBody(page, SPACE_RECORD)).etag).not.toBe('');
    });

    test('a copy made by another release is not read', async ({page, context}) => {
        // arrange
        await copyOn(page);
        await context.setOffline(true);
        await storeAsRelease(page, 'old');

        // act
        await page.goto(routes.doc(NOTE));

        // assert
        await expect(page.getByTestId('doc-error')).toContainText('This is not on this device');
    });

    test('a round that failed somewhere leaves no etag, so the list is asked for in full again', async ({page, context}) => {
        // arrange
        await copyOn(page);
        writeFixture(`${FOLDER}/fresh.md`, '# Fresh note\n');
        await context.route(new RegExp(`/api/dir/${FOLDER}$`), (route) => route.fulfill({status: 500, body: 'down'}));

        // act
        await page.reload();
        await expect.poll(async () => (await storedState(page)).error, {timeout: 30_000}).toBe('failed');

        // assert
        const record = JSON.parse(await storedBody(page, SPACE_RECORD));
        expect(record.etag).toBe('');
        expect(Object.keys(record.entries)).toContain(`${FOLDER}/fresh.md`);
    });

    test('an answer that is not JSON keeps the stored one and leaves no etag', async ({page, context}) => {
        // arrange
        await copyOn(page);
        const before = await storedBody(page, `/s/notes/api/page/${NOTE}`);
        writeFixture(NOTE, `${EVERYTHING}\nchanged.\n`);
        await context.route(new RegExp(`/api/page/${NOTE}$`), (route) => route.fulfill({
            status: 200, contentType: 'text/html', body: '<html>a portal</html>',
        }));

        // act
        await page.reload();
        await expect.poll(async () => (await storedState(page)).error, {timeout: 30_000}).toBe('failed');

        // assert
        expect(await storedBody(page, `/s/notes/api/page/${NOTE}`)).toBe(before);
        expect(JSON.parse(await storedBody(page, SPACE_RECORD)).etag).toBe('');
    });

    for (const code of [408, 429]) {
        test(`a ${code} keeps the stored answer and leaves no etag`, async ({page, context}) => {
            // arrange
            await copyOn(page);
            const before = await storedBody(page, `/s/notes/api/page/${NOTE}`);
            writeFixture(NOTE, `${EVERYTHING}\nchanged.\n`);
            await context.route(new RegExp(`/api/page/${NOTE}$`), (route) => route.fulfill({status: code, body: 'later'}));

            // act
            await page.reload();
            await expect.poll(async () => (await storedState(page)).error, {timeout: 30_000}).toBe('failed');

            // assert
            expect(await storedBody(page, `/s/notes/api/page/${NOTE}`)).toBe(before);
            expect(JSON.parse(await storedBody(page, SPACE_RECORD)).etag).toBe('');
        });
    }

    test('entries named like the properties of an object are copied as any other', async ({page, context}) => {
        // arrange
        const names = ['constructor', 'toString', '__proto__'];
        await context.route(/\/s\/notes\/api\/versions$/, async (route) => {
            const response = await route.fetch();
            const list = await response.json();
            list.entries.push(...names.map((name) => ({path: name, kind: 'dir', version: 'v1'})));
            await route.fulfill({response, json: list});
        });
        await context.route(/\/s\/notes\/api\/dir\/(constructor|toString|__proto__)$/, (route) => route.fulfill({json: {}}));
        await page.goto(routes.home());

        // act
        await turnOn(page);

        // assert
        await expect(status(page)).toContainText('updated at', {timeout: 60_000});
        const record = JSON.parse(await storedBody(page, SPACE_RECORD));
        expect(names.map((name) => Object.hasOwn(record.entries, name) && record.entries[name].kind))
            .toEqual(names.map(() => 'dir'));
    });

    test('a new release asks for every answer again but for no file', async ({page}) => {
        // arrange
        await copyOn(page);
        await storeAsRelease(page, 'old');
        const asked = copyRequests(page);

        // act
        await page.reload();
        await expect.poll(async () => (await storedReleases(page)).includes('old'), {timeout: 30_000}).toBe(false);

        // assert
        expect(asked).toContain(`/s/notes/api/page/${NOTE}`);
        expect(asked.filter((url) => url.includes('/raw/'))).toEqual([]);
        expect(await storedUrls(page)).toContain(`/s/notes/raw/${PICTURE}`);
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

    test('off then on in the same page downloads the app again into a cache left empty', async ({page, context}) => {
        // arrange
        await copyOn(page);
        const [appCache] = (await cacheNames(page)).filter((name) => name.startsWith('scrawl-app-'));
        await openSpaceMenu(page);
        await page.getByTestId('space-menu-offline').click();
        await expect.poll(() => cacheNames(page)).toEqual([]);
        await page.evaluate((name) => caches.open(name), appCache);
        await page.evaluate(() => fetch(document.querySelector('script[src^="/static/"]').src));

        // act
        await page.getByTestId('space-menu-offline').click();

        // assert
        await expect(status(page)).toContainText('updated at', {timeout: 60_000});
        await expect.poll(async () => (await cacheNames(page)).filter((name) => name.startsWith('scrawl-app-')))
            .toHaveLength(1);

        // act
        await context.setOffline(true);
        await page.goto(routes.doc(NOTE));

        // assert
        await expect(page.getByTestId('doc').locator('h1').first()).toContainText('Offline note');
    });

    test('on tapped while off still deletes the caches ends with the worker on', async ({page}) => {
        // arrange
        await copyOn(page);
        await page.addInitScript(() => {
            const remove = CacheStorage.prototype.delete;
            CacheStorage.prototype.delete = async function (name) {
                await new Promise((resolve) => setTimeout(resolve, 1_000));
                return remove.call(this, name);
            };
        });
        await page.reload();
        await openSpaceMenu(page);
        const row = page.getByTestId('space-menu-offline');
        await row.click();
        await expect(row).toHaveAttribute('data-on', 'false');

        // act
        await row.click();

        // assert
        await expect(row).toHaveAttribute('data-on', 'true');
        await expect(status(page)).toContainText('updated at', {timeout: 60_000});
        await expect.poll(() => workerState(page), {timeout: 60_000}).toBe('activated');
        await stays(() => workerState(page), 'activated', 1_500);
        await expect.poll(async () => (await cacheNames(page)).filter((name) => name.startsWith('scrawl-app-')))
            .toHaveLength(1);
    });

    test('a worker that fails to register at start says so', async ({page}) => {
        // arrange
        await copyOn(page);
        await page.addInitScript(() => {
            ServiceWorkerContainer.prototype.register = () => Promise.reject(new TypeError('refused'));
        });

        // act
        await page.reload();
        await openSpaceMenu(page);

        // assert
        await expect(status(page)).toContainText('Could not update', {timeout: 30_000});
    });

    test('off in another tab waits for the round and leaves nothing behind', async ({page, context}) => {
        // arrange
        const held = await holdRoute(context, /\/api\/page\/db\//);
        await page.goto(routes.home());
        await turnOn(page);
        await held.reached;
        const second = await context.newPage();
        await second.goto(routes.home());
        await openSpaceMenu(second);

        // act
        await second.getByTestId('space-menu-offline').click();

        // assert
        await expect(second.getByTestId('space-menu-offline')).toHaveAttribute('data-on', 'false');
        await expect.poll(() => cacheNames(second)).toEqual([]);
        held.release();
        await stays(() => cacheNames(second), [], 1000);
    });

    test('an app that fails to download says so and keeps no part of it', async ({page, context}) => {
        // arrange
        await context.route(/\/static\/[^/]+\/plantuml\//, (route) => route.fulfill({status: 404, body: 'gone'}));
        await page.goto(routes.home());

        // act
        await turnOn(page);

        // assert
        await expect(status(page)).toContainText('Could not update', {timeout: 60_000});
        expect((await cacheNames(page)).filter((name) => name.startsWith('scrawl-app-'))).toEqual([]);
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
        expect(names.filter((entry) => entry.startsWith('scrawl-app-'))).toHaveLength(1);
        expect(await workerState(page)).toBe('activated');
        expect(await page.evaluate(() => localStorage.getItem('scrawl.offline'))).toBe('on');
    });

    test('the same user who signs in again keeps the copy', async ({page, context}) => {
        // arrange
        await copyOn(page);
        const before = await storedState(page);
        await context.clearCookies({name: 'scrawl_session'});
        await context.route(/\/api\/me$/, () => {});

        // act
        await signIn(page);
        await expect.poll(() => page.evaluate(() => document.cookie.includes('scrawl_signin'))).toBe(false);

        // assert
        expect(await storedState(page)).toEqual({...before, owner: user});
        expect(await storedUrls(page)).toContain(`/s/notes/api/page/${NOTE}`);
    });

    test('a file opened right after another user signs in never comes from the copy', async ({page, context}) => {
        // arrange
        writeFixture(TEXT, 'the copy of the first user\n');
        await copyOn(page);
        writeFixture(TEXT, 'the file on the server now\n');
        await context.clearCookies({name: 'scrawl_session'});
        await page.goto(`${routes.login()}?from=${encodeURIComponent(routes.raw(TEXT))}`);
        await page.evaluate(() => new BroadcastChannel('scrawl-offline').postMessage({type: 'connection', online: false}));

        // act
        await submitCredentials(page, {name: otherUser});

        // assert
        await expect(page.locator('body')).toHaveText(readFixture(TEXT).trim());

        // act
        await page.goto(routes.raw(TEXT));

        // assert
        await expect(page.locator('body')).toHaveText(readFixture(TEXT).trim());
    });

    test('a round copies for the user of the session, not the one the tab knew', async ({page, context}) => {
        // arrange
        writeFixture(TEXT, 'a file\n');
        await copyOn(page);
        await context.clearCookies({name: 'scrawl_session'});
        const second = await context.newPage();
        await second.goto(`${routes.login()}?from=${encodeURIComponent(routes.raw(TEXT))}`);
        await submitCredentials(second, {name: otherUser});

        // act
        await page.evaluate(() => new BroadcastChannel('scrawl-offline').postMessage({type: 'choice'}));

        // assert
        await expect.poll(async () => (await storedState(page)).owner, {timeout: 30_000}).toBe(otherUser);
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
        const answered = second.waitForResponse((response) => response.url().endsWith('/api/me'));

        // act
        await second.goto(routes.home());
        await answered;
        await openSpaceMenu(second);

        // assert
        await expect(status(second)).toContainText(/Downloading\.\.\. \d+ of \d+/);
        expect(versions).toHaveLength(1);

        // act
        held.release();

        // assert
        await expect(status(second)).toContainText('updated at', {timeout: 60_000});
        expect(versions).toHaveLength(1);
    });
});

test.describe('offline access of every space', () => {
    test.beforeEach(async ({page}) => {
        await signIn(page, {baseURL: MULTI.baseURL, from: MULTI.url.home()});
    });

    test('every space is copied and another one opens offline', async ({page, context}) => {
        // arrange
        await copyOn(page, MULTI.url.home());
        await context.setOffline(true);
        await page.goto(MULTI.url.home());

        // act
        await openSpaceMenu(page);
        await page.getByTestId('space-menu-space-item').filter({hasText: 'Team wiki'}).click();

        // assert
        await expect(page).toHaveURL(MULTI.spaces.team.home());
        await expect(page.getByTestId('dir')).toContainText('team.md');

        // act
        await page.goto(MULTI.spaces.team.doc('team.md'));

        // assert
        await expect(page.getByTestId('doc').locator('h1').first()).toContainText('Team wiki');
    });

    test('offline the start page opens the first stored space', async ({page, context}) => {
        // arrange
        await copyOn(page, MULTI.url.home());
        const first = await page.evaluate(async () => {
            const stored = await caches.match('/api/spaces', {cacheName: 'scrawl-data'});
            return (await stored.json())[0].url;
        });
        await context.setOffline(true);

        // act
        await page.goto(`${MULTI.baseURL}/`);

        // assert
        await expect(page).toHaveURL(new URL(first, MULTI.baseURL).href);
        await expect(page.getByTestId('dir')).toBeVisible();
    });

    test('another user who signs in never sees the copy of the one before', async ({page, context}) => {
        // arrange
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

    test('another user who signs in where it is off still drops the copy of the one before', async ({page, context}) => {
        // arrange
        await copyOn(page, MULTI.url.home());
        await page.evaluate(() => localStorage.removeItem('scrawl.offline'));
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
        await pretendInstalled(page);
        await signIn(page);

        // act
        await page.goto(routes.home());

        // assert
        await expect.poll(async () => (await storedState(page))?.updatedAt ?? 0, {timeout: 60_000}).toBeGreaterThan(0);
        await openSpaceMenu(page);
        await expect(page.getByTestId('space-menu-offline')).toHaveAttribute('data-on', 'true');
    });

    test('a choice to have it off wins over the installed default', async ({page}) => {
        // arrange
        await pretendInstalled(page);
        await page.addInitScript(() => localStorage.setItem('scrawl.offline', 'off'));
        await signIn(page);

        // act
        await page.goto(routes.home());
        await page.waitForLoadState('networkidle');

        // assert
        await openSpaceMenu(page);
        await expect(page.getByTestId('space-menu-offline')).toHaveAttribute('data-on', 'false');
        expect(await workerState(page)).toBe('none');
        expect(await cacheNames(page)).toEqual([]);
    });
});
