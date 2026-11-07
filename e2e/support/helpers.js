const fs = require('fs');
const path = require('path');
const {expect} = require('@playwright/test');

const {instances, password, routes, shotsDir, slot, user} = require('./env');

const MAIN = instances.main;
const READONLY = instances.readonly;
const SHARED = instances.shared;
const HISTORY = instances.history;
const MULTI = instances.multi;
const DIALOG_TITLE = {room: 4, tall: 60};

let shotSeq = 0;

async function shot(page, name) {
    fs.mkdirSync(shotsDir, {recursive: true});
    shotSeq += 1;
    const prefix = String(shotSeq).padStart(3, '0');
    await page.screenshot({
        path: path.join(shotsDir, `w${slot}-${prefix}-${name}.png`),
        fullPage: false,
    });
}

async function signIn(page, {baseURL = MAIN.baseURL, from = routes.home()} = {}) {
    await page.goto(`${baseURL}/login?from=${encodeURIComponent(from)}`);
    await submitCredentials(page);
}

async function submitCredentials(page, {name = user, secret = password} = {}) {
    await page.fill('input[name="username"]', name);
    await page.fill('input[name="password"]', secret);
    await page.click('button[type="submit"]');
    await page.waitForLoadState('networkidle');
}

async function modifier(page) {
    const mac = await page.evaluate(
        () => /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent));
    return mac ? 'Meta' : 'Control';
}

async function pressShortcut(page, key) {
    await page.waitForLoadState('networkidle');
    await page.keyboard.press(key);
}

async function setSource(page, text) {
    const content = page.locator('[data-testid=editor-source] .cm-content');
    await content.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText(text);
}

function sourceText(page) {
    return page.locator('[data-testid=editor-source]').evaluate((root) => Array
        .from(root.querySelectorAll('.cm-line'))
        .map((line) => (line.textContent === '​' ? '' : line.textContent))
        .join('\n'));
}

function editorStatus(page) {
    return page.locator('[data-testid=editor-status]');
}

async function save(page) {
    await page.locator('[data-testid=editor-save]').click();
    await expect(editorStatus(page)).not.toHaveAttribute('data-state', 'saving');
    await expect(editorStatus(page)).toHaveAttribute('data-dirty', 'false');
}

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

const THEME_LABELS = {auto: 'Auto', light: 'Light', dark: 'Dark'};

async function showOutline(page) {
    await page.getByTestId('mini-outline').hover();
    await expect(page.getByTestId('toc')).toBeVisible();
}

async function openSpaceMenu(page) {
    await page.getByTestId('space-menu').or(page.getByTestId('site-menu')).filter({visible: true}).click();
    await expect(page.getByTestId('space-menu-dropdown')).toBeVisible();
}

async function chooseTheme(page, theme) {
    const picker = page.getByTestId('space-menu-theme');
    await picker.getByText(THEME_LABELS[theme], {exact: true}).click();
    await expect(picker).toHaveAttribute('data-theme', theme);
}

async function inStep(page, space) {
    await expect.poll(async () => page.evaluate(async (api) => {
        const json = {accept: 'application/json', 'content-type': 'application/json'};
        const me = await (await fetch(`${api}/me`, {headers: json})).json();
        if (me.space.diverged) {
            const check = await (await fetch(`${api}/sync/check`, {method: 'POST', headers: json})).json();
            await fetch(`${api}/sync/reset`, {
                method: 'POST',
                headers: json,
                body: JSON.stringify({head: check.head, remote: check.remote, push_backup: false}),
            });
        }
        return me.space.sync_error;
    }, space.api('')), {timeout: 30_000}).toBe('');
}

