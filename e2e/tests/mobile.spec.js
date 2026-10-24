const {expect, test} = require('../support/test');

const fs = require('fs');

const docs = require('../support/docs');
const {breakOrigin, restoreOrigin} = require('../support/git');
const {
    HISTORY, MAIN, MULTI, atHome, expectNoHorizontalScroll, fixtureFile, inStep, routes, save, setSource, shot,
    signIn, sourceText, stays, writeFixture,
} = require('../support/helpers');
const text = require('../support/text');

const MIN_TAP = 44;
const BUTTON_HEIGHT = 40;
const CHOICE_HEIGHT = 36;
const ROW_HEIGHT = 48;
const DOC = docs.doc.path;
const SCRATCH = 'e2e-mobile/zametka.md';
const EMPTY_FOLDER = 'e2e-mobile/pusto';
const HISTORY_FOLDER = 'e2e-mobile-history';
const HISTORY_DOC = `${HISTORY_FOLDER}/versions.md`;

async function tooSmall(page, selector, min = MIN_TAP) {
    return page.evaluate(([sel, min]) => {
        return Array.from(document.querySelectorAll(sel))
            .filter((el) => el.offsetParent !== null || el === document.activeElement)
            .map((el) => {
                const box = el.getBoundingClientRect();
                return {
                    what: `${sel} ${el.getAttribute('aria-label') || el.dataset.testid || el.className}`,
                    w: Math.round(box.width),
                    h: Math.round(box.height),
                };
            })
            .filter((item) => item.w > 0 && (item.w < min || item.h < min));
    }, [selector, min]);
}

async function openedMenu(page, testId) {
    const menu = page.getByTestId(testId);
    await expect(menu).toBeVisible();
    await expect.poll(() => menu.evaluate((el) => getComputedStyle(el).transform))
        .toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
}

async function tapSpaceMenu(page) {
    await page.goto(routes.home());
    await page.getByTestId('tab-profile').tap();
    await openedMenu(page, 'space-menu-dropdown');
}

const LONG_PRESS_HOLD = 700;

async function longPress(page, x, y) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x, y}]});
    await page.waitForTimeout(LONG_PRESS_HOLD);
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
}

async function pressedBand(page, selector) {
    const element = page.locator(selector).first();
    await expect(element).toBeVisible();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const {root} = await cdp.send('DOM.getDocument');
    const {nodeId} = await cdp.send('DOM.querySelector', {nodeId: root.nodeId, selector});
    await cdp.send('CSS.forcePseudoState', {nodeId, forcedPseudoClasses: ['active']});
    await expect.poll(() => element.evaluate((el) => getComputedStyle(el, '::before').opacity)).toBe('1');
    return element.evaluate((el) => {
        const band = getComputedStyle(el, '::before');
        const row = el.getBoundingClientRect();
        return [row.left + parseFloat(band.left), row.right - parseFloat(band.right)];
    });
}

async function asStandalone(page) {
    await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', {value: true}));
}

async function boxOf(page, testId) {
    const box = await page.getByTestId(testId).boundingBox();
    return {
        left: Math.round(box.x), top: Math.round(box.y),
        right: Math.round(box.x + box.width), bottom: Math.round(box.y + box.height),
    };
}

