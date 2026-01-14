import assert from 'node:assert'
import fs from 'node:fs'
import test from 'node:test'

import * as Lltz from '../src/index.ts'

// https://github.com/bryc/code/blob/da36a3e07acfbd07f930a9212a2df9e854ff56e4/jshash/PRNGs.md#splitmix32
const splitmix32 = (a: number) => () => {
  a |= 0
  a = (a + 0x9e3779b9) | 0
  let t = a ^ (a >>> 16)
  t = Math.imul(t, 0x21f0aaad)
  t = t ^ (t >>> 15)
  t = Math.imul(t, 0x735a2d97)
  return ((t = t ^ (t >>> 15)) >>> 0) / 4294967296
}

const names = ['timezones', 'timezones-1970', 'timezones-now'] as const

for (const name of names) {
  const get = Lltz.make(fs.readFileSync(`data/${name}.lltz`))

  const GeoTz =
    name === 'timezones'
      ? await import('geo-tz/all')
      : name === 'timezones-1970'
        ? await import('geo-tz')
        : name === 'timezones-now'
          ? await import('geo-tz/now')
          : null

  assert(GeoTz !== null)

  test(`geo-tz: ${name} (0.125° grid)`, () => {
    const expectedMismatches = {
      timezones: 217,
      'timezones-1970': 216,
      'timezones-now': 213,
    }[name]
    let mismatches = 0
    for (let latitude = -90; latitude <= 90; latitude += 1 / 8) {
      for (let longitude = -180; longitude <= 180; longitude += 1 / 8) {
        const our = get(latitude, longitude).sort()
        const their = GeoTz.find(latitude, longitude).sort()
        if (
          our.length !== their.length ||
          our.some((timezone, index) => timezone !== their[index])
        ) {
          mismatches++
          // console.log(JSON.stringify({ name, mismatches, latitude, longitude, our, their }))
        }
      }
    }
    assert.equal(mismatches, expectedMismatches)
  })

  test(`geo-tz: ${name} (random)`, () => {
    const expectedMismatches = {
      timezones: 1,
      'timezones-1970': 1,
      'timezones-now': 1,
    }[name]
    const random = splitmix32(0)
    let mismatches = 0
    for (let i = 0; i < (180 * 8 + 1) * (360 * 8 + 1); i++) {
      const latitude = random() * 180 - 90
      const longitude = random() * 360 - 180
      const our = get(latitude, longitude).sort()
      const their = GeoTz.find(latitude, longitude).sort()
      if (our.length !== their.length || our.some((timezone, index) => timezone !== their[index])) {
        mismatches++
        // console.log(JSON.stringify({ name, mismatches, latitude, longitude, our, their }))
      }
    }
    assert.equal(mismatches, expectedMismatches)
  })
}
