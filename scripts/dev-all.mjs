#!/usr/bin/env node
// Starts every local service needed for Dev (Local): driver PWA server,
// dashboard dev server, and the local GraphHopper routing instance.
// Kills anything already bound to their ports first, so re-running this
// after a crashed/orphaned process always gets a clean start.
//
//   node scripts/dev-all.mjs
//
// Ctrl-C stops all three together.

import { execSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..')
const IS_WIN = process.platform === 'win32'

function freePort(port) {
  try {
    if (IS_WIN) {
      const out = execSync(`netstat -ano | findstr :${port}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString()
      const pids = new Set(
        out.split('\n')
          .filter(line => new RegExp(`:${port}\\s`).test(line))
          .map(line => line.trim().split(/\s+/).pop())
          .filter(pid => pid && /^\d+$/.test(pid)),
      )
      for (const pid of pids) {
        try { execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' }) } catch {}
      }
    } else {
      const out = execSync(`lsof -ti:${port}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
      if (out) execSync(`kill -9 ${out.split('\n').join(' ')}`, { stdio: 'ignore' })
    }
  } catch {
    // nothing was listening on this port — fine
  }
}

const SERVICES = [
  {
    name: 'graphhopper',
    color: 35, // magenta
    ports: [8989, 8990],
    cwd: path.join(ROOT, 'graphhopper'),
    cmd: 'java',
    args: ['-jar', 'graphhopper-web-11.0.jar', 'server', 'config.yml'],
  },
  {
    name: 'dashboard',
    color: 36, // cyan
    ports: [5173],
    cwd: path.join(ROOT, 'dashboard'),
    cmd: IS_WIN ? 'npm.cmd' : 'npm',
    args: ['run', 'dev'],
  },
  {
    name: 'pwa',
    color: 32, // green
    ports: [8080],
    cwd: ROOT,
    cmd: 'node',
    args: ['server.js'],
  },
]

function prefixedLog(name, color, chunk) {
  const lines = chunk.toString().split('\n').filter(l => l.length > 0)
  for (const line of lines) {
    console.log(`\x1b[${color}m[${name}]\x1b[0m ${line}`)
  }
}

console.log('Clearing existing processes on known ports…')
for (const svc of SERVICES) {
  for (const port of svc.ports) freePort(port)
}

const children = []

for (const svc of SERVICES) {
  const child = spawn(svc.cmd, svc.args, { cwd: svc.cwd, shell: IS_WIN })
  child.stdout.on('data', d => prefixedLog(svc.name, svc.color, d))
  child.stderr.on('data', d => prefixedLog(svc.name, svc.color, d))
  child.on('exit', code => prefixedLog(svc.name, svc.color, `exited (${code})`))
  children.push(child)
  console.log(`Started ${svc.name} (pid ${child.pid})`)
}

console.log('')
console.log('driver PWA  → http://localhost:8080')
console.log('dashboard   → http://localhost:5173')
console.log('graphhopper → http://127.0.0.1:8989')
console.log('')
console.log('Ctrl-C to stop all three.')

function shutdown() {
  console.log('\nStopping all services…')
  for (const child of children) {
    if (IS_WIN) {
      try { execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' }) } catch {}
    } else {
      child.kill('SIGTERM')
    }
  }
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
