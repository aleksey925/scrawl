const docs = {
    home: {path: 'index.md', title: 'Engineering notes'},
    doc: {
        path: 'databases/storage.md',
        title: 'Data storage',
        folder: 'databases',
        sibling: 'databases/locks.md',
        heading: {id: 'indexes', text: 'Indexes'},
    },
    linked: {path: 'markdown.md', title: 'Writing notes', missing: 'style-guide.md'},
    long: {path: 'reference/shell-cookbook.md', title: 'Shell cookbook'},
    deep: {
        path: 'projects/postgres-migration/cutover.md',
        title: 'Cutover runbook',
        crumbs: [/projects/, /postgres-migration/, /cutover\.md/],
    },
    folder: {path: 'databases', name: 'databases', entry: 'databases/vacuum.md'},
    lowInTree: {path: 'reference/plantuml/index.md', link: 'PlantUML'},
    illustrated: {doc: 'markdown.md', image: 'logo.png'},
    filter: {term: 'vacuum', path: 'databases/vacuum.md'},
    search: {
        word: 'indexes',
        prefix: 'indexe',
        doc: 'btree',
        palette: {query: 'vacuum', path: 'databases/vacuum.md'},
    },
};

docs.missing = `${docs.doc.folder}/nothing-here.md`;
docs.deep.folder = docs.deep.path.slice(0, docs.deep.path.lastIndexOf('/'));
docs.deep.above = docs.deep.folder.slice(0, docs.deep.folder.lastIndexOf('/'));

module.exports = docs;
