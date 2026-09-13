// one place for the ports, paths, urls and credentials the suite and the
// launcher share

const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');

// the private corpus the suite was written against, and the fixture that ships
// with the repository, which is what a fresh clone or CI runs on
const corpusFixture = path.join(os.homedir(), 'CodeProjects', 'knowledge-base');
const repoFixture = path.join(repoRoot, 'examples', 'data');

function pickFixture() {
    if (process.env.SCRAWL_E2E_FIXTURE) return path.resolve(process.env.SCRAWL_E2E_FIXTURE);
    return fs.existsSync(corpusFixture) ? corpusFixture : repoFixture;
}

const fixture = pickFixture();
const workDir = process.env.SCRAWL_E2E_WORK || path.join(os.tmpdir(), 'scrawl-e2e');

// appBase is where the app answers, and the only place in the suite that knows.
// The react app is mounted under /app while the server rendered pages still own
// /p/, /edit/, /history/ and /search; when it takes those over, this constant
// becomes '' and nothing else in the suite changes.
const appBase = process.env.SCRAWL_E2E_APP_BASE === undefined
    ? '/app'
    : process.env.SCRAWL_E2E_APP_BASE.replace(/\/$/, '');

// encodePath escapes a content path segment by segment, the way the app builds
// its own links: a whole path run through encodeURIComponent would escape the
// separators too
function encodePath(contentPath) {
    return contentPath.split('/').map(encodeURIComponent).join('/');
}

// the routes of the app, every one of them built from appBase. No spec writes
// a url by hand, so moving the app to the root is a change to the constant.
const routes = {
    home: () => `${appBase}/`,
    doc: (contentPath) => `${appBase}/p/${encodePath(contentPath)}`,
    dir: (contentPath) => (contentPath === '' ? `${appBase}/` : `${appBase}/p/${encodePath(contentPath)}/`),
    edit: (contentPath) => `${appBase}/edit/${encodePath(contentPath)}`,
    history: (contentPath) => `${appBase}/history/${encodePath(contentPath)}`,
    search: (query) => `${appBase}/search?q=${encodeURIComponent(query)}`,
    login: () => `${appBase}/login`,
    // raw is a server route and stays where it is
    raw: (contentPath) => `/raw/${encodePath(contentPath)}`,
    // the href the renderer writes into note html for a link to another note.
    // It is the renderer's prefix and not a route of the app, so it does not
    // move with appBase; the app recognises it and routes the click itself.
    contentHref: (contentPath) => `/p/${encodePath(contentPath)}`,
};

// historyMode is passed as --history, never left to the default: on a machine
// without git "auto" turns itself off, and a spec about versions would then
// fail for a reason nothing on the page mentions
const instances = {
    main: {
        port: Number(process.env.SCRAWL_E2E_PORT || 8731),
        root: path.join(workDir, 'notes-main'),
        readOnly: false,
        historyMode: 'off',
    },
    readonly: {
        port: Number(process.env.SCRAWL_E2E_PORT_RO || 8732),
        root: path.join(workDir, 'notes-readonly'),
        readOnly: true,
        // reading the versions is a read, so read-only mode keeps the page and
        // owes the reader no Restore button on it
        historyMode: 'on',
    },
    shared: {
        port: Number(process.env.SCRAWL_E2E_PORT_SHARED || 8733),
        root: path.join(workDir, 'notes-shared'),
        uploadDir: 'attachments',
        historyMode: 'off',
    },
    history: {
        port: Number(process.env.SCRAWL_E2E_PORT_HISTORY || 8734),
        root: path.join(workDir, 'notes-history'),
        historyMode: 'on',
    },
};

for (const [name, inst] of Object.entries(instances)) {
    inst.name = name;
    inst.baseURL = `http://127.0.0.1:${inst.port}`;
    inst.log = path.join(workDir, `${name}.log`);
    inst.secretFile = path.join(workDir, `${name}-session.key`);
    // absolute counterparts of the routes above, for a spec that drives an
    // instance other than the one playwright's baseURL points at
    inst.url = Object.fromEntries(
        Object.entries(routes).map(([name2, build]) => [name2, (...args) => inst.baseURL + build(...args)]));
}

module.exports = {
    appBase,
    repoRoot,
    workDir,
    instances,
    routes,
    encodePath,
    binary: path.join(repoRoot, 'dist', 'scrawl'),
    fixture,
    repoFixture,
    user: 'e2e',
    password: 'e2e-secret-pass',
    // bcrypt hash of the password above, so a run does not pay for --gen-hash
    passwordHash: '$2a$10$2BAF2jSxMt9RHQ5LRTYvheiBey0jVUZPlp2qaEwp9XxecPk6IZSi.',
    shotsDir: process.env.SCRAWL_E2E_SHOTS || path.join(repoRoot, 'e2e', 'screenshots'),
};
