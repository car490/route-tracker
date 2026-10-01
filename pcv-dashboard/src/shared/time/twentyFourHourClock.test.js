// src/shared/time/twentyFourHourClock.test.js
//
// Times are always 24-hour and UK time (docs/DECISIONS.md "Time format").
// Every clock time the dashboard shows goes through ./timeFormat.js, and
// every time typed in goes through <TimeInput> — the browser's own
// <input type="time"> shows AM/PM on a PC set to US English. This walks the
// dashboard source and fails on any way back to that. Driver and Announce
// have the same guard (busops/tests/twentyFourHourClock.test.js).

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const SCANNED = ['src', 'api', 'index.html']
const HELPERS = new Set([
  path.join('src', 'shared', 'time', 'timeFormat.js'),
])

const RULES = [
  [/\.toLocaleTimeString\(/, 'use formatTime() from src/shared/time/timeFormat.js'],
  [/\bhour12\b/, 'use formatTime(); hour12:false can show midnight as 24:xx'],
  [/hourCycle\s*:\s*['"]h1[12]['"]/, '12-hour clock'],
  [/\.toLocale\w*String\(\s*(\)|\[\]|undefined\b)/, 'leaves the format to the PC\'s language; pass \'en-GB\' or use the helpers'],
  [/\bDate\([^)]*\)\.toLocaleString\(/, 'date and time together: use formatDateTime()'],
  [/\bhour\s*:\s*['"](2-digit|numeric)['"]/, 'formats a clock time by hand: use formatTime()'],
  [/type\s*=\s*\{?\s*["']time["']/, 'the browser\'s time box can show AM/PM: use <TimeInput>'],
  [/type\s*:\s*["']time["']/, 'the browser\'s time box can show AM/PM: use <TimeInput>'],
]

function sourceFiles(rel) {
  const abs = path.join(root, rel)
  if (!fs.existsSync(abs)) return []
  if (fs.statSync(abs).isFile()) return [rel]
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    const child = path.join(rel, e.name)
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : sourceFiles(child)
    return /\.(jsx?|html)$/.test(e.name) && !/\.test\.jsx?$/.test(e.name) ? [child] : []
  })
}

const files = SCANNED.flatMap(sourceFiles).filter((f) => !HELPERS.has(f))

describe('24-hour clock', () => {
  it('finds the dashboard source to check', () => {
    expect(files).toEqual(expect.arrayContaining([
      path.join('src', 'features', 'journeys', 'JourneysPage.jsx'),
      path.join('src', 'features', 'route-planner', 'DeparturesCard.jsx'),
    ]))
  })

  it('no time is formatted outside the helpers, typed into a browser time box, or shown in 12-hour form', () => {
    const found = []
    for (const file of files) {
      fs.readFileSync(path.join(root, file), 'utf8').split('\n').forEach((line, i) => {
        for (const [pattern, why] of RULES) {
          if (pattern.test(line)) found.push(`${file}:${i + 1} ${why}\n    ${line.trim()}`)
        }
      })
    }
    expect(found).toEqual([])
  })

  it('the helpers pin the 24-hour cycle and UK time', () => {
    const helper = fs.readFileSync(path.join(root, 'src', 'shared', 'time', 'timeFormat.js'), 'utf8')
    expect(helper).toMatch(/hourCycle:\s*'h23'/)
    expect(helper).toMatch(/timeZone:\s*'Europe\/London'/)
  })

  it('index.html declares British English', () => {
    expect(fs.readFileSync(path.join(root, 'index.html'), 'utf8')).toMatch(/<html lang="en-GB"/)
  })
})
