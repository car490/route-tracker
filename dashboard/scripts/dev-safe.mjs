import net from 'node:net'
import readline from 'node:readline'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = 5173
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const binDir = path.join(rootDir, 'node_modules', '.bin')
const VITE_BIN = process.platform === 'win32' ? path.join(binDir, 'vite.cmd') : path.join(binDir, 'vite')
const KILL_PORT_BIN = process.platform === 'win32' ? path.join(binDir, 'kill-port.cmd') : path.join(binDir, 'kill-port')

function q(value) {
  return `"${value.replaceAll('"', '\\"')}"`
}

function canConnect(port, host) {
  return new Promise(resolve => {
    const socket = net.createConnection({ port, host })
    socket.setTimeout(500)

    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })

    socket.once('timeout', () => {
      socket.destroy()
      resolve(false)
    })

    socket.once('error', () => {
      resolve(false)
    })
  })
}

async function isPortInUse(port) {
  const [ipv4, ipv6] = await Promise.all([
    canConnect(port, '127.0.0.1'),
    canConnect(port, '::1'),
  ])
  return ipv4 || ipv6
}

function ask(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close()
      resolve(answer)
    })
  })
}

function run(commandLine) {
  const child = spawn(commandLine, {
    stdio: 'inherit',
    shell: true,
    cwd: rootDir,
  })

  child.on('error', err => {
    console.error(err)
    process.exit(1)
  })

  child.on('exit', code => {
    process.exit(code ?? 0)
  })
}

function runAndWait(commandLine) {
  return new Promise((resolve, reject) => {
    const child = spawn(commandLine, {
      stdio: 'inherit',
      shell: true,
      cwd: rootDir,
    })

    child.on('error', reject)
    child.on('exit', code => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${command} exited with code ${code}`))
      }
    })
  })
}

async function main() {
  const viteCommand = `${q(VITE_BIN)} --port ${PORT} --strictPort`
  const killCommand = `${q(KILL_PORT_BIN)} ${PORT}`

  const inUse = await isPortInUse(PORT)

  if (inUse) {
    const answer = (await ask(`Port ${PORT} is in use. Kill process and continue? (y/N) `)).trim().toLowerCase()
    if (answer !== 'y' && answer !== 'yes') {
      console.log('Aborted. Port was not killed.')
      process.exit(1)
    }

    await runAndWait(killCommand)
    run(viteCommand)
    return
  }

  run(viteCommand)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
