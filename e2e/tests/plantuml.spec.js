const {expect, test} = require('../support/test');

const {
    chooseTheme, modifier, openSpaceMenu, pressShortcut, removeFixture, rgb, routes, shot, signIn, writeFixture,
} = require('../support/helpers');
const darkTheme = require('../../theme/themes/dark.json');

const NOTE = 'e2e-plantuml.md';

const SEQUENCE = '```plantuml\n@startuml\nАлиса -> Боб : привет\nБоб --> Алиса : ok\n@enduml\n```';
const CLASSES = '```puml\nclass Car {\n  +drive()\n}\ninterface Engine\nCar *-- Engine\n```';

function note(...blocks) {
    return `# PlantUML\n\n${blocks.join('\n\nText between.\n\n')}\n`;
}

function drawn(page) {
    return page.getByTestId('doc').locator('.md-diagram[data-state="done"] .md-diagram-frame > svg');
}

function watchConsole(page) {
    const messages = [];
    page.on('console', (message) => messages.push(message.text()));
    return messages;
}

test.describe('plantuml', () => {
    test.beforeEach(async ({page}) => {
        await signIn(page);
    });

    test.afterEach(() => {
        removeFixture(NOTE);
    });

    test('a sequence and a class diagram are drawn, the class one by graphviz', async ({page}) => {
        // arrange
        const messages = watchConsole(page);
        writeFixture(NOTE, note(SEQUENCE, CLASSES));

        // act
        await page.goto(routes.doc(NOTE));

        // assert
        await expect(drawn(page)).toHaveCount(2);
        await expect(drawn(page).first()).toContainText('Алиса');
        await expect(drawn(page).nth(1).locator('g.entity')).toHaveCount(2);
        await expect(page.getByTestId('doc').locator('.md-diagram-error')).toHaveCount(0);
        await expect(page.getByTestId('doc').locator('pre.plantuml').first()).toBeHidden();
        expect(messages.filter((text) => /Smetana|WebAssembly|Content Security/.test(text))).toEqual([]);
        await shot(page, 'plantuml-drawn');
    });

    test('two diagrams of a note share no id', async ({page}) => {
        // arrange
        writeFixture(NOTE, note(SEQUENCE, SEQUENCE));

        // act
        await page.goto(routes.doc(NOTE));
        await expect(drawn(page)).toHaveCount(2);
        const ids = (svg) => svg.evaluate((root) => Array.from(root.querySelectorAll('[id]'), (node) => node.id));
        const first = await ids(drawn(page).first());
        const second = await ids(drawn(page).nth(1));

        // assert
        expect(first.length).toBeGreaterThan(0);
        expect(first.filter((id) => second.includes(id))).toEqual([]);
    });

    test('a diagram still drawing shows a placeholder instead of its source', async ({page}) => {
        // arrange
        writeFixture(NOTE, note(SEQUENCE));
        let release = () => {};
        const held = new Promise((resolve) => {
            release = resolve;
        });
        await page.route('**/assets/plantuml.js', async (route) => {
            await held;
            await route.continue();
        });
        const box = page.getByTestId('doc').locator('.md-diagram');

        // act
        await page.goto(routes.doc(NOTE));

        // assert
        await expect(box).toHaveAttribute('data-state', 'drawing');
        await expect(box.locator('pre.plantuml')).toBeHidden();
        const placeholder = await box.evaluate((node) => {
            const style = getComputedStyle(node, '::before');
            return {content: style.content, background: style.backgroundImage};
        });
        expect(placeholder.content).not.toBe('none');
        expect(placeholder.background).toContain('linear-gradient');
        await shot(page, 'plantuml-drawing');
        release();
        await expect(drawn(page)).toHaveCount(1);
        expect(await box.evaluate((node) => getComputedStyle(node, '::before').content)).toBe('none');
    });

    test('a diagram shows as soon as it is drawn, before the next one is', async ({page}) => {
        // arrange
        writeFixture(NOTE, note(
            SEQUENCE,
            '```plantuml\n@startuml\n!include <C4/C4_Context>\nPerson(reader, "Reader")\n@enduml\n```',
        ));
        let release = () => {};
        const held = new Promise((resolve) => {
            release = resolve;
        });
        await page.route('**/plantuml/c4.min.js', async (route) => {
            await held;
            await route.continue();
        });
        const boxes = page.getByTestId('doc').locator('.md-diagram');

        // act
        await page.goto(routes.doc(NOTE));

        // assert
        await expect(boxes.first()).toHaveAttribute('data-state', 'done');
        await expect(boxes.nth(1)).toHaveAttribute('data-state', 'drawing');
        release();
        await expect(drawn(page)).toHaveCount(2);
    });

    test('a mermaid diagram does not wait for the plantuml engine', async ({page}) => {
        // arrange
        writeFixture(NOTE, note(SEQUENCE, '```mermaid\nflowchart LR\n  A --> B\n```'));
        let release = () => {};
        const held = new Promise((resolve) => {
            release = resolve;
        });
        await page.route('**/assets/plantuml.js', async (route) => {
            await held;
            await route.continue();
        });
        const boxes = page.getByTestId('doc').locator('.md-diagram');

        // act
        await page.goto(routes.doc(NOTE));

        // assert
        await expect(boxes.nth(1)).toHaveAttribute('data-state', 'done');
        await expect(boxes.first()).toHaveAttribute('data-state', 'drawing');
        release();
        await expect(boxes.first()).toHaveAttribute('data-state', 'done');
    });

    test('a diagram whose renderer does not load shows its source again', async ({page}) => {
        // arrange
        writeFixture(NOTE, note(SEQUENCE));
        await page.route('**/assets/plantuml.js', (route) => route.abort());
        const box = page.getByTestId('doc').locator('.md-diagram');

        // act
        await page.goto(routes.doc(NOTE));

        // assert
        await expect(box.locator('.md-diagram-error')).toHaveText('Could not load the diagram renderer.');
        await expect(box.locator('pre.plantuml')).toBeVisible();
        await expect(box).not.toHaveAttribute('data-state');
    });

    test('a syntax error shows plantuml\'s own picture of the line', async ({page}) => {
        // arrange
        writeFixture(NOTE, note('```plantuml\n@startuml\nAlice -> :\nfoo bar baz\n@enduml\n```'));

        // act
        await page.goto(routes.doc(NOTE));

        // assert
        await expect(drawn(page)).toHaveCount(1);
        await expect(drawn(page)).toContainText('Syntax Error?');
    });

    test('a library is loaded from the server when a diagram includes it, and only then', async ({page}) => {
        // arrange
        const libraries = [];
        page.on('request', (request) => {
            if (new URL(request.url()).pathname.includes('/plantuml/')) {
                libraries.push(new URL(request.url()).pathname.split('/').pop());
            }
        });
        writeFixture(NOTE, note(
            SEQUENCE,
            '```plantuml\n@startuml\n!include <C4/C4_Context>\nPerson(reader, "Reader")\nSystem(notes, "Scrawl")\nRel(reader, notes, "reads")\n@enduml\n```',
        ));

        // act
        await page.goto(routes.doc(NOTE));

        // assert
        await expect(drawn(page)).toHaveCount(2);
        await expect(drawn(page).nth(1)).toContainText('Reader');
        await expect(drawn(page).nth(1).locator('image')).not.toHaveCount(0);
        expect(libraries).toContain('c4.min.js');
        expect(libraries.every((name) => /^[a-z0-9.-]+\.js$/.test(name))).toBe(true);
        await shot(page, 'plantuml-c4');
    });

    test('a note with no plantuml loads no engine, and a plain diagram loads no library', async ({page}) => {
        // arrange
        const loaded = [];
        page.on('request', (request) => {
            const path = new URL(request.url()).pathname;
            if (path.includes('/plantuml/') || path.endsWith('/plantuml.js')) {
                loaded.push(path.split('/').pop());
            }
        });
        writeFixture(NOTE, '# No diagram\n\nJust text.\n');
        await page.goto(routes.doc(NOTE));
        await expect(page.getByTestId('doc').locator('h1')).toHaveText('No diagram');
        const withoutDiagrams = [...loaded];
        writeFixture(NOTE, note(SEQUENCE));

        // act
        await page.goto(routes.doc(NOTE));

        // assert
        await expect(drawn(page)).toHaveCount(1);
        expect(withoutDiagrams).toEqual([]);
        expect(loaded).toEqual(['plantuml.js']);
    });

    test('a host that refuses wasm gets a class diagram laid out by smetana, and no crash', async ({page}) => {
        // arrange
        const messages = watchConsole(page);
        await page.route((url) => url.pathname === routes.doc(NOTE), async (route) => {
            const response = await route.fetch();
            const headers = response.headers();
            headers['content-security-policy'] = headers['content-security-policy'].replace(" 'wasm-unsafe-eval'", '');
            await route.fulfill({response, headers});
        });
        writeFixture(NOTE, note(CLASSES));

        // act
        await page.goto(routes.doc(NOTE));

        // assert
        await expect(drawn(page)).toHaveCount(1);
        await expect(drawn(page).locator('g.entity')).toHaveCount(2);
        await expect(drawn(page)).toContainText('Engine');
        await expect(drawn(page)).not.toContainText(/error|exception/i);
        expect(messages.some((text) => /WebAssembly|wasm/i.test(text))).toBe(true);
    });

    test('graphviz starts only for a diagram laid out by it', async ({page}) => {
        // arrange
        await page.addInitScript(() => {
            window.wasmStarts = 0;
            const instantiate = WebAssembly.instantiate;
            WebAssembly.instantiate = (...args) => {
                window.wasmStarts += 1;
                return instantiate.apply(WebAssembly, args);
            };
        });
        writeFixture(NOTE, note(SEQUENCE));
        await page.goto(routes.doc(NOTE));
        await expect(drawn(page)).toHaveCount(1);
        const forSequence = await page.evaluate(() => window.wasmStarts);
        writeFixture(NOTE, note(CLASSES));

        // act
        await page.goto(routes.doc(NOTE));

        // assert
        await expect(drawn(page)).toHaveCount(1);
        await expect(drawn(page).locator('g.entity')).toHaveCount(2);
        expect(forSequence).toBe(0);
        expect(await page.evaluate(() => window.wasmStarts)).toBe(1);
    });

    test('an include of a library that does not exist shows plantuml\'s error, and a link to a script is not kept', async ({page}) => {
        // arrange
        writeFixture(NOTE, note(
            '```plantuml\n@startuml\n!include <nosuchlib/x>\nA -> B\n@enduml\n```',
            '```plantuml\n@startuml\nA -> B : [[javascript:alert(1) bad]]\nA -> B : [[https://example.com/x good]]\n@enduml\n```',
        ));

        // act
        await page.goto(routes.doc(NOTE));
        await expect(drawn(page)).toHaveCount(2);
        const links = await drawn(page).nth(1).locator('a').evaluateAll(
            (anchors) => anchors.map((node) => node.getAttribute('href') ?? node.getAttribute('xlink:href') ?? ''));

        // assert
        await expect(drawn(page).first()).toContainText('nosuchlib');
        expect(links.filter((href) => href.startsWith('javascript'))).toEqual([]);
        expect(links).toContain('https://example.com/x');
    });

    test('a diagram is drawn again in the dark theme, on the page\'s own background', async ({page}) => {
        // arrange
        writeFixture(NOTE, note(CLASSES));
        await page.goto(routes.doc(NOTE));
        await expect(drawn(page)).toHaveCount(1);
        const light = await drawn(page).getAttribute('id');

        // act
        await openSpaceMenu(page);
        await chooseTheme(page, 'dark');
        await page.keyboard.press('Escape');

        // assert
        await expect(drawn(page)).not.toHaveAttribute('id', light);
        await expect(drawn(page).locator(':scope > rect')).toHaveCount(0);
        expect(await drawn(page).evaluate((svg) => svg.style.backgroundColor)).toBe('');
        await shot(page, 'plantuml-dark');

        await openSpaceMenu(page);
        await chooseTheme(page, 'auto');
    });

    test('in the dark theme a # is taken for a color only where plantuml reads one', async ({page}) => {
        // arrange
        const plain = [
            'A -> B : closes #123',
            'Alice->Bob: fixes #bug',
            ':read issue #42;',
            'title Issue #7\nA -> B',
            'A -> B : "see #abc"',
        ];
        const colored = [
            'class Car #pink',
            'A -[#red]-> B',
            'A -> B : <color:#red>hot</color>',
            '#lightblue:read;',
            'participant "Bob: api" as B #EFE\nA -> B',
        ];
        const fence = (source) => `\`\`\`plantuml\n${source}\n\`\`\``;
        writeFixture(NOTE, note(...[...plain, ...colored].map(fence)));
        await page.goto(routes.doc(NOTE));
        await expect(drawn(page)).toHaveCount(plain.length + colored.length);

        // act
        await openSpaceMenu(page);
        await chooseTheme(page, 'dark');
        await page.keyboard.press('Escape');

        // assert
        await expect(drawn(page)).toHaveCount(plain.length + colored.length);
        await expect.poll(() => drawn(page).evaluateAll((svgs) => svgs.map((svg) => svg.classList.contains('md-diagram-paper'))))
            .toEqual([...plain.map(() => false), ...colored.map(() => true)]);

        await openSpaceMenu(page);
        await chooseTheme(page, 'auto');
    });

    test('a click on a link in a diagram follows it and does not open the viewer', async ({page}) => {
        // arrange
        await page.context().route('https://example.com/**', (route) => route.fulfill({contentType: 'text/html', body: 'away'}));
        writeFixture(NOTE, note('```plantuml\nA -> B : [[https://example.com/away gone]]\n```'));
        await page.goto(routes.doc(NOTE));
        await expect(drawn(page)).toHaveCount(1);
        const asked = page.context().waitForEvent('request', (request) => request.url() === 'https://example.com/away');

        // act
        await drawn(page).locator('a').first().click();

        // assert
        await asked;
        await expect(page.getByTestId('doc-lightbox')).toHaveCount(0);
    });

    test('the find bar skips a diagram\'s source, and its block has no copy button', async ({page}) => {
        // arrange
        await page.route('**/assets/plantuml.js', (route) => route.abort());
        writeFixture(NOTE, '# PlantUML\n\nA quokka in the text.\n\n```plantuml\nquokka -> B : quokka\n```\n');
        await page.goto(routes.doc(NOTE));
        const box = page.getByTestId('doc').locator('.md-diagram');
        await expect(box.locator('pre.plantuml')).toBeVisible();
        await pressShortcut(page, `${await modifier(page)}+f`);
        await expect(page.getByTestId('doc-find-input')).toBeFocused();

        // act
        await page.keyboard.type('quokka');

        // assert
        await expect(page.getByTestId('doc-find-count')).toHaveAttribute('data-total', '1');
        await expect(box.getByTestId('code-copy')).toHaveCount(0);
    });

    test('in the dark theme a diagram with colors of its own is drawn light on a card, a plain one dark', async ({page}) => {
        // arrange
        const colored = '```plantuml\n@startuml\nbox "Сервер" #EFE\nparticipant API\nend box\nКлиент -> API : цветной\n@enduml\n```';
        writeFixture(NOTE, note(colored, SEQUENCE));
        await page.goto(routes.doc(NOTE));
        await openSpaceMenu(page);
        await chooseTheme(page, 'dark');
        await page.keyboard.press('Escape');

        // act
        await expect(drawn(page)).toHaveCount(2);
        const textFill = (svg) => svg.evaluate((root) => root.querySelector('text').getAttribute('fill'));

        // assert
        await expect(drawn(page).first()).toHaveClass(/md-diagram-paper/);
        await expect(drawn(page).nth(1)).not.toHaveClass(/md-diagram-paper/);
        expect(await drawn(page).first().evaluate((svg) => getComputedStyle(svg.parentElement).backgroundColor)).toBe(rgb(darkTheme.palette.diagramPaper));
        expect(await textFill(drawn(page).first())).not.toBe(await textFill(drawn(page).nth(1)));
        await shot(page, 'plantuml-dark-paper');

        await openSpaceMenu(page);
        await chooseTheme(page, 'auto');
    });
});
