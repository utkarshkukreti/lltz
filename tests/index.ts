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

const variants = ['all', '1970', 'now'] as const

const data = fs.readFileSync('data/timezones.lltz')

for (const variant of variants) {
  const get = Lltz.make(data, variant)

  const GeoTz =
    variant === 'all'
      ? await import('geo-tz/all')
      : variant === '1970'
        ? await import('geo-tz')
        : variant === 'now'
          ? await import('geo-tz/now')
          : null

  assert(GeoTz !== null)

  test(`geo-tz: ${variant} (0.125° grid)`, () => {
    const expectedMismatches = {
      all: 217,
      '1970': 216,
      now: 213,
    }[variant]
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
          // console.log(JSON.stringify({ variant, mismatches, latitude, longitude, our, their }))
        }
      }
    }
    assert.equal(mismatches, expectedMismatches)
  })

  test(`geo-tz: ${variant} (random)`, () => {
    const expectedMismatches = {
      all: 1,
      '1970': 1,
      now: 1,
    }[variant]
    const random = splitmix32(0)
    let mismatches = 0
    for (let i = 0; i < (180 * 8 + 1) * (360 * 8 + 1); i++) {
      const latitude = random() * 180 - 90
      const longitude = random() * 360 - 180
      const our = get(latitude, longitude).sort()
      const their = GeoTz.find(latitude, longitude).sort()
      if (our.length !== their.length || our.some((timezone, index) => timezone !== their[index])) {
        mismatches++
        // console.log(JSON.stringify({ variant, mismatches, latitude, longitude, our, their }))
      }
    }
    assert.equal(mismatches, expectedMismatches)
  })
}
