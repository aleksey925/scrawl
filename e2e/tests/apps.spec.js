const {expect, test} = require('../support/test');

const {encodePath} = require('../support/env');
const {SHARED, openSpaceMenu, removeFixture, shot, signIn, writeFixture} = require('../support/helpers');

const ROOT = 'e2e-apps';
const COUNTER = `${ROOT}/counter`;
const COUNTER_FILE = `${COUNTER}/index.html`;
const OTHER_FILE = `${ROOT}/other/index.html`;
const OWN_WORKER = `${ROOT}/own-worker`;
const WAITING_WORKER = `${ROOT}/waiting-worker`;
const APP_HOST = /^app-[a-z2-7]{12}\.(scrawl\.)?localhost$/;
const NO_RECORD = 'Run this app once with a network to use it offline.';
const NOT_KEPT = 'This browser does not keep this app for offline use.';
const MISSING = 'This file is not on this device. Open the app once with a network.';
const APP_CACHE = 'scrawl-htmlapp';

function siteAt(base) {
    const prefix = `${base}${SHARED.routes.prefix()}`;
    return {
        base,
        prefix,
        doc: (file) => `${base}${SHARED.routes.doc(file)}`,
        run: (file) => `${prefix}/run/${encodePath(file)}`,
    };
}

const PLAIN = siteAt(SHARED.baseURL);
const SAME_SITE = siteAt(SHARED.baseURL.replace('127.0.0.1', 'scrawl.localhost'));

function counterPage(title = 'Counter') {
    return [
        '<!doctype html>',
        '<html><head><meta charset="utf-8"><link rel="stylesheet" href="/style.css"></head><body>',
        `<h1 id="title">${title}</h1>`,
        '<p>Starts: <span id="count"></span></p>',
        '<p>Note: <span id="note">waiting</span></p>',
        '<input id="field" type="text">',
        '<a id="page2" href="/page2.html">Page 2</a>',
        '<script>',
        'const starts = Number(localStorage.getItem("starts") || 0) + 1;',
        'localStorage.setItem("starts", String(starts));',
        'document.getElementById("count").textContent = String(starts);',
        'fetch("/notes.md").then((r) => { document.getElementById("note").textContent = String(r.status); },',
        '  () => { document.getElementById("note").textContent = "failed"; });',
        '</script>',
        '</body></html>',
        '',
    ].join('\n');
}

function seedCounter() {
    removeFixture(ROOT, SHARED);
    writeFixture(COUNTER_FILE, counterPage(), SHARED);
    writeFixture(`${COUNTER}/page2.html`, '<!doctype html><h1 id="title">Page two</h1>\n', SHARED);
    writeFixture(`${COUNTER}/style.css`, 'body { font-family: sans-serif; }\n', SHARED);
    writeFixture(`${COUNTER}/notes.md`, '# A note the app must not read\n', SHARED);
}

const WORKER_PAGE = [
    '<!doctype html>',
    '<h1 id="title">Own worker</h1>',
    '<script>navigator.serviceWorker.register("/sw.js", {scope: "/"});</script>',
    '',
].join('\n');

function workerScript(skipWaiting) {
    return [
        skipWaiting ? 'self.addEventListener("install", (e) => e.waitUntil(self.skipWaiting()));' : '',
        'self.addEventListener("fetch", () => {});',
        '',
    ].join('\n');
}

function appFrame(page) {
    return page.frameLocator('[data-testid=run-frame]');
}

function frameOf(page) {
    return page.frames().find((frame) => {
        try {
            return APP_HOST.test(new URL(frame.url()).hostname);
        } catch {
            return false;
        }
    });
}

async function liveFrame(page) {
    await expect.poll(() => frameOf(page) !== undefined).toBe(true);
    return frameOf(page);
}

async function openFile(page, site, file) {
    await page.goto(site.doc(file));
    await page.waitForLoadState('networkidle');
}

async function run(page, site, file, title) {
    await openFile(page, site, file);
    await page.getByTestId('file-run').click();
    await expect(page.getByTestId('run-frame')).toBeVisible();
    await expect(appFrame(page).locator('#title')).toHaveText(title);
    return liveFrame(page);
}

