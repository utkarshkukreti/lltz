# lltz (Latitude & Longitude → Time Zone)

A high-performance, memory-efficient offline timezone lookup library for TypeScript using a custom binary format and quadtree spatial indexing.

This library uses GeoJSON data from [timezone-boundary-builder](https://github.com/evansiroky/timezone-boundary-builder).

## Features

- **Fast**: Performs **25-35 million lookups per second** (~30-40ns per op) on an Apple M4 Pro CPU.
- **Tiny Memory Footprint**: Operates directly on raw binary data (ArrayBuffer/Uint8Array). Memory usage is limited to the LLTZ binary file size (approximately **26-44MiB**), with no additional object overhead.
- **Zero Dependencies**: A lightweight, standalone TypeScript library with no external runtime dependencies.
- **Universal**: Runs in both server (Node.js, Bun) and client (browser) environments.
- **High Accuracy**: Validated to match [`geo-tz`](https://www.npmjs.com/package/geo-tz) results in **>99.99%** of cases.

## Usage

### Installation

```bash
pnpm add lltz # or npm, yarn, bun
```

### Data

Three data variants are available, as described in the [timezone-boundary-builder README](https://github.com/evansiroky/timezone-boundary-builder#readme). We recommend `timezones.lltz` for the most comprehensive coverage, which is included in the NPM package.

The other variants, `timezones-1970.lltz` and `timezones-now.lltz`, can be downloaded from the [releases page](https://github.com/utkarshkukreti/lltz/releases) and loaded similarly.

### Node.js / Bun

```typescript
import fs from 'node:fs'

import * as Lltz from 'lltz'

const buffer = fs.readFileSync(new URL(import.meta.resolve('lltz/data/timezones.lltz')))
// ↳ or fs.readFileSync('node_modules/lltz/data/timezones.lltz')
const lookup = Lltz.make(buffer)

const timezones = lookup(40.7128, -74.006) // New York
console.log(timezones) // ['America/New_York']
```

### Browser

```typescript
import * as Lltz from 'lltz'

const response = await fetch('/path/to/timezones.lltz')
const arrayBuffer = await response.arrayBuffer()
const lookup = Lltz.make(arrayBuffer)

console.log(lookup(40.7128, -74.006)) // ['America/New_York']
```

## Architecture

### Binary Format (.lltz)

The LLTZ binary file format is designed for efficient querying on raw bytes. It consists of the following sections:

- **Header**: The first eight bytes are `LLTZ1\0\0\0`.
- **Timezone Strings**: A null-terminated list of timezone IDs.
- **Grid Index**: A 180x360 coarse grid (1-degree resolution) for O(1) access.
- **QuadTree Nodes**: Hierarchical spatial subdivision for complex regions.
- **Polygon Data**: Compressed relative integer coordinates for final containment checks.

### Builder & Runtime

- **Builder (Python)**: Normalizes `timezone-boundary-builder` GeoJSON files to a 1,000,000 scale grid and constructs the spatial index.
- **Runtime (TypeScript)**: Performs an initial O(1) lookup using a coarse grid. For points near boundaries, it falls back to precise point-in-polygon ray-casting. Oceans default to `Etc/GMT` offsets based on 15-degree longitude bands.

## Development

### Data Preparation

To download the latest GeoJSON data and convert it into the optimized LLTZ binary format, run:

> Requires [uv](https://docs.astral.sh/uv/) to be installed.

```bash
make -j
```

### Running Tests

Test lookup results against the `geo-tz` package:

```bash
pnpm test
```

### Benchmarks

Benchmark performance against the `geo-tz` package:

```bash
pnpm bench
```

Benchmark memory usage against the `geo-tz` package:

```bash
pnpm bench:memory
```

## License

MIT for the code, [ODbL for the data](https://github.com/evansiroky/timezone-boundary-builder).
