/**
 * The expected header for the LLTZ binary file format.
 */
const HEADER = 'LLTZ2\0\0\0'

/**
 * The data variants, in the order their timezone mappings are stored in the binary format.
 */
const VARIANTS = ['all', '1970', 'now'] as const

export type Variant = (typeof VARIANTS)[number]

/**
 * The scale factor used to convert floating-point coordinates to integers in the binary format.
 * 1 degree = 1,000,000 units.
 */
const SCALE = 1_000_000

/**
 * Default timezones returned when querying latitude 90 (North Pole).
 * Since lines of longitude converge at the poles, all GMT offsets are technically valid.
 */
const DEFAULT_LATITUDE_90 = [
  'Etc/GMT',
  ...Array.from({ length: 12 }, (_, i) => `Etc/GMT+${i + 1}`),
  ...Array.from({ length: 12 }, (_, i) => `Etc/GMT-${i + 1}`),
]

/**
 * Default timezones returned when querying longitude -180 or 180 (International Date Line).
 * Can be either GMT+12 or GMT-12.
 */
const DEFAULT_LONGITUDE_ABS_180 = ['Etc/GMT+12', 'Etc/GMT-12']

/**
 * 'Etc/GMT' timezone IDs for UTC offsets -12 to +12, indexed by offset + 12.
 */
const ETC_GMT = Array.from({ length: 25 }, (_, index) =>
  index === 12 ? 'Etc/GMT' : index > 12 ? `Etc/GMT-${index - 12}` : `Etc/GMT+${12 - index}`,
)

/**
 * Checks if the point (x, y) is on a polyline chain or if a ray cast from it in the +x direction
 * crosses the chain an odd number of times.
 * @param dataView - The DataView of the binary data.
 * @param x - The integer-scaled x coordinate of the point relative to the cell's base x.
 * @param y - The integer-scaled y coordinate of the point relative to the cell's base y.
 * @param offset - The offset to the first point of the chain.
 * @param pointsCount - The number of points in the chain.
 * @returns 'on' if the point is on the chain, otherwise a boolean indicating if the number of
 * crossings is odd.
 */
const crossChain = (
  dataView: DataView,
  x: number,
  y: number,
  offset: number,
  pointsCount: number,
): 'on' | boolean => {
  let xPrevious = dataView.getUint16(offset, true)
  offset += 2
  let yPrevious = dataView.getUint16(offset, true)
  offset += 2
  let odd = false
  for (let i = 1; i < pointsCount; i++) {
    const xCurrent = dataView.getUint16(offset, true)
    offset += 2
    const yCurrent = dataView.getUint16(offset, true)
    offset += 2
    const dx = xCurrent - xPrevious
    const dy = yCurrent - yPrevious
    const dpx = x - xPrevious
    const dpy = y - yPrevious
    const crossProduct = dx * dpy - dy * dpx
    if (
      crossProduct === 0 &&
      ((x >= xPrevious && x <= xCurrent) || (x >= xCurrent && x <= xPrevious)) &&
      ((y >= yPrevious && y <= yCurrent) || (y >= yCurrent && y <= yPrevious))
    )
      return 'on'
    if (yCurrent > y !== yPrevious > y) {
      if (yCurrent > yPrevious === crossProduct > 0) odd = !odd
    }
    xPrevious = xCurrent
    yPrevious = yCurrent
  }
  return odd
}

export type Lookup =
  /**
   * Returns an array of timezone IDs for the given latitude and longitude.
   * @param latitude - The latitude of the point in degrees (-90 to 90).
   * @param longitude - The longitude of the point in degrees (-180 to 180).
   * @throws An error if the latitude or longitude is out of range.
   * @returns An array of timezone IDs. For points in unmapped areas (e.g., oceans), returns
   * 'Etc/GMT'-based timezones.
   */
  (latitude: number, longitude: number) => string[]

/**
 * Creates a timezone lookup function from the provided binary data.
 *
 * @param arrayBufferOrUint8Array - The binary data containing the timezone database (LLTZ format).
 * @param variant - The data variant to use: 'all' (default), '1970' or 'now'.
 * @returns {Lookup} A timezone lookup function.
 * @throws An error if the binary data or the variant is invalid.
 */
