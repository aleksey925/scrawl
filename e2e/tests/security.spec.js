const {expect, test} = require('@playwright/test');

const fs = require('fs');

const {
    MAIN, fixtureFile, jsonRequest, removeFixture, shot, signIn, writeFixture,
} = require('../support/helpers');

const FOLDER = 'e2e-security';
const EVIL = `${FOLDER}/evil.html`;
const BIG = `${FOLDER}/huge.txt`;

// a page written into the corpus by an attacker: if /raw/ ever serves it as
// html from this origin it runs with the reader's session
const EVIL_HTML = '<html><body><script>document.title = "pwned"; ' +
    'window.name = "pwned";</script>pwned</body></html>\n';

test.describe('security', () => {
    test.beforeEach(async ({page}) => {
        await signIn(page);
    });

    test.afterAll(() => {
        fs.rmSync(fixtureFile(FOLDER), {recursive: true, force: true});
    });

    test('a document named evil.html is served as an inert download', async ({page}) => {
        writeFixture(EVIL, EVIL_HTML);

        const res = await page.request.get(`${MAIN.baseURL}/raw/${EVIL}`);
        expect(res.status()).toBe(200);
        expect(res.headers()['content-type']).toBe('application/octet-stream');
        expect(res.headers()['content-disposition']).toContain('attachment');
        expect(res.headers()['content-security-policy']).toContain('sandbox');
        expect(res.headers()['x-content-type-options']).toBe('nosniff');
    });

    test('evil.html cannot run script in the app origin', async ({page}) => {
        writeFixture(EVIL, EVIL_HTML);
        await page.goto(`/p/${FOLDER}/`);

        const executed = await page.evaluate((url) => new Promise((resolve) => {
            const frame = document.createElement('iframe');
            frame.src = url;
            const finish = () => {
                let title = null;
                try {
                    title = frame.contentDocument && frame.contentDocument.title;
                } catch (e) {
                    // an opaque origin, which is exactly what the sandbox is for
                    title = null;
                }
                frame.remove();
                resolve({title, top: document.title});
            };
            frame.addEventListener('load', finish);
            document.body.appendChild(frame);
            setTimeout(finish, 2000);
        }), `/raw/${EVIL}`);

        expect(executed.title, 'the frame must not reach the app origin').not.toBe('pwned');
        expect(executed.top, 'the top document must be untouched').not.toBe('pwned');
        await shot(page, 'security-evil-html');
    });

    test('markdown and svg come back inert too', async ({page}) => {
        const markdown = await page.request.get(`${MAIN.baseURL}/raw/db/postgresql.md`);
        expect(markdown.headers()['content-type']).toBe('text/plain; charset=utf-8');
        expect(markdown.headers()['content-disposition']).toBeUndefined();

        writeFixture(`${FOLDER}/logo.svg`,
            '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>\n');
        const svg = await page.request.get(`${MAIN.baseURL}/raw/${FOLDER}/logo.svg`);
        expect(svg.headers()['content-type']).toBe('image/svg+xml');
        expect(svg.headers()['content-disposition']).toContain('attachment');
    });

    test('an image still loads inline', async ({page}) => {
        const res = await page.request.get(`${MAIN.baseURL}/raw/regexp/regex-cheat-sheet.png`);

        expect(res.headers()['content-type']).toBe('image/png');
        expect(res.headers()['content-disposition']).toBeUndefined();
    });

    test('the file api refuses binaries and oversized text', async ({page}) => {
        await page.goto(`/p/db/postgresql.md`);

        const binary = await jsonRequest(page, 'GET', '/api/file/regexp/regex-cheat-sheet.png');
        expect(binary.status).toBe(415);
        expect(binary.body).toContain('not a text file');

        writeFixture(BIG, 'x'.repeat((2 << 20) + 1024));
        const big = await jsonRequest(page, 'GET', `/api/file/${BIG}`);
        expect(big.status).toBe(413);
        expect(big.body).toContain('too large');
        removeFixture(BIG);

        const ok = await jsonRequest(page, 'GET', '/api/file/db/postgresql.md');
        expect(ok.status).toBe(200);
    });

    test('ping is an exact route, not a suffix', async ({page}) => {
        const ping = await page.request.get(`${MAIN.baseURL}/ping`);
        expect(ping.status()).toBe(200);
        expect((await ping.text()).trim()).toBe('pong');

        const nested = await page.request.get(`${MAIN.baseURL}/p/db/ping`);
        expect(nested.status(), '/p/<anything>/ping must not answer as the healthcheck').toBe(404);
    });
});
