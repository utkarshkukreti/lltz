import assert from 'node:assert'
import fs from 'node:fs'

import { Bench } from 'tinybench'

const libraries = ['lltz', 'geo-tz'] as const

const names = ['timezones', 'timezones-1970', 'timezones-now'] as const

const bench = new Bench()

const only = process.argv.slice(2)

for (const library of libraries) {
  for (const name of names) {
    if (only.length > 0 && !only.includes(`${library}:${name}`)) continue

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

    bench.add(`${library}: ${name}: 1000x <random>`, () => {
      for (let i = 0; i < 1000; i++) {
        const latitude = Math.random() * 180 - 90
        const longitude = Math.random() * 360 - 180
        get(latitude, longitude)
      }
    })

    // Latitude: 35 to 45, Longitude -85 to -115.
    bench.add(`${library}: ${name}: 1000x <random> in central US`, () => {
      for (let i = 0; i < 1000; i++) {
        const latitude = Math.random() * 10 + 35
        const longitude = Math.random() * 30 - 85
        get(latitude, longitude)
      }
    })
  }
}

await bench.run()

console.table(bench.table())
