const docs = {
    home: {title: 'Test Notes'},
    doc: {
        path: 'db/storage.md',
        title: 'Data storage',
        folder: 'db',
        heading: {id: 'indexes', text: 'Indexes'},
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
        word: 'indexes',
        prefix: 'indexe',
        doc: 'btree',
        palette: {query: 'vacuum', path: 'db/vacuum.md'},
    },
};

docs.missing = `${docs.doc.folder}/nothing-here.md`;

module.exports = docs;
