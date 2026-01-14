import assert from 'node:assert'
import fs from 'node:fs'

let library: 'lltz' | 'geo-tz' | null = null

let name: 'timezones' | 'timezones-1970' | 'timezones-now' | null = null

const [library_, name_] = (process.argv[2] ?? '').split(':')

switch (library_) {
  case 'lltz':
  case 'geo-tz':
    library = library_
    break
}

switch (name_) {
  case 'timezones':
  case 'timezones-1970':
  case 'timezones-now':
    name = name_
    break
}

if (library === null || name === null) {
  console.error('usage: node benches/memory.ts <library> <name>')
  process.exit(1)
}

console.log(`${library}: ${name}`)

const memoryUsageBefore = process.memoryUsage()
const timeBefore = performance.now()

const get =
  library === 'lltz'
    ? (await import('../src/index.ts')).make(fs.readFileSync(`data/${name}.lltz`))
    : name === 'timezones'
      ? (await import('geo-tz/all')).find
      : name === 'timezones-1970'
        ? (await import('geo-tz')).find
        : name === 'timezones-now'
          ? (await import('geo-tz/now')).find
          : null

assert(get !== null)

for (let i = 0; i < 1_000_000; i++) {
  const latitude = Math.random() * 180 - 90
  const longitude = Math.random() * 360 - 180
  get(latitude, longitude)
}

const timeAfter = performance.now()
const memoryUsageAfter = process.memoryUsage()

console.log(`Δ time: ${(timeAfter - timeBefore).toFixed(3)} ms`)

for (const key of ['rss', 'heapTotal', 'heapUsed', 'external', 'arrayBuffers'] as const) {
  console.log(
    `Δ ${key}: ${((memoryUsageAfter[key] - memoryUsageBefore[key]) / 1024 / 1024).toFixed(3)} MiB`,
  )
}