function rgb(hex) {
    const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
    if (hex.length === 7) {
        return `rgb(${r}, ${g}, ${b})`;
    }
    const byte = Number.parseInt(hex.slice(7, 9), 16);
    const short = Math.round((byte / 255) * 100) / 100;
    const alpha = Math.round(short * 255) === byte ? short : Math.round((byte / 255) * 1000) / 1000;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function headingAnchorGeometry(heading) {
    return heading.evaluate((el) => {
        const anchor = el.querySelector('[data-testid=doc-heading-anchor]');
        const text = [...el.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).pop();
        const range = document.createRange();
        range.setStart(text, text.length - 1);
        range.setEnd(text, text.length);
        const last = range.getBoundingClientRect();
        const style = getComputedStyle(anchor);
        const mark = getComputedStyle(anchor, '::before');
        const box = anchor.getBoundingClientRect();
        return {
            font: Number.parseFloat(getComputedStyle(el).fontSize),
            fontFamily: getComputedStyle(el).fontFamily,
            lineCount: Math.round(el.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(el).lineHeight)),
            lastRight: last.right,
            lastTop: last.top,
            lastBottom: last.bottom,
            markLeft: box.left + Number.parseFloat(style.paddingLeft),
            markTop: box.top + Number.parseFloat(style.paddingTop),
            markBottom: box.bottom - Number.parseFloat(style.paddingBottom),
            markText: mark.content,
            markFont: Number.parseFloat(mark.fontSize),
            markFontFamily: mark.fontFamily,
            markWeight: mark.fontWeight,
            markDrop: Number.parseFloat(mark.top),
            tapWidth: box.width,
            tapHeight: box.height,
        };
    });
}

async function holdRoute(page, url) {
    let release = () => {};
    const held = new Promise((resolve) => {
        release = resolve;
    });
    await page.route(url, async (route) => {
        await held;
        await route.continue();
    });
    return release;
}

function dialogButtons(page, ids) {
    return page.evaluate((testIds) => {
        const found = testIds.map((id) => document.querySelector(`[data-testid="${id}"]`));
        const body = found[0].closest('.mantine-Modal-body');
        const boxes = found.map((button) => button.getBoundingClientRect());
        return {
            heights: boxes.map((box) => Math.round(box.height)),
            widths: boxes.map((box) => Math.round(box.width)),
            lefts: boxes.map((box) => Math.round(box.left)),
            rights: boxes.map((box) => Math.round(box.right)),
            tops: boxes.map((box) => Math.round(box.top)),
            end: Math.round(boxes.at(-1).right),
            bodyEnd: Math.round(body.getBoundingClientRect().right - parseFloat(getComputedStyle(body).paddingRight)),
        };
    }, ids);
}

async function rightClickPrevented(page, target, options = {}) {
    await page.evaluate(() => {
        window.e2eMenuPrevented = undefined;
        window.addEventListener('contextmenu', (event) => {
            window.e2eMenuPrevented = event.defaultPrevented;
        }, {once: true});
    });
    await target.click({...options, button: 'right'});
    return page.evaluate(() => window.e2eMenuPrevented);
}

async function stays(read, expected, ms) {
    const until = Date.now() + ms;
    do {
        expect(await read()).toEqual(expected);
        await new Promise((resolve) => setTimeout(resolve, 50));
    } while (Date.now() < until);
    expect(await read()).toEqual(expected);
}

async function titleRoom(locator) {
    return locator.evaluate((element) => {
        const content = element.closest('.mantine-Modal-content, .mantine-Drawer-content');
        const header = content.querySelector('.mantine-Modal-header, .mantine-Drawer-header').getBoundingClientRect();
        const top = element.getBoundingClientRect().top;
        return {room: Math.round(top - header.bottom), tall: Math.round(top - header.top)};
    });
}

module.exports = {
    DIALOG_TITLE,
    HISTORY,
    MAIN,
    MULTI,
    READONLY,
    SHARED,
    atHome,
    chooseTheme,
    dialogButtons,
    editorStatus,
    expectNoHorizontalScroll,
    fixtureFile,
    headingAnchorGeometry,
    holdRoute,
    inStep,
    jsonRequest,
    modifier,
    openSpaceMenu,
    pressShortcut,
    readFixture,
    removeFixture,
    rgb,
    rightClickPrevented,
    routes,
    save,
    setSource,
    shot,
    showOutline,
    signIn,
    sourceText,
    stays,
    submitCredentials,
    titleRoom,
    user,
    writeFixture,
};
