const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const {spawn} = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const {chromium} = require(require.resolve('playwright', {paths: [path.join(repoRoot, 'e2e')]}));

const NOTE = 'showcase/postgres-migration.md';
const SPACE = 'notes';
const DESKTOP = {width: 1280, height: 800, scale: 2, cropMargin: 4};
const PHONE = {width: 402, height: 874, statusBar: 62, homeIndicator: 34, scale: 3};
const HERO = {width: 2400, margin: 80, titleBar: 56, phoneToWindow: 0.7, overlap: 0.12, phoneBelow: 50};
const PHONE_FRAME = {width: 640, height: 1345};
const WEBP_QUALITY = 0.9;
const READY_TIMEOUT_MS = 60_000;
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';

function freePort() {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.once('error', reject);
        probe.listen(0, '127.0.0.1', () => {
            const {port} = probe.address();
            probe.close(() => resolve(port));
        });
    });
}

async function serve(binary, work) {
    const root = path.join(work, 'notes');
    fs.cpSync(path.join(repoRoot, 'examples', 'data'), root, {recursive: true});
    const port = await freePort();
    const child = spawn(binary, [
        'serve', `--listen=127.0.0.1:${port}`, `--space.dir=${root}`, `--space.name=${SPACE}`,
        '--history=off', '--auth.disabled', '--site-title=Notes',
    ], {stdio: ['ignore', 'ignore', 'inherit']});
    const base = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
        if (await fetch(`${base}/ping`).then((res) => res.ok, () => false)) return {base, child};
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    child.kill();
    throw new Error(`scrawl was not ready at ${base}`);
}

async function settled(page) {
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() => document.querySelector('.md-diagram[data-state="drawing"]') === null);
    const errors = await page.locator('.md-diagram-error').allTextContents();
    if (errors.length > 0) throw new Error(`a diagram failed: ${errors.join('; ')}`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);
}

function noteURL(base) {
    return `${base}/s/${SPACE}/doc/${NOTE}`;
}

async function shootDesktop(browser, base, scheme) {
    const context = await browser.newContext({
        viewport: {width: DESKTOP.width, height: DESKTOP.height},
        deviceScaleFactor: DESKTOP.scale,
        colorScheme: scheme,
    });
    const page = await context.newPage();
    await page.goto(noteURL(base));
    await settled(page);
    const height = await page.evaluate((margin) => {
        let cut = null;
        for (const block of document.querySelector('h1').parentElement.children) {
            const {top, bottom} = block.getBoundingClientRect();
            if (bottom > window.innerHeight) return Math.floor(Math.min(cut ?? top, window.innerHeight) - margin);
            cut = /^H[1-6]$/.test(block.tagName) ? (cut ?? top) : null;
        }
        return window.innerHeight;
    }, DESKTOP.cropMargin);
    const shot = await page.screenshot({clip: {x: 0, y: 0, width: DESKTOP.width, height}});
    await context.close();
    return {shot, height};
}

async function applyStandaloneRules(page) {
    await page.evaluate(() => {
        const rules = [];
        for (const sheet of document.styleSheets) {
            for (const rule of sheet.cssRules) {
                if (rule instanceof CSSMediaRule && rule.conditionText.includes('display-mode: standalone')) {
                    rules.push(...[...rule.cssRules].map((inner) => inner.cssText));
                }
            }
        }
        const style = document.createElement('style');
        style.textContent = rules.join('\n');
        document.head.append(style);
    });
}

async function shootPhone(browser, base, scheme) {
    const context = await browser.newContext({
        viewport: {width: PHONE.width, height: PHONE.height - PHONE.statusBar},
        deviceScaleFactor: PHONE.scale,
        isMobile: true,
        hasTouch: true,
        colorScheme: scheme,
        userAgent: IPHONE_UA,
    });
    await context.addInitScript(() => Object.defineProperty(navigator, 'standalone', {value: true}));
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', {insets: {bottom: PHONE.homeIndicator}});
    await page.goto(noteURL(base));
    await settled(page);
    await applyStandaloneRules(page);
    const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const shot = await page.screenshot();
    await context.close();
    return {shot, background};
}

