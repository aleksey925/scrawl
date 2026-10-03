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

// defaultSpace is the space name every single-space instance is started
// with. There is no default in the binary, so this is also what the launcher
// passes as --space.name.
const defaultSpace = 'notes';

// encodePath escapes a content path segment by segment, the way the app builds
// its own links: a whole path run through encodeURIComponent would escape the
// separators too
function encodePath(contentPath) {
    return contentPath.split('/').map(encodeURIComponent).join('/');
}

// the two halves of the server's urls. A space owns one contiguous
// subtree and everything it serves is built from space(); the handful of
// routes that read no store answer at the root and are built from global().
// Nothing in the suite writes a url by hand.
function routesFor(space) {
    const base = `/s/${space}`;
    const inSpace = (suffix) => base + suffix;
    return {
        prefix: () => base,
        home: () => inSpace('/'),
        doc: (contentPath) => inSpace(`/doc/${encodePath(contentPath)}`),
        dir: (contentPath) => (contentPath === '' ? inSpace('/') : inSpace(`/doc/${encodePath(contentPath)}/`)),
        edit: (contentPath) => inSpace(`/edit/${encodePath(contentPath)}`),
        history: (contentPath) => inSpace(`/history/${encodePath(contentPath)}`),
        search: (query) => inSpace(`/search?q=${encodeURIComponent(query)}`),
        raw: (contentPath) => inSpace(`/raw/${encodePath(contentPath)}`),
        api: (suffix) => inSpace(`/api${suffix}`),
        // the webhook, which is a space route and outside /api on purpose
        hook: () => inSpace('/hook'),
        // the href the renderer writes into note html for a link to another
        // note. It is fetched by the browser directly, so it carries the
        // space prefix; the app recognises it and routes the click itself.
        contentHref: (contentPath) => inSpace(`/doc/${encodePath(contentPath)}`),
        // global routes: they read no store, so they are outside every space
        login: () => '/login',
        logout: () => '/logout',
        spaces: () => '/api/spaces',
        ping: () => '/ping',
    };
}

const routes = routesFor(defaultSpace);

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
    // the only instance started from a spaces file. It carries a second local
    // space over a root of its own and a third that is a clone of a bare
    // repository the launcher seeds, so the remote mode is driven end to end
    // and the suite still needs no network.
    multi: {
        port: Number(process.env.SCRAWL_E2E_PORT_MULTI || 8735),
        root: path.join(workDir, 'notes-multi'),
        historyMode: 'off',
        extra: [
            {
                name: 'team',
                label: 'Team wiki',
                dir: path.join(workDir, 'notes-team'),
                seed: {'team.md': '# Team wiki\n\nonly this space has it.\n'},
            },
            {
                name: 'wiki',
                label: 'Remote wiki',
                dir: path.join(workDir, 'notes-wiki'),
                origin: path.join(workDir, 'origin.git'),
                seed: {'remote.md': '# Remote page\n\npushed from the origin.\n'},
                pull: '2s',
            },
            // a fourth space whose only refresh trigger is the webhook. pull
            // is off, so a note that appears here appeared because a delivery
            // arrived and for no other reason.
            {
                name: 'hooked',
                label: 'Hooked wiki',
                dir: path.join(workDir, 'notes-hooked'),
                origin: path.join(workDir, 'hooked.git'),
                seed: {'hooked.md': '# Hooked page\n\nrefreshed by deliveries only.\n'},
                pull: '0',
                // 32 bytes, which is the minimum the binary enforces
                hookSecret: 'e2e-webhook-secret-0123456789abc',
            },
        ],
    },
};

for (const [name, inst] of Object.entries(instances)) {
    inst.name = name;
    inst.space = inst.space || defaultSpace;
    inst.baseURL = `http://127.0.0.1:${inst.port}`;
    inst.log = path.join(workDir, `${name}.log`);
    inst.secretFile = path.join(workDir, `${name}-session.key`);
    inst.routes = routesFor(inst.space);
    inst.configFile = path.join(workDir, `${name}.yml`);
    // absolute counterparts of the routes above, for a spec that drives an
    // instance other than the one playwright's baseURL points at
    inst.url = Object.fromEntries(
        Object.entries(inst.routes).map(([key, build]) => [key, (...args) => inst.baseURL + build(...args)]));
    // the same builders for each of the extra spaces, keyed by name, so a
    // spec about two spaces never writes one of their urls by hand
    inst.spaces = {[inst.space]: inst.url};
    for (const extra of inst.extra || []) {
        const build = routesFor(extra.name);
        inst.spaces[extra.name] = Object.fromEntries(
            Object.entries(build).map(([key, make]) => [key, (...args) => inst.baseURL + make(...args)]));
    }
}

module.exports = {
    defaultSpace,
    routesFor,
    repoRoot,
    workDir,
    instances,
    routes,
    encodePath,
    // overridable, because dist/ is one directory: a second checkout user - a
    // container beside the host - building there swaps the binary under a run
    binary: process.env.SCRAWL_E2E_BINARY || path.join(repoRoot, 'dist', 'scrawl'),
    fixture,
    repoFixture,
    user: 'e2e',
    password: 'e2e-secret-pass',
    // bcrypt hash of the password above, so a run does not pay for --gen-hash
    passwordHash: '$2a$10$2BAF2jSxMt9RHQ5LRTYvheiBey0jVUZPlp2qaEwp9XxecPk6IZSi.',
    shotsDir: process.env.SCRAWL_E2E_SHOTS || path.join(repoRoot, 'e2e', 'screenshots'),
};
