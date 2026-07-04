#!/usr/bin/env node
// Bumps the solution-wide VERSION and syncs it into every place that displays
// or cache-busts on it. Run manually as part of the develop -> master merge:
//
//   node scripts/release.mjs <major|minor|patch>
//
// Then review CHANGELOG.md, commit, tag, and push:
//
//   git add -A
//   git commit -m "chore: release vX.Y.Z"
//   git tag vX.Y.Z
//   git push && git push --tags

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { execSync } from 'node:child_process'

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..')
const bump = process.argv[2]

if (!['major', 'minor', 'patch'].includes(bump)) {
  console.error('Usage: node scripts/release.mjs <major|minor|patch>')
  process.exit(1)
}

const versionPath = path.join(ROOT, 'VERSION')
const current = readFileSync(versionPath, 'utf8').trim()
const [maj, min, pat] = current.split('.').map(Number)

let next
if (bump === 'major') next = `${maj + 1}.0.0`
else if (bump === 'minor') next = `${maj}.${min + 1}.0`
else next = `${maj}.${min}.${pat + 1}`

writeFileSync(versionPath, `${next}\n`)

// dashboard/package.json
const pkgPath = path.join(ROOT, 'dashboard/package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
pkg.version = next
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)

// service-worker.js cache name
const swPath = path.join(ROOT, 'service-worker.js')
const sw = readFileSync(swPath, 'utf8')
const swNext = sw.replace(
  /const CACHE_NAME = '[^']*'/,
  `const CACHE_NAME = 'route-tracker-v${next}'`,
)
writeFileSync(swPath, swNext)

// index.html footer version string
const htmlPath = path.join(ROOT, 'index.html')
const html = readFileSync(htmlPath, 'utf8')
const htmlNext = html.replace(
  />v[^<]*?<\/p>/,
  `>v${next}</p>`,
)
writeFileSync(htmlPath, htmlNext)

// CHANGELOG.md — prepend a new section, listing commits since the last tag
let lastTag = null
try {
  lastTag = execSync('git describe --tags --abbrev=0', { cwd: ROOT }).toString().trim()
} catch {
  // no tags yet
}

let commitLines = []
try {
  const range = lastTag ? `${lastTag}..HEAD` : 'HEAD'
  const log = execSync(`git log ${range} --oneline --no-merges`, { cwd: ROOT }).toString().trim()
  commitLines = log ? log.split('\n').map(l => `- ${l.replace(/^[0-9a-f]+\s/, '')}`) : []
} catch {
  // ignore
}

const today = new Date().toISOString().slice(0, 10)
const changelogPath = path.join(ROOT, 'CHANGELOG.md')
const changelog = readFileSync(changelogPath, 'utf8')
const newSection = `## [${next}] - ${today}\n\n${commitLines.length ? commitLines.join('\n') : '- (fill in release notes)'}\n\n`
const changelogNext = changelog.replace(
  '# Changelog\n',
  match => match, // keep header
).replace(
  /(## \[)/,
  `${newSection}$1`,
)
writeFileSync(changelogPath, changelogNext)

console.log(`Bumped version ${current} -> ${next}`)
console.log('Updated: VERSION, dashboard/package.json, service-worker.js, index.html, CHANGELOG.md')
console.log('')
console.log('Next steps:')
console.log('  1. Edit CHANGELOG.md — tidy up the auto-generated commit list under the new heading')
console.log('  2. git add -A && git commit -m "chore: release v' + next + '"')
console.log('  3. git tag v' + next)
console.log('  4. git push && git push --tags')