function dataURL(png) {
    return `data:image/png;base64,${png.toString('base64')}`;
}

function layout(desktopHeight) {
    const phonePerWindow = (PHONE_FRAME.width * HERO.phoneToWindow) / PHONE_FRAME.height;
    const desktopRatio = desktopHeight / DESKTOP.width;
    const groupWidth = HERO.width - 2 * HERO.margin;
    const windowWidth = Math.round((groupWidth - phonePerWindow * HERO.titleBar) / (1 - HERO.overlap + phonePerWindow * desktopRatio));
    const windowHeight = HERO.titleBar + Math.round(desktopRatio * windowWidth);
    const phoneScale = (windowHeight * HERO.phoneToWindow) / PHONE_FRAME.height;
    const phoneHeight = PHONE_FRAME.height * phoneScale;
    const height = windowHeight + HERO.phoneBelow + 2 * HERO.margin;
    const css = [
        ':root {',
        `  --canvas-width: ${HERO.width}px;`,
        `  --canvas-height: ${height}px;`,
        `  --window-left: ${HERO.margin}px;`,
        `  --window-top: ${HERO.margin}px;`,
        `  --window-width: ${windowWidth}px;`,
        `  --title-bar: ${HERO.titleBar}px;`,
        `  --phone-left: ${Math.round(HERO.margin + windowWidth * (1 - HERO.overlap))}px;`,
        `  --phone-top: ${Math.round(HERO.margin + windowHeight + HERO.phoneBelow - phoneHeight)}px;`,
        `  --phone-scale: ${phoneScale.toFixed(4)};`,
        '}',
    ].join('\n');
    return {css, width: HERO.width, height};
}

function heroHTML(scheme, placed, desktop, phone) {
    return fs.readFileSync(path.join(__dirname, 'hero.html'), 'utf8')
        .replace('{{scheme}}', scheme)
        .replace('/* {{layout}} */', placed.css)
        .replace('{{canvas-width}}', String(placed.width))
        .replace('{{canvas-height}}', String(placed.height))
        .replace('{{desktop}}', dataURL(desktop.shot))
        .replace('{{phone}}', dataURL(phone.shot))
        .replaceAll('{{status-bg}}', phone.background);
}

async function toWebP(page, png) {
    const encoded = await page.evaluate(async ({src, quality}) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0);
        return canvas.toDataURL('image/webp', quality);
    }, {src: dataURL(png), quality: WEBP_QUALITY});
    return Buffer.from(encoded.split(',')[1], 'base64');
}

async function composeHero(browser, scheme, desktop, phone) {
    const placed = layout(desktop.height);
    const context = await browser.newContext({viewport: {width: placed.width, height: placed.height}, deviceScaleFactor: 1});
    const page = await context.newPage();
    await page.setContent(heroHTML(scheme, placed, desktop, phone));
    await page.evaluate(() => Promise.all([...document.images].map((img) => img.decode())));
    const png = await page.screenshot();
    const webp = await toWebP(page, png);
    await context.close();
    return webp;
}

async function main() {
    const [binary, outDir] = process.argv.slice(2);
    if (!binary || !outDir) throw new Error('usage: node shoot.js <scrawl binary> <out dir>');
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'scrawl-readme-shots-'));
    const {base, child} = await serve(path.resolve(binary), work);
    const browser = await chromium.launch();
    try {
        fs.mkdirSync(outDir, {recursive: true});
        for (const scheme of ['light', 'dark']) {
            const desktop = await shootDesktop(browser, base, scheme);
            const phone = await shootPhone(browser, base, scheme);
            const out = path.join(outDir, `hero-${scheme}.webp`);
            fs.writeFileSync(out, await composeHero(browser, scheme, desktop, phone));
            console.log(`${out}: ${Math.round(fs.statSync(out).size / 1024)} KB`);
        }
    } finally {
        await browser.close();
        child.kill();
        fs.rmSync(work, {recursive: true, force: true});
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
