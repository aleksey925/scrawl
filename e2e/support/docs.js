// the documents the specs drive, named by the role they play, so the same
// suite runs against the private corpus and against examples/data
//
// Every key is a role, not a file: a spec asks for "the document with an
// outline" and gets whichever document plays that part in the tree it is
// running on. Adding a spec that needs something new means adding the role
// here for both fixtures, not hard coding another path.

const path = require('path');

const {fixture, repoFixture} = require('./env');

// heading.href is the fragment as the document itself writes it, which is what
// the in-page anchor test clicks; heading.id is the slug the renderer gives the
// heading, and the two differ in case
const corpus = {
    name: 'knowledge-base',
    home: {title: 'База знаний'},
    doc: {
        path: 'db/postgresql.md',
        title: 'PostgreSQL',
        folder: 'db',
        lang: 'bash',
        heading: {id: 'индексы', text: 'Индексы', href: '%D0%98%D0%BD%D0%B4%D0%B5%D0%BA%D1%81%D1%8B'},
    },
    linked: {path: 'clean-code/clean-code-index.md', title: 'Чистый код'},
    // a document tall enough to scroll well past one viewport, so the specs
    // can check that the editor opens where the reader was looking
    long: {path: 'python/libs-docs/sqlalchemy-tutorial.md', title: 'SQLAlchemy'},
    deep: {
        path: 'python/libs-docs/sqlalchemy-tutorial.md',
        title: 'SQLAlchemy',
        crumbs: [/python/, /libs-docs/, /sqlalchemy/],
    },
    folder: {path: 'python/libs-docs', name: 'libs-docs', entry: 'python/libs-docs/alembic-tutorial.md'},
    illustrated: {doc: 'regexp/regexp-index.md', image: 'regexp/regex-cheat-sheet.png'},
    filter: {term: 'postgre', path: 'db/postgresql.md'},
    search: {
        word: 'индексы',
        prefix: 'индек',
        doc: 'postgresql',
        palette: {query: 'sqlalchemy', path: 'python/libs-docs/sqlalchemy-tutorial.md'},
    },
};

const repo = {
    name: 'examples/data',
    home: {title: 'Test Notes'},
    doc: {
        path: 'db/storage.md',
        title: 'Хранение данных',
        folder: 'db',
        lang: 'bash',
        heading: {id: 'индексы', text: 'Индексы', href: '%D0%B8%D0%BD%D0%B4%D0%B5%D0%BA%D1%81%D1%8B'},
    },
    linked: {path: 'guide.md', title: 'Guide'},
    long: {path: 'notes/shell-cookbook.md', title: 'Shell cookbook'},
    deep: {
        path: 'notes/deep/nested.md',
        title: 'Deeply nested page',
        crumbs: [/notes/, /deep/, /nested/],
    },
    folder: {path: 'db', name: 'db', entry: 'db/vacuum.md'},
    illustrated: {doc: 'guide.md', image: 'images/logo.png'},
    filter: {term: 'vacuum', path: 'db/vacuum.md'},
    search: {
        word: 'индексы',
        prefix: 'индек',
        doc: 'btree',
        palette: {query: 'vacuum', path: 'db/vacuum.md'},
    },
};

const docs = path.resolve(fixture) === path.resolve(repoFixture) ? repo : corpus;

docs.missing = `${docs.doc.folder}/nothing-here.md`;

module.exports = docs;
