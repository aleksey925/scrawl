// launcher of the servers a worker drives: it makes a throwaway copy of the
// corpus and runs the binary against it, so every worker starts from the same
// tree no matter what the previous one wrote

const fs = require('fs');
const path = require('path');
const {execFileSync, spawn} = require('child_process');
const {once} = require('events');

const {binary, fixture, passwordHash, user, workDir} = require('./env');

const READY_TIMEOUT_MS = 120_000;
const READY_POLL_MS = 100;
const STOP_TIMEOUT_MS = 10_000;

function makeWritable(dir) {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        const full = path.join(dir, entry.name);
        fs.chmodSync(full, entry.isDirectory() ? 0o755 : 0o644);
        if (entry.isDirectory()) makeWritable(full);
    }
}

function prepareRoot(root) {
    fs.rmSync(root, {recursive: true, force: true});
    fs.mkdirSync(path.dirname(root), {recursive: true});
    fs.cpSync(fixture, root, {recursive: true});
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

// prepareOrigin builds the bare repository a remote space clones from. It is
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

// writeConfig declares every space of an instance that has more than one. The
// first is the fixture copy the rest of the suite drives; the others are small
// trees of their own, so a spec about the boundary between two spaces cannot
// be fooled by a document both of them happen to hold.
function writeConfig(inst) {
    const lines = ['spaces:', `  - name: ${inst.space}`, `    dir: ${inst.root}`];
    for (const extra of inst.extra) {
        // a remote space's directory is left missing: scrawl clones into it,
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
            lines.push('    repo:', `      url: ${extra.origin}`, '      branch: main',
                `      pull: ${extra.pull}`);
        }
        if (extra.hookSecret) {
            // outside every space root, the way the binary requires
            const file = path.join(workDir, `${extra.name}-hook.secret`);
            fs.writeFileSync(file, extra.hookSecret, 'utf8');
            lines.push(`      hook_secret_file: ${file}`);
        }
    }
    fs.writeFileSync(inst.configFile, `${lines.join('\n')}\n`, 'utf8');
    return inst.configFile;
}

function serveArgs(inst) {
    const args = ['serve', `--listen=127.0.0.1:${inst.port}`, '--site-title=E2E Notes', '--dbg'];
    if (inst.extra) {
        args.push(`--spaces-file=${writeConfig(inst)}`);
    } else {
        args.push(`--space.dir=${inst.root}`, `--space.name=${inst.space}`);
    }
    if (inst.readOnly) args.push('--read-only');
    if (inst.uploadDir) args.push(`--upload-dir=${inst.uploadDir}`);
    if (inst.formatOnSave === false) args.push('--space.format-on-save=off');
    if (inst.historyMode) args.push(`--history=${inst.historyMode}`);
    return args;
}

// a server left over from a run that was killed would answer the readiness
// probe in place of the one about to start, and every spec would drive it
async function refuseTakenPort(inst) {
    const taken = await fetch(`${inst.baseURL}/ping`).then(() => true, () => false);
    if (taken) throw new Error(`${inst.baseURL} is already taken, stop whatever listens there`);
}

function running(child) {
    return child.exitCode === null && child.signalCode === null;
}

async function waitReady(inst, child) {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
        if (!running(child)) {
            const status = child.exitCode ?? child.signalCode;
            throw new Error(`${inst.name} exited with ${status} before it was ready, see ${inst.log}`);
        }
        const ok = await fetch(`${inst.baseURL}/login`).then((res) => res.ok, () => false);
        if (ok) return;
        await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
    }
    child.kill('SIGKILL');
    throw new Error(`${inst.name} was not ready in ${READY_TIMEOUT_MS}ms, see ${inst.log}`);
}

// start makes a fresh copy of the corpus for one instance, runs the binary
// against it and resolves once it answers, with the function that stops it
async function start(inst) {
    if (!fs.existsSync(binary)) {
        throw new Error(`${binary} not found, run "make build" first`);
    }
    await refuseTakenPort(inst);

    fs.mkdirSync(workDir, {recursive: true});
    prepareRoot(inst.root);
    fs.rmSync(inst.secretFile, {force: true});

    const log = fs.openSync(inst.log, 'w');
    const child = spawn(binary, serveArgs(inst), {
        env: {
            ...process.env,
            AUTH_USERS: `${user}:${passwordHash}`,
            AUTH_SECRET_FILE: inst.secretFile,
        },
        stdio: ['ignore', log, log],
    });
    fs.closeSync(log);

    // the worker can die without tearing its fixtures down, and a server it
    // leaves behind holds the ports the worker that replaces it needs
    const reap = () => child.kill('SIGKILL');
    process.on('exit', reap);

    await waitReady(inst, child);

    return async () => {
        process.off('exit', reap);
        if (!running(child)) return;
        const done = once(child, 'exit');
        child.kill('SIGTERM');
        const timer = setTimeout(() => child.kill('SIGKILL'), STOP_TIMEOUT_MS);
        await done;
        clearTimeout(timer);
    };
}

module.exports = {start};