test.describe('mobile', () => {
    test.beforeEach(async ({page}) => {
        await signIn(page);
    });

    test.afterAll(() => {
        fs.rmSync(fixtureFile('e2e-mobile'), {recursive: true, force: true});
        fs.rmSync(fixtureFile(HISTORY_FOLDER, HISTORY), {recursive: true, force: true});
    });

    test('the tab bar sits at the bottom with Notes, Search, Recent, New and Profile', async ({page}) => {
        // act
        await page.goto(routes.doc(DOC));

        // assert
        const bar = page.getByTestId('tab-bar');
        await expect(bar.locator('button')).toHaveText(['Notes', 'Search', 'Recent', 'New', 'Profile']);
        const box = await bar.boundingBox();
        expect(Math.round(box.y + box.height)).toBe(page.viewportSize().height);
        await expect(page.getByTestId('sidebar')).toHaveCount(0);
        await expect(page.getByTestId('topbar-burger')).toHaveCount(0);
        expect(await tooSmall(page, '[data-testid=tab-bar] button')).toEqual([]);
        await shot(page, 'mobile-tab-bar');
    });

    test('Notes opens the root list, a folder opens its list, and the back link goes up', async ({page}) => {
        // arrange
        await page.goto(routes.doc(DOC));

        // act & assert
        await page.getByTestId('tab-notes').tap();
        await expect(page).toHaveURL(atHome());
        const folder = page.locator(`[data-testid=dir-row][data-path="${docs.folder.path}"]`);
        await expect(folder.getByTestId('dir-row-meta')).toHaveText(/^\d+ items?$/);
        await folder.tap();
        await expect(page).toHaveURL(MAIN.url.dir(docs.folder.path));
        await expect(page.getByTestId('dir-up')).toHaveCount(0);
        await expect(page.getByTestId('dir-new')).toHaveCount(0);
        await expect(page.locator(`[data-testid=dir-row][data-path="${docs.folder.entry}"] [data-testid=dir-row-meta]`))
            .toHaveText(/ · /);
        await shot(page, 'mobile-folder-list');

        await page.getByTestId('topbar-up').tap();
        await expect(page).toHaveURL(atHome());
    });

    test('a pressed row is one band from edge to edge of the screen', async ({page}) => {
        // arrange
        await page.goto(routes.home());

        // act
        const edges = await pressedBand(page, `[data-testid=dir-row][data-path="${docs.folder.path}"]`);

        // assert
        expect(edges).toEqual([0, page.viewportSize().width]);
    });

    test('a pressed row of Recent is one band from edge to edge of the screen too', async ({page}) => {
        // arrange
        await page.goto(routes.doc(DOC));
        await expect(page.getByTestId('doc')).toBeVisible();
        await page.getByTestId('tab-recent').tap();

        // act
        const edges = await pressedBand(page, '[data-testid=recent-item]');

        // assert
        expect(edges).toEqual([0, page.viewportSize().width]);
    });

    test('a finger resting on a row shrinks it a little', async ({page}) => {
        // arrange
        await page.goto(routes.home());
        const folder = page.locator(`[data-testid=dir-row][data-path="${docs.folder.path}"]`);
        const box = await folder.boundingBox();
        const cdp = await page.context().newCDPSession(page);

        // act
        await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchStart', touchPoints: [{x: box.x + 80, y: box.y + box.height / 2}],
        });

        // assert
        const scale = () => folder.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);
        await expect.poll(scale, {timeout: 450, intervals: [50]}).toBeLessThan(1);
        await cdp.send('Input.dispatchTouchEvent', {type: 'touchCancel', touchPoints: []});
    });

    test('a finger that only taps a row does not shrink it', async ({page}) => {
        // arrange
        await page.goto(routes.home());
        const folder = page.locator(`[data-testid=dir-row][data-path="${docs.folder.path}"]`);
        const box = await folder.boundingBox();
        const cdp = await page.context().newCDPSession(page);

        // act
        await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchStart', touchPoints: [{x: box.x + 80, y: box.y + box.height / 2}],
        });
        await page.waitForTimeout(100);

        // assert
        await expect(folder).toHaveAttribute('data-holding', 'true');
        const transforms = await folder.evaluate((el) => [el, el.querySelector('a')].map((node) => getComputedStyle(node).transform));
        expect(transforms.filter((value) => !/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/.test(value))).toEqual([]);
        await cdp.send('Input.dispatchTouchEvent', {type: 'touchCancel', touchPoints: []});
    });

    test('a screen opened slides in from the right, one gone back to from the left, a tab not at all', async ({page}) => {
        // arrange
        await page.addInitScript(() => {
            window.moves = [];
            const animate = Element.prototype.animate;
            Element.prototype.animate = function (keyframes, options) {
                if (Array.isArray(keyframes) && String(keyframes[0]?.transform).startsWith('translateX')) {
                    window.moves.push(keyframes[0].transform);
                }
                return animate.call(this, keyframes, options);
            };
        });
        await page.goto(routes.home());
        const folder = page.locator(`[data-testid=dir-row][data-path="${docs.folder.path}"]`);
        const moves = () => page.evaluate(() => window.moves);

        // act & assert
        await folder.tap();
        await expect(page).toHaveURL(MAIN.url.dir(docs.folder.path));
        await expect.poll(moves).toEqual(['translateX(28%)']);
        await page.getByTestId('topbar-up').tap();
        await expect(page).toHaveURL(atHome());
        await expect.poll(moves).toEqual(['translateX(28%)', 'translateX(-28%)']);
        await page.getByTestId('tab-recent').tap();
        await expect(page.getByTestId('tab-recent')).toHaveAttribute('data-current', 'true');
        await page.getByTestId('tab-notes').tap();
        await expect(page).toHaveURL(atHome());
        expect(await moves()).toEqual(['translateX(28%)', 'translateX(-28%)']);
        await expect.poll(() => page.locator('[data-screen]').evaluate((el) => [el.style.transform, el.style.opacity]))
            .toEqual(['', '']);
    });

    test('a back the browser takes moves nothing in a tab, and slides in from the left in an app', async ({page}) => {
        // arrange
        await page.addInitScript(() => {
            window.moves = [];
            const animate = Element.prototype.animate;
            Element.prototype.animate = function (keyframes, options) {
                if (Array.isArray(keyframes) && String(keyframes[0]?.transform).startsWith('translateX')) {
                    window.moves.push(keyframes[0].transform);
                }
                return animate.call(this, keyframes, options);
            };
        });
        const moves = () => page.evaluate(() => window.moves);
        const folder = page.locator(`[data-testid=dir-row][data-path="${docs.folder.path}"]`);
        await page.goto(routes.home());
        await folder.tap();
        await expect(page).toHaveURL(MAIN.url.dir(docs.folder.path));
        await expect.poll(moves).toEqual(['translateX(28%)']);

        // act & assert
        await page.goBack();
        await expect(folder).toBeVisible();
        await stays(moves, ['translateX(28%)'], 300);

        await asStandalone(page);
        await page.goto(routes.home());
        await folder.tap();
        await expect.poll(moves).toEqual(['translateX(28%)']);
        await page.goBack();
        await expect.poll(moves).toEqual(['translateX(28%)', 'translateX(-28%)']);
    });

    test.describe('a swipe from the left edge', () => {
        async function swipe(page, to, rest = 0) {
            const cdp = await page.context().newCDPSession(page);
            const y = 400;
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: 4, y}]});
            for (let step = 1; step <= 8; step++) {
                const x = 4 + ((to - 4) * step) / 8;
                await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x, y}]});
                await page.waitForTimeout(rest);
            }
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
        }

        const folder = () => MAIN.url.dir(docs.folder.path);

        async function inStandalone(page) {
            await asStandalone(page);
            await page.addInitScript(() => {
                window.visited = [];
                const log = () => window.visited.push(location.pathname.replace(/\/$/, ''));
                for (const name of ['pushState', 'replaceState']) {
                    const original = history[name];
                    history[name] = function (...args) {
                        const res = original.apply(this, args);
                        log();
                        return res;
                    };
                }
                window.addEventListener('popstate', log);
                document.addEventListener('touchstart', () => {
                    window.tappedMoving = (document.querySelector('[data-screen]')?.getAnimations() ?? [])
                        .some((animation) => animation.playState === 'running');
                }, {capture: true});
            });
        }

        async function swipeAndTap(page, testId) {
            const box = await page.getByTestId(testId).boundingBox();
            await swipe(page, 300);
            const cdp = await page.context().newCDPSession(page);
            const point = {x: box.x + box.width / 2, y: box.y + box.height / 2};
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [point]});
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
        }

        async function settled(page) {
            await expect.poll(() => page.evaluate(() => document.getAnimations()
                .filter((animation) => animation.playState === 'running').length)).toBe(0);
        }

        async function touchesFrom(page, [start, ...moves], end = 'touchcancel') {
            return page.evaluate(async ({start, moves, end}) => {
                const send = (type, point) => {
                    const touches = point === undefined
                        ? []
                        : [new Touch({identifier: 1, target: document.body, clientX: point[0], clientY: point[1]})];
                    const event = new TouchEvent(type, {touches, changedTouches: touches, bubbles: true, cancelable: true});
                    document.body.dispatchEvent(event);
                    return event.defaultPrevented;
                };
                send('touchstart', start);
                const taken = [];
                for (const point of moves) {
                    taken.push(send('touchmove', point));
                    await new Promise((resolve) => setTimeout(resolve, 16));
                }
                window.layer = document.querySelector('[data-screen]')?.style.willChange;
                send(end);
                return taken;
            }, {start, moves, end});
        }

        const visited = (page) => page.evaluate(() => window.visited);
        const pathOf = (url) => new URL(url, MAIN.baseURL).pathname.replace(/\/$/, '');

        test('every move of a drag from the edge is the drag\'s, and the page is a layer while it is dragged', async ({page}) => {
            // arrange
            await asStandalone(page);
            await page.goto(folder());
            await expect(page.getByTestId('dir-row').first()).toBeVisible();

            // act
            const taken = await touchesFrom(page, [[4, 400], [7, 399], [10, 398], [20, 396], [40, 395], [80, 394]]);

            // assert
            expect(taken).toEqual([true, true, true, true, true]);
            expect(await page.evaluate(() => window.layer)).toBe('transform');
            await expect.poll(() => page.locator('[data-screen]').evaluate((el) => el.style.willChange)).toBe('');
        });

        test('a drag from the edge that goes up and down is the page\'s scroll', async ({page}) => {
            // arrange
            await asStandalone(page);
            await page.goto(folder());
            await expect(page.getByTestId('dir-row').first()).toBeVisible();
            await page.evaluate(() => {
                window.moves = [];
                window.addEventListener('touchmove', (event) => window.moves.push(event.defaultPrevented));
            });
            const cdp = await page.context().newCDPSession(page);

            // act
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: 4, y: 400}]});
            for (const y of [380, 350, 300]) {
                await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: 6, y}]});
            }
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});

            // assert
            expect(await page.evaluate(() => window.moves)).toEqual([false, false, false]);
            await expect(page).toHaveURL(folder());
        });

        test('a slow drag from the edge up the page scrolls it', async ({page}) => {
            // arrange
            await asStandalone(page);
            await page.goto(routes.doc(DOC));
            await expect(page.getByTestId('doc')).toBeVisible();
            const cdp = await page.context().newCDPSession(page);

            // act
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: 4, y: 600}]});
            for (let y = 598; y >= 300; y -= 2) {
                await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: 4, y}]});
            }
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});

            // assert
            await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
            await expect(page).toHaveURL(MAIN.url.doc(DOC));
        });

        test('a drag from near the edge back toward it is let go like a scroll', async ({page}) => {
            // arrange
            await asStandalone(page);
            await page.goto(folder());
            await expect(page.getByTestId('dir-row').first()).toBeVisible();

            // act
            const taken = await touchesFrom(page, [[20, 400], [17, 400], [12, 400], [8, 400]], 'touchend');

            // assert
            expect(taken).toEqual([true, false, false]);
            await expect(page).toHaveURL(folder());
        });

        test('a fast flick sends the page off sooner than a slow drag does', async ({page}) => {
            // arrange
            await asStandalone(page);
            await page.addInitScript(() => {
                window.leaves = [];
                const animate = Element.prototype.animate;
                Element.prototype.animate = function (keyframes, options) {
                    if (Array.isArray(keyframes) && keyframes[1]?.transform === 'translateX(100%)') {
                        window.leaves.push(options.duration);
                    }
                    return animate.call(this, keyframes, options);
                };
            });
            const leaves = () => page.evaluate(() => window.leaves);
            const cdp = await page.context().newCDPSession(page);
            const y = 400;

            // act
            await page.goto(routes.doc(DOC));
            await expect(page.getByTestId('doc')).toBeVisible();
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: 4, y}]});
            for (const x of [40, 120, 200, 300]) {
                await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x, y}]});
            }
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
            await expect.poll(leaves).toHaveLength(1);
            const [fast] = await leaves();

            await page.goto(routes.doc(DOC));
            await expect(page.getByTestId('doc')).toBeVisible();
            await swipe(page, 300, 50);
            await expect.poll(leaves).toHaveLength(1);
            const [slow] = await leaves();

            // assert
            expect(fast).toBeLessThan(200);
            expect(fast).toBeGreaterThanOrEqual(120);
            expect(slow).toBe(200);
        });

        test('a finger drawn back toward the edge as it lifts keeps the page', async ({page}) => {
            // arrange
            await asStandalone(page);
            await page.goto(folder());
            await expect(page.getByTestId('dir-row').first()).toBeVisible();
            const cdp = await page.context().newCDPSession(page);
            const y = 400;

            // act
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: 4, y}]});
            for (const x of [40, 120, 200, 280]) {
                await page.waitForTimeout(20);
                await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x, y}]});
            }
            for (const x of [250, 220, 190]) {
                await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x, y}]});
            }
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});

            // assert
            await settled(page);
            await expect(page).toHaveURL(folder());
            await expect(page.locator('[data-screen]')).toHaveCSS('transform', 'none');
        });

        test('a page swiped back to a screen still on its way shows no spinner for a short wait', async ({page}) => {
            // arrange
            await asStandalone(page);
            await page.goto(routes.doc(DOC));
            await expect(page.locator('[data-screen]')).toBeVisible();
            await page.route(/\/api\/(dir|page)\//, async (route) => {
                await new Promise((resolve) => setTimeout(resolve, 1000));
                await route.continue();
            });

            // act
            await swipe(page, 300);

            // assert
            const loading = page.getByTestId('dir-loading');
            await expect(loading).toHaveCount(1);
            expect(await loading.evaluate((el) => getComputedStyle(el).opacity)).toBe('0');
            await expect.poll(() => loading.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
        });

        test('in an app from the home screen goes back, and a short one leaves the page', async ({page}) => {
            // arrange
            await asStandalone(page);
            await page.goto(folder());
            await expect(page.getByTestId('dir-row').first()).toBeVisible();

            // act & assert
            await swipe(page, 60, 40);
            await expect(page.locator('[data-screen]')).toHaveCSS('transform', 'none');
            await expect(page).toHaveURL(folder());

            await swipe(page, 300);
            await expect(page).toHaveURL(atHome());
            await expect(page.locator('[data-screen]')).toHaveCSS('transform', 'none');
        });

        test('in a tab of the browser is left to the browser', async ({page}) => {
            // arrange
            await page.goto(folder());
            await expect(page.getByTestId('dir-row').first()).toBeVisible();

            // act
            await swipe(page, 300);

            // assert
            await expect(page.locator('[data-screen]')).toHaveCSS('transform', 'none');
            await expect(page).toHaveURL(folder());
        });

        test('a tab tapped while the swiped page is leaving wins over the way back', async ({page}) => {
            // arrange
            await inStandalone(page);
            await page.goto(folder());
            await expect(page.getByTestId('dir-row').first()).toBeVisible();

            // act
            await swipeAndTap(page, 'tab-recent');

            // assert
            expect(await page.evaluate(() => window.tappedMoving)).toBe(true);
            await expect(page.getByTestId('tab-recent')).toHaveAttribute('data-current', 'true');
            await settled(page);
            await expect(page.getByTestId('tab-recent')).toHaveAttribute('data-current', 'true');
            expect(await visited(page)).not.toContain(pathOf(routes.home()));
        });

        test('a tab whose screen is still loading when the leave ends keeps its place', async ({page}) => {
            // arrange
            await inStandalone(page);
            await page.goto(routes.doc(DOC));
            await expect(page.locator('[data-screen]')).toBeVisible();
            await page.route(/\/api\/(dir|page)\//, async (route) => {
                await new Promise((resolve) => setTimeout(resolve, 1000));
                await route.continue();
            });

            // act
            await swipeAndTap(page, 'tab-notes');

            // assert
            expect(await page.evaluate(() => window.tappedMoving)).toBe(true);
            await expect(page).toHaveURL(atHome());
            await expect(page.locator(`[data-testid=dir-row][data-path="${docs.doc.folder}"]`)).toBeVisible();
            await settled(page);
            await expect(page).toHaveURL(atHome());
            expect(await visited(page)).not.toContain(pathOf(MAIN.url.dir(docs.doc.folder)));
        });

        test('with less motion asked for, a short drag puts the page back with no move', async ({page}) => {
            // arrange
            await page.emulateMedia({reducedMotion: 'reduce'});
            await asStandalone(page);
            await page.goto(folder());
            await expect(page.getByTestId('dir-row').first()).toBeVisible();

            // act
            await swipe(page, 60, 40);

            // assert
            const moving = await page.locator('[data-screen]').evaluate((el) => el.getAnimations()
                .filter((animation) => animation.playState === 'running' && animation.effect.getTiming().duration > 0)
                .length);
            expect(moving).toBe(0);
            await expect(page.locator('[data-screen]')).toHaveCSS('transform', 'none');
        });

        test('a second finger gives the drag up and puts the page back', async ({page}) => {
            // arrange
            await asStandalone(page);
            await page.goto(folder());
            await expect(page.getByTestId('dir-row').first()).toBeVisible();
            const cdp = await page.context().newCDPSession(page);
            const y = 400;
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: 4, y, id: 1}]});
            for (const x of [20, 60, 100]) {
                await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x, y, id: 1}]});
            }

            // act
            await cdp.send('Input.dispatchTouchEvent', {
                type: 'touchStart', touchPoints: [{x: 100, y, id: 1}, {x: 200, y: 500, id: 2}],
            });
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});

            // assert
            await expect(page.locator('[data-screen]')).toHaveCSS('transform', 'none');
            await expect(page).toHaveURL(folder());
        });
    });

    test.describe('a tablet', () => {
        test.use({viewport: {width: 1024, height: 768}});

        test('a touch beside a menu that never became a tap does not close the next one', async ({page}) => {
            // arrange
            await page.goto(routes.home());
            const opener = page.getByTestId('tree-row').first().getByTestId('tree-row-menu');
            const menu = page.getByTestId('tree-row-menu-dropdown');
            const cdp = await page.context().newCDPSession(page);
            await opener.tap();
            await expect(menu).toBeVisible();
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: 900, y: 700}]});
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchCancel', touchPoints: []});
            await page.evaluate(() => window.dispatchEvent(new Event('scroll')));
            await expect(menu).toHaveCount(0);
            await opener.tap();
            await expect(menu).toBeVisible();

            // act
            await page.getByTestId('tap-guard').dispatchEvent('click');

            // assert
            await stays(() => opener.getAttribute('data-opened'), 'true', 400);
            await expect(menu).toBeVisible();
        });

        test('the Search row of the sidebar shows no key on a touch screen', async ({page}) => {
            // act
            await page.goto(routes.home());

            // assert
            await expect(page.getByTestId('sidebar-search')).toBeVisible();
            await expect(page.getByTestId('sidebar-search-keys')).toHaveCount(0);
        });

        test('the guard under a tree row\'s menu is no part of the row', async ({page}) => {
            // arrange
            await page.goto(routes.home());
            const row = page.getByTestId('tree-row').first();

            // act
            await row.getByTestId('tree-row-menu').tap();

            // assert
            await expect(page.getByTestId('tree-row-menu-dropdown')).toBeVisible();
            expect(await page.getByTestId('tap-guard').evaluate((el) => el.closest('[data-testid=tree-row]'))).toBeNull();
        });
    });

    test.describe('the menu of a row in a folder', () => {
        const FOLDER = 'e2e-mobile/menu';
        const rowOf = (page, path) => page.locator(`[data-testid=dir-row][data-path="${path}"]`);

        test('a long press lifts the row, opens its menu from it, and Delete takes the file away', async ({page}) => {
            // arrange
            const file = `${FOLDER}/drop-me.md`;
            writeFixture(file, '# Drop me\n');
            await page.goto(MAIN.url.dir(FOLDER));
            const box = await rowOf(page, file).boundingBox();

            // act
            await longPress(page, box.x + 80, box.y + box.height / 2);

            // assert
            await expect(page.getByTestId('tree-row-menu-dropdown')).toBeVisible();
            await expect(page.getByTestId('row-lift')).toContainText('drop-me.md');
            await expect(rowOf(page, file)).toHaveAttribute('data-lifted', 'true');
            await expect(page).toHaveURL(MAIN.url.dir(FOLDER));
            await shot(page, 'mobile-row-menu');
            await page.getByTestId('tree-row-menu-delete').tap();
            await expect(page.getByTestId('row-lift')).toHaveCount(0);
            await page.getByTestId('modal-confirm').tap();
            await expect(rowOf(page, file)).toHaveCount(0);
            expect(fs.existsSync(fixtureFile(file))).toBe(false);
        });

        test('the menu of a lifted row hangs at the row\'s right edge wherever the finger rests', async ({page}) => {
            // arrange
            const file = `${FOLDER}/hang-right.md`;
            writeFixture(file, '# Hang right\n');
            await page.goto(MAIN.url.dir(FOLDER));
            const width = page.viewportSize().width;
            const row = await rowOf(page, file).boundingBox();
            const button = await rowOf(page, file).getByTestId('tree-row-menu').boundingBox();
            const rightAfterLift = async (x) => {
                await longPress(page, x, row.y + row.height / 2);
                await openedMenu(page, 'tree-row-menu-dropdown');
                const menu = await page.getByTestId('tree-row-menu-dropdown').boundingBox();
                await page.touchscreen.tap(width / 2, 60);
                await expect(page.getByTestId('row-lift')).toHaveCount(0);
                return Math.round(menu.x + menu.width);
            };

            // act
            const fromLeft = await rightAfterLift(40);
            const fromRight = await rightAfterLift(button.x - 16);

            // assert
            expect([fromLeft, fromRight]).toEqual([Math.round(row.x + row.width), Math.round(row.x + row.width)]);
        });

        test('a tap beside a lifted row sets it back down and opens nothing', async ({page}) => {
            // arrange
            const file = `${FOLDER}/lift-me.md`;
            writeFixture(file, '# Lift me\n');
            await page.goto(MAIN.url.dir(FOLDER));
            const box = await rowOf(page, file).boundingBox();
            await longPress(page, box.x + 80, box.y + box.height / 2);
            await expect(page.getByTestId('row-lift')).toBeVisible();

            // act
            await page.touchscreen.tap(30, 120);

            // assert
            await expect(page.getByTestId('row-lift')).toHaveCount(0);
            await expect(rowOf(page, file)).toHaveAttribute('data-lifted', 'false');
            await expect(page).toHaveURL(MAIN.url.dir(FOLDER));
        });

        test('offers Edit for a note and not for a picture the editor cannot open', async ({page}) => {
            // arrange
            const note = `${FOLDER}/editable.md`;
            const picture = `${FOLDER}/picture.png`;
            writeFixture(note, '# Editable\n');
            writeFixture(picture, 'not really a png');
            await page.goto(MAIN.url.dir(FOLDER));

            // act & assert
            await rowOf(page, note).getByTestId('tree-row-menu').tap();
            await openedMenu(page, 'tree-row-menu-dropdown');
            await expect(page.getByTestId('tree-row-menu-edit')).toBeVisible();
            await page.touchscreen.tap(30, 120);
            await expect(page.getByTestId('tree-row-menu-dropdown')).toHaveCount(0);

            await rowOf(page, picture).getByTestId('tree-row-menu').tap();
            await openedMenu(page, 'tree-row-menu-dropdown');
            await expect(page.getByTestId('tree-row-menu-rename')).toBeVisible();
            await expect(page.getByTestId('tree-row-menu-edit')).toHaveCount(0);
        });

        test('a tap on a row below an open menu only closes the menu', async ({page}) => {
            // arrange
            const files = ['first', 'second', 'third', 'fourth'].map((name) => `${FOLDER}/below-${name}.md`);
            for (const path of files) {
                writeFixture(path, '# Below\n');
            }
            await page.goto(MAIN.url.dir(FOLDER));
            await rowOf(page, files[0]).getByTestId('tree-row-menu').tap();
            await openedMenu(page, 'tree-row-menu-dropdown');
            const box = await rowOf(page, files[3]).boundingBox();

            // act
            await page.touchscreen.tap(box.x + 20, box.y + box.height / 2);

            // assert
            await expect(page.getByTestId('tree-row-menu-dropdown')).toHaveCount(0);
            await expect(page).toHaveURL(MAIN.url.dir(FOLDER));
        });

        test('a finger resting beside an open menu leaves the row of the menu as it is', async ({page}) => {
            // arrange
            const file = `${FOLDER}/rest-beside.md`;
            writeFixture(file, '# Rest beside\n');
            await page.goto(MAIN.url.dir(FOLDER));
            const row = rowOf(page, file);
            await row.getByTestId('tree-row-menu').tap();
            await openedMenu(page, 'tree-row-menu-dropdown');
            const box = await row.boundingBox();
            const cdp = await page.context().newCDPSession(page);

            // act
            await cdp.send('Input.dispatchTouchEvent', {
                type: 'touchStart', touchPoints: [{x: box.x + 20, y: box.y + box.height / 2}],
            });
            await page.waitForTimeout(LONG_PRESS_HOLD);

            // assert
            await expect(row).toHaveAttribute('data-holding', 'false');
            await expect(row).toHaveAttribute('data-lifted', 'false');
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchCancel', touchPoints: []});
        });

        test('opens from the row\'s own button, which leaves the row as it is', async ({page}) => {
            // arrange
            const file = `${FOLDER}/keep-me.md`;
            writeFixture(file, '# Keep me\n');
            await page.goto(MAIN.url.dir(FOLDER));

            // act
            await rowOf(page, file).getByTestId('tree-row-menu').tap();

            // assert
            await expect(page.getByTestId('tree-row-menu-dropdown')).toBeVisible();
            await expect(page.getByTestId('tree-row-menu-rename')).toBeVisible();
            await expect(page.getByTestId('row-lift')).toHaveCount(0);
            expect(await rowOf(page, file).evaluate((el) => getComputedStyle(el, '::before').opacity)).toBe('0');
        });
    });

    test('a long press on the chrome selects nothing, and the text of a note still selects', async ({page}) => {
        // act
        await page.goto(routes.doc(DOC));

        // assert
        await expect(page.getByTestId('tab-bar')).toHaveCSS('user-select', 'none');
        await expect(page.getByTestId('topbar')).toHaveCSS('user-select', 'none');
        await expect(page.getByTestId('doc')).toHaveCSS('user-select', 'text');
    });

    test('Recent lists a note opened, keeps it after a reload, and its menu clears it', async ({page}) => {
        // arrange
        await page.goto(routes.doc(DOC));
        await expect(page.getByTestId('doc')).toBeVisible();

        // act
        await page.getByTestId('tab-recent').tap();

        // assert
        await expect(page.getByTestId('tab-recent')).toHaveAttribute('data-current', 'true');
        await expect(page.getByTestId('recent-item').first()).toHaveAttribute('data-path', DOC);
        await page.reload();
        await expect(page.getByTestId('recent-item').first()).toHaveAttribute('data-path', DOC);
        await shot(page, 'mobile-recent');

        await page.getByTestId('recent-menu').tap();
        await page.getByTestId('recent-menu-clear').tap();
        await expect(page.getByTestId('recent-item')).toHaveCount(0);
        await expect(page.getByTestId('recent-empty-title')).toHaveText('Nothing opened yet');
    });

    test('New makes a note in the folder on screen and opens the editor', async ({page}) => {
        // arrange
        fs.mkdirSync(fixtureFile(EMPTY_FOLDER), {recursive: true});
        await page.goto(routes.dir(EMPTY_FOLDER));
        await expect(page.getByTestId('dir-empty')).toBeVisible();

        // act
        await page.getByTestId('tab-new').tap();
        await expect(page.getByTestId('new-menu-note')).toHaveText('New file');
        await page.getByTestId('new-menu-note').tap();
        await expect(page.getByTestId('new-entry-name')).toBeFocused();
        await expect(page.locator('.mantine-Modal-title')).toHaveText('New file');
        await expect(page.getByTestId('new-entry-hint')).toHaveText('Without an extension it is a note');
        await page.getByTestId('new-entry-name').fill('made on a phone');
        await shot(page, 'mobile-new-entry');
        await page.getByTestId('new-entry-create').tap();

        // assert
        await expect(page).toHaveURL(MAIN.url.edit(`${EMPTY_FOLDER}/made-on-a-phone.md`));
        expect(fs.existsSync(fixtureFile(`${EMPTY_FOLDER}/made-on-a-phone.md`))).toBe(true);
    });

    test('the note menu opens under its button, on the screen', async ({page}) => {
        // arrange
        await page.goto(routes.doc(DOC));

        // act
        await page.getByTestId('note-menu').tap();

        // assert
        await openedMenu(page, 'note-menu-dropdown');
        const button = await boxOf(page, 'note-menu');
        const menu = await boxOf(page, 'note-menu-dropdown');
        expect(menu.top).toBeGreaterThanOrEqual(button.bottom);
        expect(menu.top - button.bottom).toBeLessThan(16);
        expect([menu.left >= 0, menu.right <= page.viewportSize().width]).toEqual([true, true]);
        await expect(page.getByTestId('note-menu-find')).toBeVisible();
        await expect(page.getByTestId('note-menu-outline')).toBeVisible();
        await shot(page, 'mobile-note-menu-open');
    });

    test('the Profile tab opens the space menu over it', async ({page}) => {
        // act
        await tapSpaceMenu(page);

        // assert
        const tab = await boxOf(page, 'tab-profile');
        const menu = await boxOf(page, 'space-menu-dropdown');
        expect(menu.bottom).toBeLessThanOrEqual(tab.top);
        expect(menu.right).toBeGreaterThan(page.viewportSize().width / 2);
        await expect(page.getByTestId('space-menu-shortcuts')).toHaveCount(0);
    });

    test('a tap beside an open menu closes it and opens nothing', async ({page}) => {
        // arrange
        await page.goto(routes.dir(docs.folder.path));
        const row = page.locator(`[data-testid=dir-row][data-path="${docs.folder.entry}"]`);
        await expect(row).toBeVisible();
        await page.getByTestId('folder-menu').tap();
        await openedMenu(page, 'folder-menu-dropdown');
        const box = await row.boundingBox();

        // act
        await page.touchscreen.tap(box.x + 20, box.y + box.height / 2);

        // assert
        await expect(page.getByTestId('folder-menu-dropdown')).toHaveCount(0);
        await expect(page).toHaveURL(MAIN.url.dir(docs.folder.path));
    });

    test('the Edit button opens the editor', async ({page}) => {
        // arrange
        await page.goto(routes.doc(DOC));
        await expect(page.getByTestId('doc-edit')).toHaveCount(0);

        // act
        await page.getByTestId('edit-button').tap();

        // assert
        await expect(page).toHaveURL(MAIN.url.edit(DOC));
        await expect(page.getByTestId('tab-bar')).toHaveCount(0);
    });

    test('the tab bar and the Edit button stay where they are while the page scrolls', async ({page}) => {
        // arrange
        await page.goto(routes.doc(docs.long.path));
        await expect(page.getByTestId('doc')).toBeVisible();
        const places = async () => [
            Math.round((await page.getByTestId('tab-bar').boundingBox()).y),
            Math.round((await page.getByTestId('edit-button').boundingBox()).y),
        ];
        const before = await places();

        // act
        await page.mouse.wheel(0, 600);
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

        // assert
        expect(await places()).toEqual(before);
    });

    test('the reader ends a scroll with the rubber band of an app, and the editor without', async ({page}) => {
        // arrange
        const overscroll = () => page.evaluate(() => getComputedStyle(document.documentElement).overscrollBehaviorY);

        // act & assert
        await page.goto(routes.doc(DOC));
        await expect(page.getByTestId('doc')).toBeVisible();
        expect(await overscroll()).toBe('auto');
        await page.goto(routes.edit(DOC));
        await expect(page.getByTestId('editor')).toBeVisible();
        expect(await overscroll()).toBe('none');
    });

    test('a folder list that fits the screen does not scroll', async ({page}) => {
        // arrange
        const folder = 'e2e-mobile/short';
        const names = ['one', 'two', 'three', 'four', 'five', 'six', 'seven'];
        for (const stem of names) {
            writeFixture(`${folder}/${stem}.md`, `# ${stem}\n`);
        }

        // act
        await page.goto(MAIN.url.dir(folder));
        await expect(page.getByTestId('dir-row')).toHaveCount(names.length);

        // assert
        const room = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
        expect(room).toBeLessThanOrEqual(0);
    });

    test('the search takes the whole screen, its field at the bottom, and Cancel puts it away', async ({page}) => {
        // arrange
        await page.goto(routes.doc(DOC));

        // act
        await page.getByTestId('tab-search').tap();

        // assert
        await expect(page.getByTestId('search-input')).toBeVisible();
        const dialog = await boxOf(page, 'search-dialog');
        expect([dialog.top, dialog.bottom]).toEqual([0, page.viewportSize().height]);
        const field = await boxOf(page, 'search-input');
        expect(field.top).toBeGreaterThan(page.viewportSize().height * 0.75);
        await expect(page.getByTestId('search-footer')).not.toContainText('Select');
        const mode = await boxOf(page, 'search-mode');
        const titles = await boxOf(page, 'search-titles');
        expect([mode.bottom - mode.top, titles.bottom - titles.top]).toEqual([CHOICE_HEIGHT, CHOICE_HEIGHT]);
        await shot(page, 'mobile-search-open');

        await page.getByTestId('search-close').tap();
        await expect(page.getByTestId('search-dialog')).toHaveCount(0);
        await expect(page).toHaveURL(MAIN.url.doc(DOC));
    });

    test('the bar shows the title of a note once its own has scrolled away', async ({page}) => {
        // arrange
        await page.goto(routes.doc(docs.long.path));
        const title = page.getByTestId('topbar-title');
        await expect(title).toHaveText(docs.long.title);
        await expect(title).toHaveAttribute('data-shown', 'false');

        // act
        await page.mouse.wheel(0, 400);

        // assert
        await expect(title).toHaveAttribute('data-shown', 'true');
        await expect(page.getByTestId('topbar')).toHaveAttribute('data-scrolled', 'true');
    });

    test('the editor is usable and the preview tab switches', async ({page}) => {
        writeFixture(SCRATCH, '# Заметка\n\nтекст\n');
        await page.goto(routes.edit(SCRATCH));
        await expect.poll(() => sourceText(page)).toBe('# Заметка\n\nтекст\n');

        const source = page.getByTestId('editor-source');
        await expect(source).toBeVisible();
        const box = await source.boundingBox();
        expect(box.height).toBeGreaterThan(200);

        const fontSize = await source.locator('.cm-content').evaluate(
            (el) => parseFloat(getComputedStyle(el).fontSize));
        expect(fontSize, 'iOS zooms into any field under 16px').toBeGreaterThanOrEqual(16);
        await expect(page.getByTestId('editor-panes')).toHaveAttribute('data-mode', 'source');
        await expect(page.getByTestId('editor-layout-mode')).toHaveCount(0);
        await shot(page, 'mobile-editor');

        await setSource(page, '# Заметка\n\nновый текст\n');
        await page.getByTestId('editor-tab-preview').tap();
        await expect(page.getByTestId('editor-preview')).toContainText('новый текст');
        await expect(page.getByTestId('editor-panes')).toHaveAttribute('data-mode', 'preview');
        await expect(page.getByTestId('editor-source')).toHaveCount(0);
        await shot(page, 'mobile-editor-preview');

        await page.getByTestId('editor-tab-source').tap();
        await expect(page.getByTestId('editor-source')).toBeVisible();

        await page.getByTestId('editor-save').tap();
        await expect(page.locator('[data-testid=toast][data-kind="ok"]')).toContainText(text.toast.saved);
        await expectNoHorizontalScroll(page);
    });

    test('a text file opens in the editor with no Text and Preview tabs', async ({page}) => {
        // arrange
        const filePath = 'e2e-mobile/plain.txt';
        writeFixture(filePath, 'just text\n');

        // act
        await page.goto(routes.edit(filePath));

        // assert
        await expect(page.getByTestId('editor')).toHaveAttribute('data-kind', 'text');
        await expect(page.getByTestId('editor-source')).toContainText('just text');
        await expect(page.getByTestId('editor-tabs')).toHaveCount(0);
        await expect(page.getByTestId('editor-language')).toHaveText('Plain text');
        await shot(page, 'mobile-plain-text-editor');
    });

    test('the editor pane takes the width of the screen', async ({page}) => {
        writeFixture(SCRATCH, '# Заметка\n\nтекст\n');
        await page.goto(routes.edit(SCRATCH));

        const box = await page.getByTestId('editor-source').boundingBox();
        expect(box.width).toBeLessThanOrEqual(390);
        expect(box.width).toBeGreaterThan(300);
    });

    test('the editor opens with the heading at the top where it was, and comes back to it', async ({page}) => {
        // arrange
        const filler = (mark) => Array.from({length: 12}, (_, index) =>
            `Абзац ${mark}-${index}: длинная строка, которая в редакторе на телефоне переносится `
            + 'на несколько рядов, а на странице занимает меньше места.').join('\n\n');
        writeFixture(SCRATCH, `# Начало\n\n${filler('a')}\n\n## Середина\n\n${filler('b')}\n`);
        await page.goto(routes.doc(SCRATCH));
        const heading = page.locator('[data-testid=doc] h2');
        const onPage = () => heading.evaluate((el) =>
            Math.round(el.getBoundingClientRect().top - document.querySelector('header').getBoundingClientRect().bottom));
        await heading.evaluate((el) => window.scrollTo({
            top: el.getBoundingClientRect().top + window.scrollY
                - document.querySelector('header').getBoundingClientRect().bottom - 8,
            behavior: 'instant',
        }));
        const before = await onPage();

        // act
        await page.getByTestId('edit-button').dispatchEvent('click');
        const inEditor = () => page.locator('.cm-line', {hasText: '## Середина'}).evaluate((line) =>
            Math.round(line.getBoundingClientRect().top - line.closest('.cm-scroller').getBoundingClientRect().top));

        // assert
        await expect.poll(inEditor).toBeGreaterThanOrEqual(0);
        await expect.poll(inEditor).toBeLessThanOrEqual(before + 4);

        // act
        await page.getByTestId('editor-cancel').tap();

        // assert
        await expect.poll(onPage).toBeGreaterThanOrEqual(before - 2);
        await expect.poll(onPage).toBeLessThanOrEqual(before + 2);
    });

    test('a line inside a code block survives the trip to the editor and back', async ({page}) => {
        // arrange
        const code = Array.from({length: 150}, (_, index) => `line_${index} = ${index}`).join('\n');
        writeFixture(SCRATCH, `# Код\n\nВступление.\n\n\`\`\`python\n${code}\n\`\`\`\n\nКонец.\n`);
        await page.goto(routes.doc(SCRATCH));
        const row = page.locator('[data-testid=doc] pre .line', {hasText: 'line_60 ='});
        const onPage = () => row.evaluate((el) =>
            Math.round(el.getBoundingClientRect().top - document.querySelector('header').getBoundingClientRect().bottom));
        await row.evaluate((el) => window.scrollTo({
            top: el.getBoundingClientRect().top + window.scrollY
                - document.querySelector('header').getBoundingClientRect().bottom - 30,
            behavior: 'instant',
        }));
        const before = await onPage();
        const editorLine = page.locator('.cm-line', {hasText: 'line_60 ='});
        const inEditor = () => editorLine.evaluate((line) =>
            Math.round(line.getBoundingClientRect().top - line.closest('.cm-scroller').getBoundingClientRect().top));

        for (let round = 0; round < 2; round++) {
            // act
            await page.getByTestId('edit-button').dispatchEvent('click');

            // assert
            const lineHeight = await editorLine.evaluate((line) => line.getBoundingClientRect().height);
            await expect.poll(inEditor).toBeGreaterThanOrEqual(0);
            await expect.poll(inEditor).toBeLessThanOrEqual(before + lineHeight);

            // act
            await page.getByTestId('editor-cancel').tap();

            // assert
            await expect.poll(onPage).toBeGreaterThanOrEqual(before - 2);
            await expect.poll(onPage).toBeLessThanOrEqual(before + 2);
        }
    });

    test('no page scrolls horizontally', async ({page}) => {
        writeFixture(SCRATCH, '# Заметка\n\nтекст\n');
        const pages = [
            routes.home(),
            routes.doc(DOC),
            routes.doc(docs.deep.path),
            routes.dir(docs.folder.path),
            routes.search(docs.search.word),
            routes.doc('nothing-here.md'),
            routes.edit(SCRATCH),
            routes.recent(),
        ];
        for (const route of pages) {
            await page.goto(route);
            await page.waitForLoadState('networkidle');
            await expectNoHorizontalScroll(page);
        }
        await shot(page, 'mobile-no-h-scroll');
    });

    test('the controls inside a document are big enough to tap', async ({page}) => {
        await page.goto(routes.doc(DOC));
        await page.waitForLoadState('networkidle');
        await page.getByTestId('doc-code').first().scrollIntoViewIfNeeded();
        await shot(page, 'mobile-doc-controls');

        const offenders = (await tooSmall(page, '[data-testid=code-copy]')).slice(0, 3);
        expect(offenders, 'controls smaller than the touch minimum').toEqual([]);
    });

    test('the copy button sits above the code and never over it', async ({page}) => {
        // arrange
        const longLine = 'curl -fsSL https://example.com/install.sh | sh -s -- --prefix /usr/local --yes';
        writeFixture(SCRATCH, `# Заметка\n\n\`\`\`sh\n${longLine}\n${longLine}\n\`\`\`\n`);

        // act
        await page.goto(routes.doc(SCRATCH));
        const block = page.getByTestId('doc-code');

        // assert
        const copy = await block.getByTestId('code-copy').boundingBox();
        const code = await block.locator('pre').boundingBox();
        expect(copy.y + copy.height).toBeLessThanOrEqual(code.y + 1);
        await shot(page, 'mobile-code-copy');
    });

    test('a heading carries no link icon on a phone', async ({page}) => {
        await page.goto(routes.doc(DOC));
        await expect(page.getByTestId('doc').locator('h1').first()).toBeVisible();

        await expect(page.getByTestId('doc-heading-anchor').first()).toBeHidden();
    });

    test('the preview in the editor fits the screen', async ({page}) => {
        // arrange
        await page.goto(routes.edit(DOC));
        await expect(page.getByTestId('editor-tabs')).toBeVisible();

        // act
        await page.getByTestId('editor-tab-preview').tap();

        // assert
        const doc = page.getByTestId('editor-preview').getByTestId('doc');
        await expect(doc).toBeVisible();
        const box = await doc.boundingBox();
        expect(Math.round(box.x + box.width)).toBeLessThanOrEqual(page.viewportSize().width - 16);
        expect(await doc.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    });

    test('the editor tabs are big enough to tap', async ({page}) => {
        writeFixture(SCRATCH, '# Заметка\n\nтекст\n');
        await page.goto(routes.edit(SCRATCH));
        await expect(page.getByTestId('editor-tabs')).toBeVisible();

        expect(await tooSmall(page, '[data-testid=editor-tab-source], [data-testid=editor-tab-preview]'))
            .toEqual([]);
        expect(await tooSmall(page, '[data-testid=editor-toolbar] button')).toEqual([]);
    });

    test('the top bar controls are big enough to tap', async ({page}) => {
        await page.goto(routes.doc(DOC));

        const offenders = await tooSmall(page, '[data-testid=topbar] button, [data-testid=topbar] a');
        await shot(page, 'mobile-tap-targets');
        expect(offenders, 'elements smaller than the touch minimum').toEqual([]);
    });

    test('the top bar goes back to the folder and holds one row', async ({page}) => {
        // arrange
        await page.goto(routes.doc(docs.deep.path));
        await expect(page.getByTestId('doc')).toBeVisible();

        // act & assert
        const parent = docs.deep.path.split('/').slice(-2, -1)[0];
        await expect(page.getByTestId('topbar-up')).toHaveText(parent);
        await expect(page.getByTestId('note-menu')).toBeVisible();
        await expect(page.getByTestId('topbar-crumbs')).toHaveCount(0);
        const bar = await page.getByTestId('topbar').boundingBox();
        expect(bar.height, 'the top bar wrapped onto a second line').toBeLessThanOrEqual(ROW_HEIGHT);
        await expectNoHorizontalScroll(page);
        await shot(page, 'mobile-path-row');

        await page.getByTestId('topbar-up').tap();
        await expect(page).toHaveURL(MAIN.url.dir(docs.deep.path.split('/').slice(0, -1).join('/')));
    });

    test('the top bar icons and the page text share both edges', async ({page}) => {
        await page.goto(routes.doc(DOC));

        const width = page.viewportSize().width;
        const back = await page.getByTestId('topbar-up').locator('svg').boundingBox();
        const dots = await page.getByTestId('note-menu').locator('svg').boundingBox();
        const heading = await page.getByTestId('doc').locator('h1').first().boundingBox();
        const left = Math.round(back.x);
        const right = Math.round(width - dots.x - dots.width);
        expect(right).toBe(left);
        expect([Math.round(heading.x), Math.round(width - heading.x - heading.width)]).toEqual([left, right]);
    });

    test('a note at the root goes back to the list of the space', async ({page}) => {
        // arrange
        await page.goto(routes.doc('index.md'));
        await expect(page.getByTestId('doc')).toBeVisible();

        // act
        await page.getByTestId('topbar-up').tap();

        // assert
        await expect(page).toHaveURL(atHome());
        await expect(page.getByTestId('topbar-up')).toHaveCount(0);
    });

    test('the root, a folder and a note start their title on one line, which the bar does not repeat', async ({page}) => {
        // arrange
        const screens = [routes.home(), routes.dir(docs.folder.path), routes.doc(DOC)];
        const heading = page.locator('.mantine-AppShell-main h1').first();
        const tops = [];
        const shown = [];

        // act
        for (const url of screens) {
            await page.goto(url);
            await expect(heading).toBeVisible();
            tops.push(Math.round((await heading.boundingBox()).y));
            shown.push(await page.getByTestId('topbar-title').getAttribute('data-shown'));
        }

        // assert
        expect(tops).toEqual([tops[0], tops[0], tops[0]]);
        expect(shown).toEqual(['false', 'false', 'false']);
    });

    test('the root names the space in the bar, beside the logo', async ({page}) => {
        // act
        await page.goto(routes.home());

        // assert
        await expect(page.getByTestId('topbar-home')).toHaveText(await page.getByTestId('dir-title').textContent());
        await expect(page.getByTestId('topbar-home').locator('svg')).toBeVisible();
    });

    test('Copy link copies on a plain http address, where the page has no clipboard api', async ({page}) => {
        // arrange
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'clipboard', {value: undefined});
            window.copied = [];
            document.execCommand = (command) => {
                const field = document.activeElement;
                window.copied.push(`${command}:${field.value.slice(field.selectionStart, field.selectionEnd)}`);
                return true;
            };
        });
        await page.goto(routes.home());
        const row = page.locator(`[data-testid=dir-row][data-path="${docs.folder.path}"]`);

        // act
        await row.getByTestId('tree-row-menu').tap();
        await page.getByTestId('tree-row-menu-copy-link').tap();

        // assert
        await expect(page.locator('[data-testid=toast][data-kind="ok"]')).toContainText(text.toast.linkCopied);
        const copied = await page.evaluate(() => window.copied);
        const toast = await page.getByTestId('toast').boundingBox();
        expect(Math.abs(toast.x + toast.width / 2 - page.viewportSize().width / 2)).toBeLessThan(2);
        expect(toast.y).toBeLessThan(40);
        await expect(page.getByTestId('toast').locator('.mantine-Notification-closeButton')).toHaveCount(0);
        expect(copied).toEqual([`copy:${new URL(MAIN.url.dir(docs.folder.path)).href}`]);
    });

    test('a dialog stands in the middle of the screen', async ({page}) => {
        // arrange
        await page.goto(routes.home());
        await page.locator(`[data-testid=dir-row][data-path="${docs.folder.path}"]`).getByTestId('tree-row-menu').tap();

        // act
        await page.getByTestId('tree-row-menu-delete').tap();

        // assert
        const dialog = page.locator('.mantine-Modal-content');
        await expect(dialog).toBeVisible();
        await expect.poll(async () => {
            const box = await dialog.boundingBox();
            return Math.abs(box.y - (page.viewportSize().height - box.y - box.height));
        }).toBeLessThan(2);
        await page.getByTestId('modal-cancel').tap();
    });

    test.describe('a toast', () => {
        async function copied(page) {
            await page.goto(routes.home());
            await page.locator(`[data-testid=dir-row][data-path="${docs.folder.path}"]`).getByTestId('tree-row-menu').tap();
            await page.getByTestId('tree-row-menu-copy-link').tap();
            await expect(page.getByTestId('toast-pill')).toBeVisible();
        }

        test('leaves the bar beside it to take a tap, and goes on its own after one', async ({page}) => {
            // arrange
            await copied(page);

            // act
            await page.getByTestId('folder-menu').tap();

            // assert
            await expect(page.getByTestId('folder-menu-dropdown')).toBeVisible();
            await expect(page.getByTestId('toast')).toHaveCount(0, {timeout: 5000});
        });

        test('goes at a tap on it', async ({page}) => {
            // arrange
            await copied(page);

            // act
            await page.getByTestId('toast-pill').tap();

            // assert
            await expect(page.getByTestId('toast')).toHaveCount(0, {timeout: 1500});
        });

        test('goes at a flick up', async ({page}) => {
            // arrange
            await copied(page);
            const box = await page.getByTestId('toast-pill').boundingBox();
            const x = box.x + box.width / 2;
            const cdp = await page.context().newCDPSession(page);

            // act
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x, y: box.y + 20}]});
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x, y: box.y + 5}]});
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x, y: box.y - 20}]});
            await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});

            // assert
            await expect(page.getByTestId('toast')).toHaveCount(0, {timeout: 1500});
        });
    });

    test('the menu switches the theme and names the account', async ({page}) => {
        await tapSpaceMenu(page);
        await shot(page, 'mobile-more-menu');

        const theme = page.getByTestId('space-menu-theme');
        await theme.getByText('Dark', {exact: true}).tap();
        await expect(theme).toHaveAttribute('data-theme', 'dark');
        await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'dark');
        await expect(page.getByTestId('space-menu-signout')).toBeVisible();
    });

    test('the history fills the screen, the versions under the version, Restore big enough to tap', async ({page}) => {
        // arrange
        const wide = 'x'.repeat(200);
        await signIn(page, {baseURL: HISTORY.baseURL, from: routes.edit(HISTORY_DOC)});
        for (const body of [`# Одна\n\n${wide}\n`, `# Две\n\n${wide}${wide}\n`]) {
            await setSource(page, body);
            await save(page);
        }

        // act
        await page.goto(HISTORY.url.history(HISTORY_DOC));
        await expect(page.getByTestId('version').first()).toBeVisible();

        // assert
        await expectNoHorizontalScroll(page);
        const version = await page.getByTestId('history-version').boundingBox();
        const list = await page.getByTestId('history-list').boundingBox();
        expect(list.y, 'the versions sit under the version').toBeGreaterThanOrEqual(version.y + version.height - 1);
        const viewport = page.viewportSize().width;
        const box = await page.getByTestId('version-restore').boundingBox();
        expect(box.x + box.width, 'Restore reaches past the right edge').toBeLessThanOrEqual(viewport);
        expect(await tooSmall(page, '[data-testid=version-restore]', BUTTON_HEIGHT)).toEqual([]);

        await page.getByTestId('version').nth(1).tap();
        await expect(page.locator('[data-testid=version][data-selected="true"]')).toHaveAttribute(
            'data-rev', await page.getByTestId('version').nth(1).getAttribute('data-rev'),
        );
        await expect(page.getByTestId('rendered-diff')).toBeVisible();
        await expectNoHorizontalScroll(page);
        await page.getByTestId('history-diff-view').getByText('Source').tap();
        const diff = page.getByTestId('history-diff');
        await expect(diff).toBeVisible();
        expect(await diff.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
        await expectNoHorizontalScroll(page);
        await shot(page, 'mobile-history');
    });

    test('the search opens from its tab and navigates', async ({page}) => {
        // arrange
        await page.goto(routes.doc(DOC));
        await page.waitForLoadState('networkidle');

        // act & assert
        await page.getByTestId('tab-search').tap();
        await expect(page.getByTestId('search-input')).toBeVisible();
        await page.getByTestId('search-input').fill(docs.search.palette.query);
        await expect(page.getByTestId('search-result').first()).toBeVisible();
        await shot(page, 'mobile-search');

        await page.getByTestId('search-result').first().tap();
        await expect(page).toHaveURL(new RegExp(`${routes.doc(docs.search.palette.path)}\\?q=`));
    });

    test('the outline sheet opens from the note menu', async ({page}) => {
        // arrange
        await page.goto(routes.doc(DOC));
        await page.getByTestId('note-menu').tap();

        // act
        await page.getByTestId('note-menu-outline').tap();

        // assert
        await expect(page.getByTestId('toc-entry').first()).toBeVisible();
        await shot(page, 'mobile-toc-sheet');

        await page.getByTestId('toc-entry').first().tap();
        await expect(page.getByTestId('toc-entry')).toHaveCount(0);
    });

    test('a sheet that closed leaves the page live behind it', async ({page}) => {
        await page.goto(routes.doc(docs.illustrated.doc));
        await page.getByTestId('doc-image').first().tap();
        await expect(page.getByTestId('doc-lightbox-image')).toBeVisible();

        await page.keyboard.press('Escape');
        await expect(page.getByTestId('doc-lightbox-image')).toHaveCount(0);

        const stuck = await page.evaluate(() => Array.from(
            document.querySelectorAll('[inert]')).map((el) => el.className));
        expect(stuck, 'the sheet left the page inert behind it').toEqual([]);

        await page.getByTestId('doc-image').first().tap();
        await expect(page.getByTestId('doc-lightbox-image')).toBeVisible();
    });

    test('the image viewer stays on a tap on the picture and closes on a tap beside it', async ({page}) => {
        // arrange
        await page.goto(routes.doc(docs.illustrated.doc));
        const image = page.getByTestId('doc-image').first();
        await expect(image).toBeVisible();
        await image.tap();
        const picture = page.getByTestId('doc-lightbox-image');
        await expect(picture).toBeVisible();
        await shot(page, 'mobile-lightbox');

        // act
        await picture.tap();

        // assert
        await expect(picture).toBeVisible();
        await expect(picture).toHaveAttribute('data-zoomed', 'false');
        await page.touchscreen.tap(8, page.viewportSize().height - 8);
        await expect(picture).toHaveCount(0);
    });

    test('a double tap zooms the picture in the viewer and another fits it back', async ({page}) => {
        // arrange
        await page.goto(routes.doc(docs.illustrated.doc));
        await page.getByTestId('doc-image').first().tap();
        const picture = page.getByTestId('doc-lightbox-image');
        await expect(picture).toBeVisible();
        const box = await picture.boundingBox();
        const centre = {x: box.x + box.width / 2, y: box.y + box.height / 2};

        // act
        await page.touchscreen.tap(centre.x, centre.y);
        await page.touchscreen.tap(centre.x, centre.y);

        // assert
        await expect(picture).toHaveAttribute('data-zoomed', 'true');
        await page.touchscreen.tap(centre.x, centre.y);
        await page.touchscreen.tap(centre.x, centre.y);
        await expect(picture).toHaveAttribute('data-zoomed', 'false');
    });

    test('the notes can be installed as an app', async ({page}) => {
        await page.goto(routes.home());
        await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
        await expect(page.locator('meta[name="apple-mobile-web-app-capable"]'))
            .toHaveAttribute('content', 'yes');

        const res = await page.request.get(`${MAIN.baseURL}/manifest.webmanifest`);
        expect(res.status()).toBe(200);
        expect(res.headers()['content-type']).toContain('application/manifest+json');

        const manifest = await res.json();
        expect(manifest.display).toBe('standalone');
        const me = await (await page.request.get(MAIN.url.api('/me'))).json();
        expect(manifest.name, 'the home screen name is the configured site title')
            .toBe(me.site_title);

        const icon = await page.request.get(`${MAIN.baseURL}${manifest.icons[0].src}`);
        expect(icon.status()).toBe(200);
        expect(icon.headers()['content-type']).toBe('image/png');
    });

    test('the rows of every menu are big enough to tap', async ({page}) => {
        // act & assert
        await tapSpaceMenu(page);
        await expect(page.getByTestId('space-menu-theme')).toBeVisible();
        expect(await tooSmall(page, '[role=menuitem]'), 'the space menu').toEqual([]);
        const themes = await page.getByTestId('space-menu-theme').boundingBox();
        expect(Math.round(themes.height), 'the theme picker').toBe(CHOICE_HEIGHT);
        await page.keyboard.press('Escape');

        await page.goto(routes.doc(DOC));
        await page.getByTestId('note-menu').tap();
        await openedMenu(page, 'note-menu-dropdown');
        await shot(page, 'mobile-note-menu');
        expect(await tooSmall(page, '[role=menuitem]'), 'the note menu').toEqual([]);
    });

    test('the editor toolbar moves along one axis and shows where it goes on', async ({page}) => {
        // arrange
        writeFixture(SCRATCH, '# Заметка\n\nтекст\n');
        await page.goto(routes.edit(SCRATCH));
        const toolbar = page.getByTestId('editor-toolbar');
        await expect(toolbar).toBeVisible();

        // act & assert
        const motion = await toolbar.evaluate((el) => {
            const style = getComputedStyle(el);
            return {
                vertical: style.overflowY,
                touch: style.touchAction,
                bounce: style.overscrollBehaviorX,
                page: getComputedStyle(document.documentElement).overscrollBehaviorY,
                taller: el.scrollHeight > el.clientHeight,
                wider: el.scrollWidth > el.clientWidth,
            };
        });
        expect(motion).toEqual({
            vertical: 'hidden', touch: 'pan-x', bounce: 'none', page: 'none', taller: false, wider: true,
        });
        await expect(toolbar).toHaveAttribute('data-more-start', 'false');
        await expect(toolbar).toHaveAttribute('data-more-end', 'true');

        await toolbar.evaluate((el) => el.scrollTo({left: el.scrollWidth}));
        await expect(toolbar).toHaveAttribute('data-more-start', 'true');
        await expect(toolbar).toHaveAttribute('data-more-end', 'false');
        await expect(page.getByTestId('editor-toolbar-image')).toBeInViewport({ratio: 1});
    });

    test('a file started from an empty folder is named in a dialog', async ({page}) => {
        // arrange
        fs.mkdirSync(fixtureFile(EMPTY_FOLDER), {recursive: true});
        await page.goto(routes.dir(EMPTY_FOLDER));
        await expect(page.getByTestId('dir-empty-title')).toHaveText(text.dir.empty);
        await shot(page, 'mobile-empty-folder');
        expect(await tooSmall(page, '[data-testid=dir-empty] button', BUTTON_HEIGHT)).toEqual([]);

        // act
        await page.getByTestId('dir-empty-new-file').tap();

        // assert
        await expect(page.getByTestId('new-entry-name')).toBeInViewport();
        await expect(page.getByTestId('new-entry-name')).toBeFocused();
        expect(await tooSmall(page, '[data-testid=new-entry-cancel], [data-testid=new-entry-create]', BUTTON_HEIGHT))
            .toEqual([]);
    });

    test('the search is usable with the phone turned sideways', async ({page}) => {
        // arrange
        await page.setViewportSize({width: 844, height: 390});
        await page.goto(routes.doc(DOC));

        // act & assert
        await page.getByTestId('sidebar-search').tap();
        await expect(page.getByTestId('search-input')).toBeVisible();
        await page.getByTestId('search-input').fill(docs.search.palette.query);
        await expect(page.getByTestId('search-result').first()).toBeVisible();
        await shot(page, 'mobile-landscape-search');
        await expectNoHorizontalScroll(page);

        await page.getByTestId('search-result').first().tap();
        await expect(page).toHaveURL(new RegExp(`${routes.doc(docs.search.palette.path)}\\?q=`));
    });
});

