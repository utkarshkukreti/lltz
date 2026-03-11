# lltz (Latitude & Longitude → Time Zone)

A high-performance, memory-efficient offline timezone lookup library for TypeScript using a custom binary format and quadtree spatial indexing.

This library uses GeoJSON data from [timezone-boundary-builder](https://github.com/evansiroky/timezone-boundary-builder).

## Features

- **Fast**: Performs **25-35 million lookups per second** (~30-40ns per op) on an Apple M4 Pro CPU.
- **Tiny Memory Footprint**: Operates directly on raw binary data (ArrayBuffer/Uint8Array). Memory usage is limited to the LLTZ binary file size (approximately **26-44MiB**), with no additional object overhead.
- **Zero Dependencies**: A lightweight, standalone TypeScript library with no external runtime dependencies.
- **Universal**: Runs in both server (Node.js, Bun) and client (browser) environments.
- **High Accuracy**: Validated to match [`geo-tz`](https://www.npmjs.com/package/geo-tz) results in **>99.99%** of cases.

## Performance

The `benches` directory contains performance benchmarks comparing `lltz` with `geo-tz`. These are the performance numbers obtained on Node 24.13.0 on an Apple M4 Pro CPU.

### CPU

```
$ node benches/index.ts lltz:timezones geo-tz:timezones
┌─────────┬───────────────────────────────────────────────────┬───────────────────┬────────────────────┬────────────────────────┬────────────────────────┬─────────┐
│ (index) │ Task name                                         │ Latency avg (ns)  │ Latency med (ns)   │ Throughput avg (ops/s) │ Throughput med (ops/s) │ Samples │
├─────────┼───────────────────────────────────────────────────┼───────────────────┼────────────────────┼────────────────────────┼────────────────────────┼─────────┤
│ 0       │ 'lltz: timezones: 1000x <random>'                 │ '41876 ± 0.20%'   │ '41250 ± 1458.0'   │ '24112 ± 0.10%'        │ '24242 ± 851'          │ 23880   │
│ 1       │ 'lltz: timezones: 1000x <random> in central US'   │ '31205 ± 0.23%'   │ '30791 ± 583.00'   │ '32386 ± 0.07%'        │ '32477 ± 626'          │ 32047   │
│ 2       │ 'geo-tz: timezones: 1000x <random>'               │ '1809670 ± 8.08%' │ '1270167 ± 425375' │ '819 ± 3.92%'          │ '787 ± 279'            │ 553     │
│ 3       │ 'geo-tz: timezones: 1000x <random> in central US' │ '237485 ± 1.28%'  │ '231583 ± 4875.0'  │ '4291 ± 0.23%'         │ '4318 ± 91'            │ 4211    │
└─────────┴───────────────────────────────────────────────────┴───────────────────┴────────────────────┴────────────────────────┴────────────────────────┴─────────┘
```

lltz is roughly 30x faster than geo-tz for random lookups in the entire world and 7x faster for random lookups in the central US.

### Memory

```
$ node benches/memory.ts lltz:timezones && node benches/memory.ts geo-tz:timezones
lltz: timezones
Δ time: 56.807 ms
Δ rss: 57.891 MiB
Δ heapTotal: 4.250 MiB
Δ heapUsed: 0.824 MiB
Δ external: 42.179 MiB
Δ arrayBuffers: 42.015 MiB
geo-tz: timezones
Δ time: 1560.153 ms
Δ rss: 1581.656 MiB
Δ heapTotal: 1528.344 MiB
Δ heapUsed: 1431.117 MiB
Δ external: -1.598 MiB
Δ arrayBuffers: -1.688 MiB
```

Loading the data from disk and then querying 1 million random points is 27x faster with lltz than with geo-tz and uses 27x less memory.

## Usage

### Installation

```bash
pnpm add lltz # or npm, yarn, bun
```

### Data

Three data variants are available, as described in the [timezone-boundary-builder README](https://github.com/evansiroky/timezone-boundary-builder#readme). We recommend `timezones.lltz` for the most comprehensive coverage, which is included in the NPM package.

The other variants, `timezones-1970.lltz` and `timezones-now.lltz`, can be downloaded from the [releases page](https://github.com/utkarshkukreti/lltz/releases) and loaded similarly.

### Node.js / Bun

#### Simple Usage

```typescript
import * as Lltz from 'lltz/server'

const lookup = Lltz.make() // Automatically loads the built-in timezones.lltz file

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