async function setCopy(page, on) {
    await openSpaceMenu(page);
    const row = page.getByTestId('space-menu-offline');
    await expect(row).toHaveAttribute('data-on', String(!on));
    await row.click();
    await expect(row).toHaveAttribute('data-on', String(on));
    if (on) {
        await expect(page.getByTestId('space-menu-offline-status')).toContainText('updated at', {timeout: 60_000});
    }
    await page.keyboard.press('Escape');
}

async function copyOn(page, site) {
    await signIn(page, {baseURL: site.base, from: SHARED.routes.doc(COUNTER_FILE)});
    await setCopy(page, true);
}

function kept(frame, key) {
    return frame.evaluate(async ([name, path]) => {
        if (!(await caches.has(name))) {
            return false;
        }
        return (await (await caches.open(name)).match(path)) !== undefined;
    }, [APP_CACHE, key]);
}

function hasAppCache(frame) {
    return frame.evaluate((name) => caches.has(name), APP_CACHE);
}

function keptText(frame, key) {
    return frame.evaluate(async ([name, path]) => {
        const stored = await caches.match(path, {cacheName: name});
        return stored === undefined ? undefined : stored.text();
    }, [APP_CACHE, key]);
}

function rootWorker(frame) {
    return frame.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration('/');
        const script = (worker) => (worker === null ? null : new URL(worker.scriptURL).pathname);
        return registration === undefined ? null : {
            active: script(registration.active),
            waiting: script(registration.waiting),
        };
    });
}

function frameFetch(frame, path) {
    return frame.evaluate(async (target) => {
        try {
            const res = await fetch(target);
            return {status: res.status, text: await res.text(), policy: res.headers.get('content-security-policy')};
        } catch {
            return {status: 0, text: '', policy: null};
        }
    }, path);
}

function scrawl401() {
    return {status: 401, headers: {'App-Name': 'scrawl', 'Content-Type': 'text/plain'}, body: 'expired'};
}

async function keptFolder(page, site) {
    const frame = await run(page, site, COUNTER_FILE, 'Counter');
    await expect.poll(() => kept(frame, '/page2.html'), {timeout: 20_000}).toBe(true);
    return frame;
}

