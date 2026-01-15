import fs from 'node:fs'

import { make as make_, type Lookup } from './index.ts'

const load = (): Uint8Array => {
  try {
    return fs.readFileSync(new URL(import.meta.resolve('lltz/data/timezones.lltz')))
  } catch {}
  try {
    return fs.readFileSync(new URL('../data/timezones.lltz', import.meta.url))
  } catch {}
  try {
    return fs.readFileSync('node_modules/lltz/data/timezones.lltz')
  } catch {}
  throw new Error('failed to load built-in timezones.lltz file')
}

/**
 * Creates a timezone lookup function from the provided binary data.
 *
 * @param arrayBufferOrUint8Array - Optional binary data containing the timezone database (LLTZ
 * format). If not provided, the built-in `timezones.lltz` file will be automatically loaded.
 * @returns {Lookup} A timezone lookup function.
 * @throws An error if the binary data is invalid or if the built-in data file cannot be loaded.
 */
export const make = (arrayBufferOrUint8Array?: ArrayBuffer | Uint8Array): Lookup =>
  make_(arrayBufferOrUint8Array ?? load())

export type { Lookup }
