// launcher used by the playwright webServer entries: it makes a throwaway copy
// of the corpus and runs the binary against it, so every run starts from the
// same tree no matter what the previous one wrote

const fs = require('fs');
const path = require('path');
const {execFileSync, spawn} = require('child_process');

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
            'to fall back to examples/data');
    }
    fs.rmSync(root, {recursive: true, force: true});
    fs.mkdirSync(path.dirname(root), {recursive: true});
    fs.cpSync(fixture, root, {
        recursive: true,
        filter: (src) => path.basename(src) !== '.git',
    });
    makeWritable(root);
}

// git runs with the same sanitized environment the app gives its own children,
// so nothing the host configured can steer the seeding
function git(dir, ...args) {
    execFileSync('git', ['--no-pager', '-c', `safe.directory=${dir}`, ...args], {
        cwd: dir,
        env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', LC_ALL: 'C'},
        stdio: 'pipe',
    });
}

function writeSeed(dir, seed) {
    fs.mkdirSync(dir, {recursive: true});
    for (const [name, content] of Object.entries(seed || {})) {
        fs.writeFileSync(path.join(dir, name), content, 'utf8');
    }
}

// prepareOrigin builds the bare repository a remote project clones from. It is
// a directory on this machine, so the suite drives the remote mode with no
// network at all.
function prepareOrigin(origin, seed) {
    fs.rmSync(origin, {recursive: true, force: true});
    fs.mkdirSync(origin, {recursive: true});
    git(origin, 'init', '--quiet', '--bare', '--initial-branch=main', '.');

    const work = `${origin}-seed`;
    fs.rmSync(work, {recursive: true, force: true});
    writeSeed(work, seed);
    git(work, 'init', '--quiet', '--initial-branch=main', '.');
    git(work, 'add', '-A');
    git(work, '-c', 'user.name=e2e', '-c', 'user.email=e2e@x', 'commit', '--quiet', '-m', 'seed');
    git(work, 'remote', 'add', 'origin', origin);
    git(work, 'push', '--quiet', 'origin', 'main');
    fs.rmSync(work, {recursive: true, force: true});
}

// writeConfig declares every project of an instance that has more than one. The
// first is the fixture copy the rest of the suite drives; the others are small
// trees of their own, so a spec about the boundary between two projects cannot
// be fooled by a document both of them happen to hold.
function writeConfig(inst) {
    const lines = ['projects:', `  - name: ${inst.project}`, `    dir: ${inst.root}`];
    for (const extra of inst.extra) {
        // a remote project's directory is left missing: scrawl clones into it,
        // which is the path a deployment actually takes
        if (extra.origin) {
            prepareOrigin(extra.origin, extra.seed);
            fs.rmSync(extra.dir, {recursive: true, force: true});
        } else {
            fs.rmSync(extra.dir, {recursive: true, force: true});
            writeSeed(extra.dir, extra.seed);
        }
        lines.push('', `  - name: ${extra.name}`, `    label: ${extra.label}`, `    dir: ${extra.dir}`);
        if (extra.origin) {
            lines.push('    repo:', `      url: ${extra.origin}`, '      branch: main', '      pull: 2s');
        }
    }
    fs.writeFileSync(inst.configFile, `${lines.join('\n')}\n`, 'utf8');
    return inst.configFile;
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

    const args = [`--listen=127.0.0.1:${inst.port}`, '--title=E2E Notes', '--dbg'];
    if (inst.extra) {
        args.push(`--config=${writeConfig(inst)}`);
    } else {
        args.push(`--root=${inst.root}`, `--project=${inst.project}`);
    }
    if (inst.readOnly) args.push('--read-only');
    if (inst.uploadDir) args.push(`--upload-dir=${inst.uploadDir}`);
    if (inst.historyMode) args.push(`--history=${inst.historyMode}`);

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
