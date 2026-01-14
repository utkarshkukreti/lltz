/**
 * The expected header for the LLTZ binary file format.
 */
const HEADER = 'LLTZ1\0\0\0'

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
 * Checks if the point (x, y) is inside or on the boundary of a polygon ring using the ray casting
 * algorithm.
 * @param dataView - The DataView of the binary data.
 * @param x - The integer-scaled x coordinate of the point relative to the polygon's base x.
 * @param y - The integer-scaled y coordinate of the point relative to the polygon's base y.
 * @param offset - The offset to the start of the polygon ring.
 * @returns A tuple containing a status ('in' | 'on' | false) indicating if the point is inside, on
 * the boundary, or outside the ring, and the offset to the next polygon ring.
 */
const isPointInOrOnRing = (
  dataView: DataView,
  x: number,
  y: number,
  offset: number,
): ['in' | 'on' | false, number] => {
  const pointsCount = dataView.getUint16(offset, true)
  offset += 2
  let xPrevious = dataView.getUint16(offset, true)
  offset += 2
  let yPrevious = dataView.getUint16(offset, true)
  offset += 2
  const xFirst = xPrevious
  const yFirst = yPrevious
  let inside = false
  for (let i = 1; i <= pointsCount; i++) {
    let xCurrent = xFirst
    let yCurrent = yFirst
    if (i < pointsCount) {
      xCurrent = dataView.getUint16(offset, true)
      offset += 2
      yCurrent = dataView.getUint16(offset, true)
      offset += 2
    }
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
      return ['on', offset]
    if (yCurrent > y !== yPrevious > y) {
      if (yCurrent > yPrevious === crossProduct > 0) inside = !inside
    }
    xPrevious = xCurrent
    yPrevious = yCurrent
  }
  return [inside ? 'in' : false, offset]
}

/**
 * Checks if the point (x, y) is inside a polygon, accounting for holes (inner rings).
 * @param dataView - The DataView of the binary data.
 * @param x - The integer-scaled x coordinate of the point.
 * @param y - The integer-scaled y coordinate of the point.
 * @param offset - The offset to the start of the polygon.
 * @param xMinBase - The integer-scaled base x coordinate of the polygon.
 * @param yMinBase - The integer-scaled base y coordinate of the polygon.
 * @returns A tuple containing a boolean indicating if the point is inside or on the boundary of the
 * polygon and the offset to the next polygon.
 */
const isPointInPolygon = (
  dataView: DataView,
  x: number,
  y: number,
  offset: number,
  xMinBase: number,
  yMinBase: number,
): [boolean, number] => {
  const size = dataView.getUint16(offset, true)
  offset += 2
  const nextPolygonOffset = offset + size
  const ringsCount = dataView.getUint8(offset)
  offset += 1
  const xMin = dataView.getUint16(offset, true) + xMinBase
  offset += 2
  const xMax = dataView.getUint16(offset, true) + xMinBase
  offset += 2
  const yMin = dataView.getUint16(offset, true) + yMinBase
  offset += 2
  const yMax = dataView.getUint16(offset, true) + yMinBase
  offset += 2
  if (x < xMin || x > xMax || y < yMin || y > yMax) return [false, nextPolygonOffset]
  const [where, nextRingOffset] = isPointInOrOnRing(dataView, x - xMinBase, y - yMinBase, offset)
  if (where !== 'in') return [where === 'on', nextPolygonOffset]
  offset = nextRingOffset
  for (let i = 1; i < ringsCount; i++) {
    const [where, nextRingOffset] = isPointInOrOnRing(dataView, x - xMinBase, y - yMinBase, offset)
    if (where !== false) return [where === 'on', nextPolygonOffset]
    offset = nextRingOffset
  }
  return [true, nextPolygonOffset]
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
 * @returns {Lookup} A timezone lookup function.
 * @throws An error if the binary data is invalid.
 */
export const make = (arrayBufferOrUint8Array: ArrayBuffer | Uint8Array): Lookup => {
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
  const timezones = new TextDecoder()
    .decode(bytes.subarray(offset, offset + timezonesLength))
    .split('\0')
  offset += timezonesLength
  const offsetsOffset = offset
  offset += 180 * 360 * 4
  const baseOffset = offset
  return (latitude: number, longitude: number): string[] => {
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180)
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
      let offset = baseOffset
      let xMin = longitudeIndex * SCALE
      let yMin = latitudeIndex * SCALE
      let xMax = xMin + SCALE
      let yMax = yMin + SCALE
      while (tag === 3) {
        offset += value & ((1 << 30) - 1)
        const xMid = (xMin + xMax) >> 1
        const yMid = (yMin + yMax) >> 1
        const quadtreeIndex =
          ((latitudeInteger >= yMid ? 1 : 0) << 1) | (longitudeInteger >= xMid ? 1 : 0)
        value = dataView.getUint32(offset + quadtreeIndex * 4, true)
        tag = value >>> 30
        offset += 16
        latitudeInteger >= yMid ? (yMin = yMid) : (yMax = yMid)
        longitudeInteger >= xMid ? (xMin = xMid) : (xMax = xMid)
      }
      if (tag === 1) {
        return [timezones[value & ((1 << 30) - 1)]!]
      } else if (tag === 2) {
        const output: string[] = []
        offset += value & ((1 << 30) - 1)
        const count = dataView.getUint8(offset)
        offset += 1
        for (let i = 0; i < count; i++) {
          const index = dataView.getUint16(offset, true)
          offset += 2
          const polygonsCount = dataView.getUint8(offset)
          offset += 1
          for (let j = 0; j < polygonsCount; j++) {
            const [isIn, offset_] = isPointInPolygon(
              dataView,
              longitudeInteger,
              latitudeInteger,
              offset,
              xMin,
              yMin,
            )
            offset = offset_
            if (isIn) {
              output.push(timezones[index]!)
              for (let k = j + 1; k < polygonsCount; k++) {
                offset += 2 + dataView.getUint16(offset, true)
              }
              break
            }
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
      const output: string[] = []
      const min = Math.ceil(longitude / 15 - 0.5)
      const max = Math.floor(longitude / 15 + 0.5)
      for (let n = min; n <= max; n++) {
        output.push(n === 0 ? 'Etc/GMT' : n > 0 ? `Etc/GMT-${n}` : `Etc/GMT+${-n}`)
      }
      return output
    }
  }
}
