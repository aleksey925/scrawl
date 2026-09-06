// launcher used by the playwright webServer entries: it makes a throwaway copy
// of the corpus and runs the binary against it, so every run starts from the
// same tree no matter what the previous one wrote

const fs = require('fs');
const path = require('path');
const {spawn} = require('child_process');

const {binary, fixture, instances, passwordHash, user, workDir} = require('./env');

function makeWritable(dir) {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        const full = path.join(dir, entry.name);
        fs.chmodSync(full, entry.isDirectory() ? 0o755 : 0o644);
        if (entry.isDirectory()) makeWritable(full);
    }
}

function prepareRoot(root) {
    if (!fs.existsSync(fixture)) {
        throw new Error(`fixture tree ${fixture} not found, unset SCRAWL_E2E_FIXTURE ` +
            'to fall back to testdata/notes');
    }
    fs.rmSync(root, {recursive: true, force: true});
    fs.mkdirSync(path.dirname(root), {recursive: true});
    fs.cpSync(fixture, root, {
        recursive: true,
        filter: (src) => path.basename(src) !== '.git',
    });
    makeWritable(root);
}

function main() {
    const name = process.argv[2];
    const inst = instances[name];
    if (!inst) throw new Error(`unknown instance ${name}, expected one of ${Object.keys(instances)}`);
    if (!fs.existsSync(binary)) {
        throw new Error(`${binary} not found, run "make build" first`);
    }

    fs.mkdirSync(workDir, {recursive: true});
    prepareRoot(inst.root);
    fs.rmSync(inst.secretFile, {force: true});

    const args = [
        `--root=${inst.root}`,
        `--listen=127.0.0.1:${inst.port}`,
        '--title=E2E Knowledge Base',
        '--dbg',
    ];
    if (inst.readOnly) args.push('--read-only');
    if (inst.uploadDir) args.push(`--upload-dir=${inst.uploadDir}`);

    const log = fs.createWriteStream(inst.log, {flags: 'w'});
    const child = spawn(binary, args, {
        env: {
            ...process.env,
            AUTH_USERS: `${user}:${passwordHash}`,
            AUTH_SECRET_FILE: inst.secretFile,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.pipe(log, {end: false});
    child.stderr.pipe(log, {end: false});
    child.stdout.pipe(process.stdout);
    child.stderr.pipe(process.stderr);

    const stop = () => child.kill('SIGTERM');
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
    child.on('exit', (code) => process.exit(code === null ? 1 : code));
}

main();