test.describe('html apps', () => {
    test.describe.configure({timeout: 120_000});

    test.beforeEach(() => {
        seedCounter();
    });

    test.afterAll(() => {
        removeFixture(ROOT, SHARED);
    });

    test('runs an html file in a frame of its own origin', async ({page, context}) => {
        await signIn(page, {baseURL: PLAIN.base, from: SHARED.routes.doc(COUNTER_FILE)});
        await run(page, PLAIN, COUNTER_FILE, 'Counter');
        await expect(page).toHaveURL(PLAIN.run(COUNTER_FILE));
        await expect(page.getByTestId('run-bar')).toBeVisible();
        await expect(page.getByTestId('run-name')).toHaveText('index.html');
        const src = await page.getByTestId('run-frame').getAttribute('src');
        expect(new URL(src).hostname).toMatch(/^app-[a-z2-7]{12}\.localhost$/);
        const first = Number(await appFrame(page).locator('#count').textContent());
        await expect(appFrame(page).locator('#note')).toHaveText('404');
        await shot(page, 'apps-running');

        await page.reload();
        await expect(appFrame(page).locator('#count')).toHaveText(String(first + 1));

        await appFrame(page).locator('#page2').click();
        await expect(appFrame(page).locator('#title')).toHaveText('Page two');

        await page.getByTestId('run-back').click();
        await expect(page).toHaveURL(PLAIN.doc(COUNTER_FILE));

        await run(page, PLAIN, COUNTER_FILE, 'Counter');
        const [tab] = await Promise.all([
            context.waitForEvent('page'),
            page.getByTestId('run-open-outside').click(),
        ]);
        await tab.waitForLoadState();
        await expect.poll(() => new URL(tab.url()).hostname).toMatch(APP_HOST);
        await expect(tab.locator('#title')).toHaveText('Counter');
        await tab.close();
    });

    test('keeps the frame and its input through a lost network', async ({page, context}) => {
        await signIn(page, {baseURL: PLAIN.base, from: SHARED.routes.doc(COUNTER_FILE)});
        const frame = await run(page, PLAIN, COUNTER_FILE, 'Counter');
        await frame.evaluate(() => {
            window.scrawlMark = 'kept';
        });
        await appFrame(page).locator('#field').fill('unsaved text');

        await context.setOffline(true);
        await page.waitForTimeout(1500);
        await context.setOffline(false);
        await page.waitForTimeout(1500);

        await expect(appFrame(page).locator('#field')).toHaveValue('unsaved text');
        expect(await frame.evaluate(() => window.scrawlMark)).toBe('kept');
    });

    test('a cross-site frame is not kept offline', async ({page, context}) => {
        await copyOn(page, PLAIN);
        const frame = await run(page, PLAIN, COUNTER_FILE, 'Counter');
        await expect(appFrame(page).locator('#note')).toHaveText('404');
        expect(await rootWorker(frame)).toBeNull();

        await context.setOffline(true);
        await page.reload();
        await expect(page.getByTestId('run-needs-network')).toContainText(NOT_KEPT);
        await context.setOffline(false);
    });

    test('works offline with the copy on', async ({page, context}) => {
        writeFixture(OTHER_FILE, '<!doctype html><h1 id="title">Other</h1>\n', SHARED);
        await copyOn(page, SAME_SITE);
        await keptFolder(page, SAME_SITE);
        const before = Number(await appFrame(page).locator('#count').textContent());

        await context.setOffline(true);
        await page.reload();
        await expect(appFrame(page).locator('#title')).toHaveText('Counter');
        await expect(appFrame(page).locator('#count')).toHaveText(String(before + 1));
        await appFrame(page).locator('#page2').click();
        await expect(appFrame(page).locator('#title')).toHaveText('Page two');
        await shot(page, 'apps-offline');

        await page.getByTestId('run-back').click();
        await expect(page).toHaveURL(SAME_SITE.doc(COUNTER_FILE));
        await page.getByTestId('file-run').click();
        await expect(appFrame(page).locator('#count')).toHaveText(String(before + 2));

        await page.goto(SAME_SITE.run(OTHER_FILE));
        await expect(page.getByTestId('run-needs-network')).toContainText(NO_RECORD);

        await context.setOffline(false);
        writeFixture(COUNTER_FILE, counterPage('Counter changed'), SHARED);
        await run(page, SAME_SITE, COUNTER_FILE, 'Counter changed');
        await context.setOffline(true);
        await page.reload();
        await expect(appFrame(page).locator('#title')).toHaveText('Counter changed');

        await context.setOffline(false);
        removeFixture(`${COUNTER}/page2.html`, SHARED);
        const frame = await run(page, SAME_SITE, COUNTER_FILE, 'Counter changed');
        expect((await frameFetch(frame, '/page2.html')).status).toBe(404);
        await expect.poll(() => kept(frame, '/page2.html')).toBe(false);
        await context.setOffline(true);
        expect(await frameFetch(frame, '/page2.html?x=1')).toMatchObject({status: 504, text: MISSING});
        await context.setOffline(false);

        await openFile(page, SAME_SITE, COUNTER_FILE);
        await setCopy(page, false);
        const after = await run(page, SAME_SITE, COUNTER_FILE, 'Counter changed');
        await expect.poll(() => hasAppCache(after)).toBe(false);
        await expect.poll(() => rootWorker(after)).toBeNull();
    });

    test('keeps one copy of a file whatever its url', async ({page, context}) => {
        writeFixture(`${COUNTER}/a .html`, '<!doctype html><h1 id="title">space</h1>\n', SHARED);
        writeFixture(`${COUNTER}/a%20.html`, '<!doctype html><h1 id="title">percent</h1>\n', SHARED);
        await copyOn(page, SAME_SITE);
        const frame = await keptFolder(page, SAME_SITE);
        await expect.poll(() => kept(frame, '/a%2520.html')).toBe(true);
        await expect.poll(() => kept(frame, '/a%20.html')).toBe(true);
        expect(await keptText(frame, '/index.html')).toContain('Counter');
        expect(await kept(frame, '/')).toBe(false);

        await context.setOffline(true);
        for (const target of ['/', '/index.html', '/index.html?v=2']) {
            expect((await frameFetch(frame, target)).text, target).toContain('Counter');
        }
        expect((await frameFetch(frame, '/page2.html?x=1')).text).toContain('Page two');
        expect((await frameFetch(frame, '/a%20.html')).text).toContain('space');
        expect((await frameFetch(frame, '/a%2520.html')).text).toContain('percent');
        await context.setOffline(false);
    });

    test('a refresh cut short leaves nothing of another list', async ({page, context}) => {
        await copyOn(page, SAME_SITE);
        await keptFolder(page, SAME_SITE);
        writeFixture(`${COUNTER}/b1.txt`, 'one\n', SHARED);
        writeFixture(`${COUNTER}/b2.txt`, 'two\n', SHARED);
        await context.route(/app-.*\/b2\.txt$/, (route) => route.abort());
        let frame = await run(page, SAME_SITE, COUNTER_FILE, 'Counter');
        await expect.poll(() => kept(frame, '/b1.txt'), {timeout: 20_000}).toBe(true);
        expect(await kept(frame, '/b2.txt')).toBe(false);
        await context.unroute(/app-.*\/b2\.txt$/);

        removeFixture(`${COUNTER}/b1.txt`, SHARED);
        removeFixture(`${COUNTER}/b2.txt`, SHARED);
        frame = await run(page, SAME_SITE, COUNTER_FILE, 'Counter');
        await expect.poll(() => kept(frame, '/b1.txt'), {timeout: 20_000}).toBe(false);
    });

    test('a late 401 of scrawl purges the files', async ({page, context}) => {
        await copyOn(page, SAME_SITE);
        let frame = await keptFolder(page, SAME_SITE);
        await context.route(/\/style\.css$/, async (route) => {
            await new Promise((resolve) => setTimeout(resolve, 4000));
            await route.fulfill(scrawl401());
        });
        await frame.evaluate(() => location.reload());
        await page.waitForTimeout(3500);
        await expect(appFrame(page).locator('#title')).toHaveText('Counter');
        frame = await liveFrame(page);
        await expect.poll(() => hasAppCache(frame), {timeout: 10_000}).toBe(false);
        await context.unroute(/\/style\.css$/);
    });

    test('a purge wins over a refresh in flight', async ({page, context}) => {
        await copyOn(page, SAME_SITE);
        await keptFolder(page, SAME_SITE);
        writeFixture(`${COUNTER}/page2.html`, '<!doctype html><h1 id="title">Page two changed</h1>\n', SHARED);
        writeFixture(`${COUNTER}/style.css`, 'body { color: inherit; }\n', SHARED);
        await context.route(/\/page2\.html$/, async (route) => {
            await new Promise((resolve) => setTimeout(resolve, 2000));
            await route.continue();
        });
        await context.route(/\/style\.css$/, (route) => route.fulfill(scrawl401()));
        await openFile(page, SAME_SITE, COUNTER_FILE);
        await page.getByTestId('file-run').click();
        const frame = await liveFrame(page);
        await page.waitForTimeout(4000);
        expect(await hasAppCache(frame)).toBe(false);
        await context.unroute(/\/page2\.html$/);
        await context.unroute(/\/style\.css$/);
    });

    test('off reaches a tab the old worker still answers', async ({page, context}) => {
        await copyOn(page, SAME_SITE);
        await keptFolder(page, SAME_SITE);
        const second = await context.newPage();
        const secondFrame = await run(second, SAME_SITE, COUNTER_FILE, 'Counter');

        await openFile(page, SAME_SITE, COUNTER_FILE);
        await setCopy(page, false);
        await run(page, SAME_SITE, COUNTER_FILE, 'Counter');
        await frameFetch(secondFrame, '/page2.html');
        await page.waitForTimeout(500);
        expect(await hasAppCache(secondFrame)).toBe(false);
        await second.close();
    });

    test('off wins over refreshes in the queue', async ({page, context}) => {
        await copyOn(page, SAME_SITE);
        await keptFolder(page, SAME_SITE);
        await context.route(/\/__scrawl\/files$/, async (route) => {
            await new Promise((resolve) => setTimeout(resolve, 2000));
            await route.continue();
        });
        const second = await context.newPage();
        await openFile(page, SAME_SITE, COUNTER_FILE);
        await page.getByTestId('file-run').click();
        await openFile(second, SAME_SITE, COUNTER_FILE);
        await second.getByTestId('file-run').click();
        await expect(appFrame(second).locator('#title')).toHaveText('Counter', {timeout: 20_000});

        const third = await context.newPage();
        await openFile(third, SAME_SITE, COUNTER_FILE);
        await setCopy(third, false);
        const frame = await run(third, SAME_SITE, COUNTER_FILE, 'Counter');
        await third.waitForTimeout(5000);
        expect(await hasAppCache(frame)).toBe(false);
        await context.unroute(/\/__scrawl\/files$/);
        await second.close();
        await third.close();
    });

    test('a stored page frames in the scrawl of the last run', async ({page, context}) => {
        await copyOn(page, SAME_SITE);
        const frame = await keptFolder(page, SAME_SITE);
        await frame.evaluate(async (name) => {
            const cache = await caches.open(name);
            const stored = await cache.match('/index.html');
            const headers = new Headers(stored.headers);
            headers.set('Content-Security-Policy', 'frame-ancestors http://other.test');
            await cache.put('/index.html', new Response(await stored.blob(), {headers}));
        }, APP_CACHE);

        await context.setOffline(true);
        await page.reload();
        await expect(appFrame(page).locator('#title')).toHaveText('Counter');
        const offline = await liveFrame(page);
        expect((await frameFetch(offline, '/index.html')).policy).toBe(`frame-ancestors ${SAME_SITE.base}`);
        await context.setOffline(false);
    });

    test('leaves an app its own worker', async ({page, context}) => {
        writeFixture(`${OWN_WORKER}/index.html`, WORKER_PAGE, SHARED);
        writeFixture(`${OWN_WORKER}/sw.js`, workerScript(true), SHARED);
        writeFixture(`${WAITING_WORKER}/index.html`, WORKER_PAGE, SHARED);
        writeFixture(`${WAITING_WORKER}/sw.js`, workerScript(false), SHARED);
        await copyOn(page, SAME_SITE);

        let frame = await run(page, SAME_SITE, `${OWN_WORKER}/index.html`, 'Own worker');
        await expect.poll(async () => (await rootWorker(frame))?.active).toBe('/sw.js');
        frame = await run(page, SAME_SITE, `${OWN_WORKER}/index.html`, 'Own worker');
        await expect.poll(async () => (await rootWorker(frame))?.active).toBe('/sw.js');

        frame = await run(page, SAME_SITE, `${WAITING_WORKER}/index.html`, 'Own worker');
        await expect.poll(() => rootWorker(frame)).toEqual({active: '/__scrawl/sw.js', waiting: '/sw.js'});
        const second = await context.newPage();
        frame = await run(second, SAME_SITE, `${WAITING_WORKER}/index.html`, 'Own worker');
        await expect.poll(() => rootWorker(frame)).toEqual({active: '/__scrawl/sw.js', waiting: '/sw.js'});
        await second.close();

        await page.getByTestId('run-back').click();
        await page.waitForTimeout(500);
        await page.getByTestId('file-run').click();
        await expect(appFrame(page).locator('#title')).toHaveText('Own worker');
        frame = await liveFrame(page);
        await expect.poll(async () => (await rootWorker(frame))?.active).toBe('/sw.js');
    });
});
