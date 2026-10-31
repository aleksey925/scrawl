const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');

const fixture = path.join(repoRoot, 'examples', 'data');

const slot = Number(process.env.TEST_PARALLEL_INDEX || 0);
const PORT_STEP = 10;
const workDir = path.join(process.env.SCRAWL_E2E_WORK || path.join(os.tmpdir(), 'scrawl-e2e'), `worker-${slot}`);

function port(variable, fallback) {
    return Number(process.env[variable] || fallback) + slot * PORT_STEP;
}

const defaultSpace = 'notes';

function encodePath(contentPath) {
    return contentPath.split('/').map(encodeURIComponent).join('/');
}

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
        recent: () => inSpace('/recent'),
        raw: (contentPath) => inSpace(`/raw/${encodePath(contentPath)}`),
        api: (suffix) => inSpace(`/api${suffix}`),
        hook: () => inSpace('/hook'),
        contentHref: (contentPath) => inSpace(`/doc/${encodePath(contentPath)}`),
        login: () => '/login',
        logout: () => '/logout',
        spaces: () => '/api/spaces',
        ping: () => '/ping',
    };
}

const routes = routesFor(defaultSpace);

const instances = {
    main: {
        port: port('SCRAWL_E2E_PORT', 8731),
        root: path.join(workDir, 'notes-main'),
        readOnly: false,
        historyMode: 'off',
    },
    readonly: {
        port: port('SCRAWL_E2E_PORT_RO', 8732),
        root: path.join(workDir, 'notes-readonly'),
        readOnly: true,
        historyMode: 'on',
    },
    shared: {
        port: port('SCRAWL_E2E_PORT_SHARED', 8733),
        root: path.join(workDir, 'notes-shared'),
        uploadDir: 'attachments',
        formatOnSave: false,
        historyMode: 'off',
    },
    history: {
        port: port('SCRAWL_E2E_PORT_HISTORY', 8734),
        root: path.join(workDir, 'notes-history'),
        historyMode: 'on',
    },
    multi: {
        port: port('SCRAWL_E2E_PORT_MULTI', 8735),
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
            {
                name: 'hooked',
                label: 'Hooked wiki',
                dir: path.join(workDir, 'notes-hooked'),
                origin: path.join(workDir, 'hooked.git'),
                seed: {'hooked.md': '# Hooked page\n\nrefreshed by deliveries only.\n'},
                pull: '0',
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
    inst.url = Object.fromEntries(
        Object.entries(inst.routes).map(([key, build]) => [key, (...args) => inst.baseURL + build(...args)]));
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
    slot,
    workDir,
    instances,
    routes,
    encodePath,
    binary: process.env.SCRAWL_E2E_BINARY || path.join(repoRoot, 'dist', 'scrawl'),
    fixture,
    user: 'e2e',
    password: 'e2e-secret-pass',
    passwordHash: '$2a$10$2BAF2jSxMt9RHQ5LRTYvheiBey0jVUZPlp2qaEwp9XxecPk6IZSi.',
    shotsDir: process.env.SCRAWL_E2E_SHOTS || path.join(repoRoot, 'e2e', 'screenshots'),
};
