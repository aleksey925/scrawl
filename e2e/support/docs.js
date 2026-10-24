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
        crumbs: [/notes/, /deep/, /Deeply nested page/],
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
