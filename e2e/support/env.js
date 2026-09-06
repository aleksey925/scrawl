// one place for the ports, paths and credentials the suite and the launcher share

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

const instances = {
    main: {
        port: Number(process.env.SCRAWL_E2E_PORT || 8731),
        root: path.join(workDir, 'notes-main'),
        readOnly: false,
    },
    readonly: {
        port: Number(process.env.SCRAWL_E2E_PORT_RO || 8732),
        root: path.join(workDir, 'notes-readonly'),
        readOnly: true,
    },
    shared: {
        port: Number(process.env.SCRAWL_E2E_PORT_SHARED || 8733),
        root: path.join(workDir, 'notes-shared'),
        uploadDir: 'attachments',
    },
};

for (const [name, inst] of Object.entries(instances)) {
    inst.name = name;
    inst.baseURL = `http://127.0.0.1:${inst.port}`;
    inst.log = path.join(workDir, `${name}.log`);
    inst.secretFile = path.join(workDir, `${name}-session.key`);
}

module.exports = {
    repoRoot,
    workDir,
    instances,
    binary: path.join(repoRoot, '.bin', 'scrawl'),
    fixture,
    repoFixture,
    user: 'e2e',
    password: 'e2e-secret-pass',
    // bcrypt hash of the password above, so a run does not pay for --gen-hash
    passwordHash: '$2a$10$2BAF2jSxMt9RHQ5LRTYvheiBey0jVUZPlp2qaEwp9XxecPk6IZSi.',
    shotsDir: process.env.SCRAWL_E2E_SHOTS || path.join(repoRoot, 'e2e', 'screenshots'),
};
