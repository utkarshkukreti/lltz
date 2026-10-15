import assert from 'node:assert'
import fs from 'node:fs'

let library: 'lltz' | 'geo-tz' | null = null

let variant: 'all' | '1970' | 'now' | null = null

const [library_, variant_] = (process.argv[2] ?? '').split(':')

switch (library_) {
  case 'lltz':
  case 'geo-tz':
    library = library_
    break
}

switch (variant_) {
  case 'all':
  case '1970':
  case 'now':
    variant = variant_
    break
}

if (library === null || variant === null) {
  console.error('usage: node benches/memory.ts <library>:<variant>')
  process.exit(1)
}

console.log(`${library}: ${variant}`)

const memoryUsageBefore = process.memoryUsage()
const timeBefore = performance.now()

const get =
  library === 'lltz'
    ? (await import('../src/index.ts')).make(fs.readFileSync('data/timezones.lltz'), variant)
    : variant === 'all'
      ? (await import('geo-tz/all')).find
      : variant === '1970'
        ? (await import('geo-tz')).find
        : variant === 'now'
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
