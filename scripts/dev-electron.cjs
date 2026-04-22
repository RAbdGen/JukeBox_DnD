#!/usr/bin/env node
// Lance Electron en mode dev avec --no-sandbox (requis sur Linux sans SUID sandbox configuré)
// et reloade sur changements de fichiers comme electronmon.

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const electronPath = require('electron');
const root = path.resolve(__dirname, '..');

function launch() {
    const proc = spawn(electronPath, ['--no-sandbox', '.'], {
        cwd: root,
        stdio: 'inherit',
        env: { ...process.env, NODE_ENV: 'development' },
    });

    proc.on('exit', (code, signal) => {
        if (signal !== 'SIGTERM') {
            console.log(`[dev-electron] app exited (${signal || code}), watching for changes...`);
        }
    });

    return proc;
}

let proc = launch();

// Reload basique sur changements dans electron/ et backend/
const watchDirs = [path.join(root, 'electron'), path.join(root, 'backend')];
let debounce;

watchDirs.forEach(dir => {
    if (!fs.existsSync(dir)) return;
    fs.watch(dir, { recursive: true }, () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
            console.log('[dev-electron] changement détecté, relance...');
            proc.kill();
            proc = launch();
        }, 300);
    });
});
