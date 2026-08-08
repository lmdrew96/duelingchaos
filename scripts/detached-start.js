#!/usr/bin/env node
// Spawns dist/index.js into its own session via `detached: true` (setsid on
// POSIX) instead of relying on plain `nohup ... &` from bash. nohup only
// blocks SIGHUP; it doesn't give the child a new process group. Launched
// from a WebStorm Run Configuration, the backend stayed in the same pgid
// WebStorm created for the whole "npm run backend:start" invocation, and
// WebStorm kills that entire group once the root command exits — silently
// taking the still-loading backend down with it, with no error to log.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const logFd = fs.openSync(path.join(root, 'backend.log'), 'a');

const child = spawn('node', ['dist/index.js'], {
  cwd: root,
  detached: true,
  stdio: ['ignore', logFd, logFd],
});
child.unref();
fs.writeFileSync(path.join(root, '.backend.pid'), String(child.pid));
