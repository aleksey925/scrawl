const {expect, test} = require('../support/test');

const {chooseTheme, openSpaceMenu, removeFixture, routes, shot, signIn, writeFixture} = require('../support/helpers');

const NOTE = 'e2e-plantuml.md';

const SEQUENCE = '```plantuml\n@startuml\nАлиса -> Боб : привет\nБоб --> Алиса : ok\n@enduml\n```';
const CLASSES = '```puml\nclass Car {\n  +drive()\n}\ninterface Engine\nCar *-- Engine\n```';

function note(...blocks) {
    return `# PlantUML\n\n${blocks.join('\n\nText between.\n\n')}\n`;
}

function drawn(page) {
    return page.getByTestId('doc').locator('.md-diagram[data-state="done"] .md-diagram-view > svg');
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
            (nodes) => nodes.map((node) => node.getAttribute('href') ?? node.getAttribute('xlink:href') ?? ''));

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
});
