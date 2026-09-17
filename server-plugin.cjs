'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const childProcess = require('node:child_process');

const ROOT = __dirname;
const BACKEND_DIR = path.join(ROOT, 'backend');
const LOCK_FILE = path.join(BACKEND_DIR, 'package-lock.json');
const PACKAGE_FILE = path.join(BACKEND_DIR, 'package.json');
const MODULE_DIR = path.join(BACKEND_DIR, 'node_modules');
const HASH_FILE = path.join(MODULE_DIR, '.npms-lock-hash');
let backend = null;

const info = {
    id: 'netease-personal-music-source',
    name: 'Your Own Music Source',
    description: 'Git-updatable private music source backend for SillyTavern.',
};

function fileHash(filePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function dependenciesReady() {
    if (!fs.existsSync(LOCK_FILE) || !fs.existsSync(PACKAGE_FILE) || !fs.existsSync(MODULE_DIR)) return false;
    try {
        return fs.readFileSync(HASH_FILE, 'utf8').trim() === fileHash(LOCK_FILE);
    } catch {
        return false;
    }
}

function installDependencies() {
    if (dependenciesReady()) return;
    console.log('[netease-personal-music-source] Backend dependencies changed or are missing; running npm ci...');
    const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const result = childProcess.spawnSync(npmCommand, ['ci', '--omit=dev', '--ignore-scripts'], {
        cwd: BACKEND_DIR,
        stdio: 'inherit',
        shell: false,
        env: process.env,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`npm ci failed with exit code ${result.status}`);
    fs.mkdirSync(MODULE_DIR, { recursive: true });
    fs.writeFileSync(HASH_FILE, `${fileHash(LOCK_FILE)}\n`, { mode: 0o600 });
}

function loadBackend() {
    installDependencies();
    const entry = path.join(BACKEND_DIR, 'index.cjs');
    delete require.cache[require.resolve(entry)];
    backend = require(entry);
    return backend;
}

async function init(router) {
    const implementation = loadBackend();
    if (typeof implementation.init !== 'function') throw new Error('Backend entry does not export init(router)');
    await implementation.init(router);
}

async function exit() {
    if (backend && typeof backend.exit === 'function') await backend.exit();
    backend = null;
}

module.exports = { info, init, exit };
