// the bare repository a remote project clones from is a directory on this
// machine, so a spec can break it, restore it and write to it with no network

const fs = require('fs');
const path = require('path');
const {execFileSync} = require('child_process');

function git(dir, args) {
    return execFileSync('git', ['--no-pager', '-c', `safe.directory=${dir}`, ...args], {
        cwd: dir,
        env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', LC_ALL: 'C'},
        encoding: 'utf8',
    });
}

// tracked lists what the origin holds on its branch.
function tracked(origin) {
    return git(origin, ['ls-tree', '--name-only', '-r', 'main']).split('\n');
}

// pushToOrigin is a second writer: a clone of its own that commits and pushes,
// which is what makes the branch move under the server.
function pushToOrigin(origin, name, content) {
    const work = `${origin}-writer`;
    fs.rmSync(work, {recursive: true, force: true});
    git(origin, ['clone', '--quiet', origin, work]);
    fs.mkdirSync(path.dirname(path.join(work, name)), {recursive: true});
    fs.writeFileSync(path.join(work, name), content, 'utf8');
    git(work, ['add', name]);
    git(work, ['-c', 'user.name=other', '-c', 'user.email=o@x', 'commit', '--quiet', '-m', 'from elsewhere']);
    git(work, ['push', '--quiet', 'origin', 'main']);
    fs.rmSync(work, {recursive: true, force: true});
}

// breakOrigin moves the repository aside rather than changing the project's
// configuration: the server keeps the url it started with, which is what a
// remote going away actually looks like.
function breakOrigin(origin) {
    if (fs.existsSync(origin)) {
        fs.renameSync(origin, `${origin}-aside`);
    }
}

function restoreOrigin(origin) {
    if (fs.existsSync(`${origin}-aside`)) {
        fs.rmSync(origin, {recursive: true, force: true});
        fs.renameSync(`${origin}-aside`, origin);
    }
}

module.exports = {breakOrigin, git, pushToOrigin, restoreOrigin, tracked};