export const make = (
  arrayBufferOrUint8Array: ArrayBuffer | Uint8Array,
  variant: Variant = 'all',
): Lookup => {
  const bytes = ArrayBuffer.isView(arrayBufferOrUint8Array)
    ? arrayBufferOrUint8Array
    : new Uint8Array(arrayBufferOrUint8Array)
  const dataView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 0
  for (let i = 0; i < HEADER.length; i++) {
    if (dataView.getUint8(offset + i) !== HEADER.charCodeAt(i)) {
      throw new Error(`invalid file format: missing header ${JSON.stringify(HEADER)}`)
    }
  }
  offset += HEADER.length
  const timezonesLength = dataView.getUint16(offset, true)
  offset += 2
  const names = new TextDecoder()
    .decode(bytes.subarray(offset, offset + timezonesLength))
    .split('\0')
  offset += timezonesLength
  const variantIndex = VARIANTS.indexOf(variant)
  if (variantIndex === -1) throw new Error(`invalid variant: ${JSON.stringify(variant)}`)
  const mappingOffset = offset + variantIndex * names.length * 2
  const timezones = names.map(
    (_, index) => names[dataView.getUint16(mappingOffset + index * 2, true)]!,
  )
  offset += VARIANTS.length * names.length * 2
  const offsetsOffset = offset
  offset += 180 * 360 * 4
  const baseOffset = offset
  return (latitude: number, longitude: number): string[] => {
    if (!(latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180))
      throw new Error(`invalid latitude or longitude: ${latitude}, ${longitude}`)
    const latitudeIndex = Math.min((latitude + 90) | 0, 179)
    const longitudeIndex = Math.min((longitude + 180) | 0, 359)
    let value = dataView.getUint32(offsetsOffset + (latitudeIndex * 360 + longitudeIndex) * 4, true)
    let tag = value >>> 30
    if (tag === 1) {
      return [timezones[value & ((1 << 30) - 1)]!]
    }
    if (tag !== 0) {
      const latitudeInteger = ((latitude + 90) * SCALE + 0.5) | 0
      const longitudeInteger = ((longitude + 180) * SCALE + 0.5) | 0
      let offset = 0
      let xMin = longitudeIndex * SCALE
      let yMin = latitudeIndex * SCALE
      let xMax = xMin + SCALE
      let yMax = yMin + SCALE
      while (tag === 3) {
        offset = baseOffset + (value & ((1 << 30) - 1))
        const xMid = (xMin + xMax) >> 1
        const yMid = (yMin + yMax) >> 1
        const quadtreeIndex =
          ((latitudeInteger >= yMid ? 1 : 0) << 1) | (longitudeInteger >= xMid ? 1 : 0)
        value = dataView.getUint32(offset + quadtreeIndex * 4, true)
        tag = value >>> 30
        latitudeInteger >= yMid ? (yMin = yMid) : (yMax = yMid)
        longitudeInteger >= xMid ? (xMin = xMid) : (xMax = xMid)
      }
      if (tag === 1) {
        return [timezones[value & ((1 << 30) - 1)]!]
      } else if (tag === 2) {
        offset = baseOffset + (value & ((1 << 30) - 1))
        const count = dataView.getUint8(offset)
        offset += 1
        const indexesOffset = offset
        offset += count * 2
        const chainsCount = dataView.getUint16(offset, true)
        offset += 2
        const x = longitudeInteger - xMin
        const y = latitudeInteger - yMin
        let inside = 0
        let on = 0
        for (let i = 0; i < chainsCount; i++) {
          const insideMask = dataView.getUint8(offset)
          offset += 1
          const onMask = dataView.getUint8(offset)
          offset += 1
          const pointsCount = dataView.getUint16(offset, true)
          offset += 2
          const where = crossChain(dataView, x, y, offset, pointsCount)
          if (where === 'on') on |= onMask
          else if (where) inside ^= insideMask
          offset += pointsCount * 4
        }
        const output: string[] = []
        for (let i = 0; i < count; i++) {
          if (((inside | on) >> i) & 1) {
            const timezone = timezones[dataView.getUint16(indexesOffset + i * 2, true)]!
            if (!output.includes(timezone)) output.push(timezone)
          }
        }
        if (output.length > 0) return output
      }
    }
    if (latitude === 90) {
      return DEFAULT_LATITUDE_90
    } else if (longitude === -180 || longitude === 180) {
      return DEFAULT_LONGITUDE_ABS_180
    } else {
      const min = Math.ceil(longitude / 15 - 0.5)
      const max = Math.floor(longitude / 15 + 0.5)
      return ETC_GMT.slice(min + 12, max + 13)
    }
  }
}
