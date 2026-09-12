// helpers shared by the specs: signing in, screenshots and fixture file access

const fs = require('fs');
const path = require('path');
const {expect} = require('@playwright/test');

const {instances, password, shotsDir, user} = require('./env');

const MAIN = instances.main;
const READONLY = instances.readonly;
const SHARED = instances.shared;
const HISTORY = instances.history;

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

async function signIn(page, {baseURL = MAIN.baseURL, from} = {}) {
    const target = from ? `${baseURL}/login?from=${encodeURIComponent(from)}` : `${baseURL}/login`;
    await page.goto(target);
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

// pressShortcut waits for the module scripts to arrive before sending the key.
// The handlers are attached by app.js, and a key pressed before it has loaded is
// simply lost, which on a busy machine is the difference between green and red.
async function pressShortcut(page, key) {
    await page.waitForLoadState('networkidle');
    await page.keyboard.press(key);
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
    READONLY,
    SHARED,
    expectNoHorizontalScroll,
    fixtureFile,
    jsonRequest,
    modifier,
    pressShortcut,
    readFixture,
    removeFixture,
    shot,
    signIn,
    submitCredentials,
    writeFixture,
};
