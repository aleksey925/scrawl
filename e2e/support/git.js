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

function tracked(origin) {
    return git(origin, ['ls-tree', '--name-only', '-r', 'main']).split('\n');
}

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
