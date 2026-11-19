const docs = {
    home: {path: 'index.md', title: 'Test Notes'},
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
        crumbs: [/notes/, /deep/, /nested\.md/],
    },
    folder: {path: 'db', name: 'db', entry: 'db/vacuum.md'},
    lowInTree: {path: 'showcase/plantuml/index.md', link: 'PlantUML'},
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
docs.deep.folder = docs.deep.path.slice(0, docs.deep.path.lastIndexOf('/'));
docs.deep.above = docs.deep.folder.slice(0, docs.deep.folder.lastIndexOf('/'));

module.exports = docs;