test.describe('mobile sync state', () => {
    const WIKI = MULTI.spaces.wiki;
    const wiki = MULTI.extra.find((extra) => extra.name === 'wiki');
    const SYNC_DOC = 'e2e-mobile-sync.md';
    const SYNC_FOLDER = 'e2e-mobile-folder';

    test.beforeEach(async ({page}) => {
        restoreOrigin(wiki.origin);
        fs.writeFileSync(`${wiki.dir}/${SYNC_DOC}`, '# Mobile sync\n\nstarting point.\n', 'utf8');
        await signIn(page, {baseURL: MULTI.baseURL, from: WIKI.doc(SYNC_DOC)});
        await inStep(page, WIKI);
    });

    test.afterEach(async ({page}) => {
        restoreOrigin(wiki.origin);
        fs.rmSync(`${wiki.dir}/${SYNC_DOC}`, {force: true});
        fs.rmSync(`${wiki.dir}/${SYNC_FOLDER}`, {recursive: true, force: true});
        await inStep(page, WIKI);
    });

    async function saveStuck(page, contentPath, source) {
        await page.goto(WIKI.edit(contentPath));
        await setSource(page, source);
        await save(page);
    }

    test('the control and the banner reach a phone, which has no tree', async ({page}) => {
        // arrange
        breakOrigin(wiki.origin);
        await saveStuck(page, SYNC_DOC, '# Mobile sync\n\nstuck.\n');

        // act
        await page.goto(WIKI.doc(SYNC_DOC));

        // assert
        await expect(page.getByTestId('sync-control')).toHaveAttribute('data-here', 'true');
        await expect(page.getByTestId('space-alert')).toBeVisible();
        await expect(page.getByTestId('sidebar')).toHaveCount(0);
        await shot(page, 'mobile-sync-control');

        await page.getByTestId('sync-control').tap();
        await expect(page.getByTestId('sync-details')).toBeVisible();
        await expect(page.getByTestId('sync-popover-here')).toBeVisible();
        await shot(page, 'mobile-sync-sheet');
    });

    test('an index note reaches the control on a phone too', async ({page}) => {
        breakOrigin(wiki.origin);
        await saveStuck(page, 'index.md', `# Remote page\n\nthe root index on a phone, stuck at ${Date.now()}.\n`);
        await saveStuck(page, `${SYNC_FOLDER}/index.md`, '# Guide\n\nthe folder index, stuck.\n');

        await page.goto(WIKI.doc('index.md'));
        await expect(page.getByTestId('space-alert')).toBeVisible();
        await expect(page.getByTestId('sync-control')).toHaveAttribute('data-here', 'true');

        await page.goto(WIKI.doc(`${SYNC_FOLDER}/index.md`));
        await expect(page.getByTestId('sync-control')).toHaveAttribute('data-here', 'true');
        await shot(page, 'mobile-sync-folder-index');
    });

    test('the top bar still fits with the control up', async ({page}) => {
        breakOrigin(wiki.origin);
        await saveStuck(page, SYNC_DOC, '# Mobile sync\n\nstuck.\n');

        await page.goto(WIKI.doc(SYNC_DOC));
        await expect(page.getByTestId('sync-control')).toBeVisible();
        await expect(page.getByTestId('note-menu')).toBeInViewport({ratio: 1});
        await expectNoHorizontalScroll(page);

        const offenders = await tooSmall(page, '[data-testid=topbar] button, [data-testid=topbar] a');
        await shot(page, 'mobile-sync-tap-targets');
        expect(offenders, 'elements smaller than the touch minimum').toEqual([]);
    });
});
