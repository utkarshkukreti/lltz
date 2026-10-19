import fs from 'node:fs'

import { make as make_, type Lookup, type Variant } from './index.ts'

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
 * Creates a timezone lookup function from the built-in `timezones.lltz` file.
 *
 * @param variant - The data variant to use: 'all' (default), '1970' or 'now'.
 * @returns {Lookup} A timezone lookup function.
 * @throws An error if the variant is invalid or if the built-in data file cannot be loaded.
 */
export const make = (variant?: Variant): Lookup => make_(load(), variant)

export type { Lookup, Variant }
