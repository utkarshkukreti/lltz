# lltz (Latitude & Longitude → Time Zone)

A high-performance, memory-efficient offline timezone lookup library for TypeScript using a custom binary format and quadtree spatial indexing.

This library uses GeoJSON data from [timezone-boundary-builder](https://github.com/evansiroky/timezone-boundary-builder).

## Features

- **Fast**: Performs **28-47 million lookups per second** (~22-36ns per op) on an Apple M4 Pro CPU.
- **Tiny Memory Footprint**: Operates directly on raw binary data (ArrayBuffer/Uint8Array). Memory usage is limited to the LLTZ binary file size (approximately **29MiB**), with no additional object overhead.
- **Zero Dependencies**: A lightweight, standalone TypeScript library with no external runtime dependencies.
- **Universal**: Runs in both server (Node.js, Bun) and client (browser) environments.
- **High Accuracy**: Validated to match [`geo-tz`](https://www.npmjs.com/package/geo-tz) results in **>99.99%** of cases.

## Performance

The `benches` directory contains performance benchmarks comparing `lltz` with `geo-tz`. These are the performance numbers obtained on Node 24.18.0 on an Apple M4 Pro CPU.

### CPU

```
$ node benches/index.ts lltz:all geo-tz:all
┌─────────┬─────────────────────────────────────────────┬───────────────────┬───────────────────┬────────────────────────┬────────────────────────┬─────────┐
│ (index) │ Task name                                   │ Latency avg (ns)  │ Latency med (ns)  │ Throughput avg (ops/s) │ Throughput med (ops/s) │ Samples │
├─────────┼─────────────────────────────────────────────┼───────────────────┼───────────────────┼────────────────────────┼────────────────────────┼─────────┤
│ 0       │ 'lltz: all: 1000x <random>'                 │ '36212 ± 0.28%'   │ '35584 ± 1624.0'  │ '28026 ± 0.10%'        │ '28103 ± 1273'         │ 27616   │
│ 1       │ 'lltz: all: 1000x <random> in central US'   │ '21585 ± 0.21%'   │ '21292 ± 875.00'  │ '46990 ± 0.08%'        │ '46966 ± 1937'         │ 46329   │
│ 2       │ 'geo-tz: all: 1000x <random>'               │ '1355153 ± 5.49%' │ '974479 ± 333396' │ '1032 ± 3.43%'         │ '1026 ± 396'           │ 738     │
│ 3       │ 'geo-tz: all: 1000x <random> in central US' │ '310248 ± 1.02%'  │ '299292 ± 15750'  │ '3314 ± 0.38%'         │ '3341 ± 177'           │ 3224    │
└─────────┴─────────────────────────────────────────────┴───────────────────┴───────────────────┴────────────────────────┴────────────────────────┴─────────┘
```

lltz is roughly 27x faster than geo-tz for random lookups in the entire world and 14x faster for random lookups in the central US.

### Memory

```
$ node benches/memory.ts lltz:all && node benches/memory.ts geo-tz:all
lltz: all
Δ time: 53.102 ms
Δ rss: 41.656 MiB
Δ heapTotal: 3.750 MiB
Δ heapUsed: 1.133 MiB
Δ external: 26.640 MiB
Δ arrayBuffers: 26.476 MiB
geo-tz: all
Δ time: 1484.815 ms
Δ rss: 1622.578 MiB
Δ heapTotal: 1566.344 MiB
Δ heapUsed: 1485.296 MiB
Δ external: -1.802 MiB
Δ arrayBuffers: -1.841 MiB
```

Loading the data from disk and then querying 1 million random points is 28x faster with lltz than with geo-tz and uses 39x less memory.

## Usage

### Installation

```bash
pnpm add lltz # or npm, yarn, bun
```

### Data

The `timezones.lltz` file included in the NPM package contains all three data variants described in the [timezone-boundary-builder README](https://github.com/evansiroky/timezone-boundary-builder#readme): `all` (`timezones.geojson`, the default, with the most comprehensive coverage), `1970` (`timezones-1970.geojson`) and `now` (`timezones-now.geojson`). Pick one with the second argument of `make`:

```typescript
const lookup = Lltz.make(buffer, 'now')
```

### Node.js / Bun

#### Simple Usage

```typescript
import * as Lltz from 'lltz/server'

const lookup = Lltz.make() // Automatically loads the built-in timezones.lltz file
// ↳ or Lltz.make(undefined, '1970')

const timezones = lookup(40.7128, -74.006) // New York
console.log(timezones) // ['America/New_York']
```

#### Manual Data Loading

If you need to use a different data file or have custom requirements:

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

- **Header**: The first eight bytes are `LLTZ2\0\0\0`.
- **Timezone Strings**: A null-terminated list of timezone IDs.
- **Variant Mappings**: For each variant (`all`, `1970`, `now`), the index of the timezone ID each timezone maps to in that variant.
- **Grid Index**: A 180x360 coarse grid (1-degree resolution) for O(1) access.
- **QuadTree Nodes**: Hierarchical spatial subdivision for complex regions.
- **Boundary Chains**: Polylines of relative integer coordinates, each stored once and shared by the timezones on both sides, for final containment checks.

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
