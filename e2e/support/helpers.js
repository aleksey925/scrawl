// helpers shared by the specs: signing in, driving the editor, screenshots and
// fixture file access

const fs = require('fs');
const path = require('path');
const {expect} = require('@playwright/test');

const {instances, password, routes, shotsDir, user} = require('./env');

const MAIN = instances.main;
const READONLY = instances.readonly;
const SHARED = instances.shared;
const HISTORY = instances.history;
const MULTI = instances.multi;

let shotSeq = 0;

// shot writes a full page screenshot under a run-wide, ordered name so the
// files read as a story of the run when sorted
async function shot(page, name) {
    fs.mkdirSync(shotsDir, {recursive: true});
    shotSeq += 1;
    const prefix = String(shotSeq).padStart(3, '0');
    await page.screenshot({
        path: path.join(shotsDir, `${prefix}-${name}.png`),
        fullPage: false,
    });
}

// signIn goes through the server rendered login form, which is what an
// anonymous visitor of an app url is handed: the session cookie is the server's,
// and the app's own login screen is behind the same middleware.
async function signIn(page, {baseURL = MAIN.baseURL, from = routes.home()} = {}) {
    await page.goto(`${baseURL}/login?from=${encodeURIComponent(from)}`);
    await submitCredentials(page);
}

async function submitCredentials(page, {name = user, secret = password} = {}) {
    await page.fill('input[name="username"]', name);
    await page.fill('input[name="password"]', secret);
    await page.click('button[type="submit"]');
    // waitForLoadState('load') would answer for the page being left, which the
    // browser has already loaded, so wait for the network to go quiet instead
    await page.waitForLoadState('networkidle');
}

// modifier returns the key the app listens for, which follows navigator.platform
// and so differs between the desktop and the mobile emulation profiles
async function modifier(page) {
    const mac = await page.evaluate(
        () => /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent));
    return mac ? 'Meta' : 'Control';
}

// pressShortcut waits for the bundle to arrive before sending the key. The
// handlers are attached once the app has mounted, and a key pressed before that
// is simply lost, which on a busy machine is the difference between green and red.
async function pressShortcut(page, key) {
    await page.waitForLoadState('networkidle');
    await page.keyboard.press(key);
}

// the editor is codemirror, not a textarea: there is no value to set, and
// typing runs through the markdown keymap, which continues lists and indents
// blocks. insertText goes in as one input event, so what arrives is byte for
// byte what was asked for.
async function setSource(page, text) {
    const content = page.locator('[data-testid=editor-source] .cm-content');
    await content.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText(text);
}

// sourceText reads the buffer back out of the rendered lines. Codemirror only
// renders what is on screen, so this answers for the scratch documents the specs
// write and not for a long one.
function sourceText(page) {
    return page.locator('[data-testid=editor-source]').evaluate((root) => Array
        .from(root.querySelectorAll('.cm-line'))
        .map((line) => (line.textContent === '​' ? '' : line.textContent))
        .join('\n'));
}

function editorStatus(page) {
    return page.locator('[data-testid=editor-status]');
}

// save clicks Save and waits for the write to land, which is the status leaving
// the saving state rather than a fixed pause
async function save(page) {
    await page.locator('[data-testid=editor-save]').click();
    await expect(editorStatus(page)).not.toHaveAttribute('data-state', 'saving');
    await expect(editorStatus(page)).toHaveAttribute('data-dirty', 'false');
}

// atHome matches the notes home with and without its trailing slash: the server
// redirects to the slashed form, and the client router drops it again when it
// navigates there itself
function atHome(inst = MAIN) {
    const home = `${inst.baseURL}${inst.routes.prefix()}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${home}/?$`);
}

function fixtureFile(relative, inst = MAIN) {
    return path.join(inst.root, relative);
}

function readFixture(relative, inst = MAIN) {
    return fs.readFileSync(fixtureFile(relative, inst), 'utf8');
}

function writeFixture(relative, content, inst = MAIN) {
    const full = fixtureFile(relative, inst);
    fs.mkdirSync(path.dirname(full), {recursive: true});
    fs.writeFileSync(full, content, 'utf8');
    return full;
}

function removeFixture(relative, inst = MAIN) {
    fs.rmSync(fixtureFile(relative, inst), {recursive: true, force: true});
}

// jsonRequest goes through the page so the browser attaches Sec-Fetch-Site,
// which is what the cross origin protection on the write routes looks at
async function jsonRequest(page, method, url, body) {
    return page.evaluate(async ([m, u, b]) => {
        const opts = {method: m, headers: {'Accept': 'application/json'}};
        if (b !== null) {
            opts.headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(b);
        }
        const res = await fetch(u, opts);
        const text = await res.text();
        return {status: res.status, body: text};
    }, [method, url, body === undefined ? null : body]);
}

async function expectNoHorizontalScroll(page) {
    const overflow = await page.evaluate(() => {
        const el = document.scrollingElement || document.documentElement;
        return {scrollWidth: el.scrollWidth, clientWidth: el.clientWidth};
    });
    expect(overflow.scrollWidth, `page scrolls horizontally on ${page.url()}`)
        .toBeLessThanOrEqual(overflow.clientWidth + 1);
}

module.exports = {
    HISTORY,
    MAIN,
    MULTI,
    READONLY,
    SHARED,
    atHome,
    editorStatus,
    expectNoHorizontalScroll,
    fixtureFile,
    jsonRequest,
    modifier,
    pressShortcut,
    readFixture,
    removeFixture,
    routes,
    save,
    setSource,
    shot,
    signIn,
    sourceText,
    submitCredentials,
    user,
    writeFixture,
};
