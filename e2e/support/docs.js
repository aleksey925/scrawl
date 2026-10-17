// the documents of examples/data the specs drive, named by the role they play
//
// Every key is a role, not a file: a spec asks for "the document with an
// outline" and not for a path. Adding a spec that needs something new means
// adding the role here, not hard coding another path in the spec.

// heading.href is the fragment as the document itself writes it, which is what
// the in-page anchor test clicks; heading.id is the slug the renderer gives the
// heading
const docs = {
    home: {title: 'Test Notes'},
    doc: {
        path: 'db/storage.md',
        title: 'Хранение данных',
        folder: 'db',
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

docs.missing = `${docs.doc.folder}/nothing-here.md`;

module.exports = docs;
