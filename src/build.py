import collections
import concurrent.futures
import json
import struct
from pathlib import Path

import shapely
import shapely.affinity
import tqdm
import typer

SCALE = 1_000_000

type Node = int | bytes | list[Node]


def to_polygons(
    geometry: shapely.geometry.base.BaseGeometry,
) -> list[list[list[tuple[int, int]]]]:
    match geometry:
        case (
            shapely.geometry.GeometryCollection()
            | shapely.geometry.MultiLineString()
            | shapely.geometry.MultiPoint()
            | shapely.geometry.MultiPolygon()
        ):
            return [polygon for geometry2 in geometry.geoms for polygon in to_polygons(geometry2)]
        case shapely.geometry.Polygon():
            return [
                [
                    [(int(round(x)), int(round(y))) for x, y in ring.coords][:-1]
                    for ring in [geometry.exterior, *geometry.interiors]
                ]
            ]
        case shapely.geometry.LineString() | shapely.geometry.Point():
            return [[[(int(round(x)), int(round(y))) for x, y in geometry.coords]]]
        case _:
            raise Exception(f"unknown geometry type: {type(geometry)}")


def process_longitude(
    longitude: int,
    geometries: list[shapely.geometry.base.BaseGeometry],
    indexes: list[int],
    quadtree_max_depth: int,
) -> list[Node]:
    for geometry in geometries:
        shapely.prepare(geometry)
    str_tree = shapely.STRtree(geometries)

    def encode(
        x_min: int,
        x_max: int,
        y_min: int,
        y_max: int,
        depth: int,
    ) -> Node:
        box = shapely.box(x_min, y_min, x_max, y_max)
        match_indexes = sorted(str_tree.query(box, predicate="intersects"))
        if not match_indexes:
            return 0 << 30
        elif len(match_indexes) == 1 and geometries[match_indexes[0]].contains(box):
            return (1 << 30) | indexes[match_indexes[0]]
        elif depth >= quadtree_max_depth:
            assert len(match_indexes) <= 8
            rings = [
                (zone, [(x - x_min, y - y_min) for x, y in ring])
                for zone, index in enumerate(match_indexes)
                for polygon in to_polygons(geometries[index].intersection(box))
                for ring in polygon
            ]
            counts = collections.Counter(
                (min(a, b), max(a, b), zone)
                for zone, ring in rings
                for a, b in zip(ring[-1:] + ring[:-1], ring)
            )
            masks = collections.defaultdict(lambda: (0, 0))
            for (a, b, zone), count in counts.items():
                inside_mask, on_mask = masks[a, b]
                masks[a, b] = (inside_mask | (count % 2) << zone, on_mask | 1 << zone)
            chains = []
            for _, ring in rings:
                start = len(chains)
                for a, b in zip(ring[-1:] + ring[:-1], ring):
                    mask = masks.pop((min(a, b), max(a, b)), None)
                    if mask is None:
                        continue
                    if len(chains) > start and chains[-1][0] == mask and chains[-1][1][-1] == a:
                        chains[-1][1].append(b)
                    else:
                        chains.append((mask, [a, b]))
                if (
                    len(chains) - start > 1
                    and chains[-1][0] == chains[start][0]
                    and chains[-1][1][-1] == chains[start][1][0]
                ):
                    mask, points = chains.pop()
                    chains[start] = (mask, points + chains[start][1][1:])
            buffer = bytearray()
            buffer.extend(struct.pack("<B", len(match_indexes)))
            for index in match_indexes:
                buffer.extend(struct.pack("<H", indexes[index]))
            buffer.extend(struct.pack("<H", len(chains)))
            for (inside_mask, on_mask), points in chains:
                buffer.extend(struct.pack("<BBH", inside_mask, on_mask, len(points)))
                for x, y in points:
                    buffer.extend(struct.pack("<HH", x, y))
            return bytes(buffer)
        else:
            x_mid = (x_min + x_max) // 2
            y_mid = (y_min + y_max) // 2
            return [
                encode(cx_min, x_max, cy_min, cy_max, depth + 1)
                for cx_min, x_max, cy_min, cy_max in [
                    (x_min, x_mid, y_min, y_mid),
                    (x_mid, x_max, y_min, y_mid),
                    (x_min, x_mid, y_mid, y_max),
                    (x_mid, x_max, y_mid, y_max),
                ]
            ]

    return [
        encode(
            longitude * SCALE,
            (longitude + 1) * SCALE,
            latitude * SCALE,
            (latitude + 1) * SCALE,
            0,
        )
        for latitude in range(0, 180)
    ]


def map_timezones(
    timezones: list[str],
    geometries: list[shapely.geometry.base.BaseGeometry],
    geojson_path: Path,
) -> list[int]:
    features = json.loads(geojson_path.read_text())["features"]
    variant_geometries = [shapely.geometry.shape(feature["geometry"]) for feature in features]
    variant_areas = shapely.area(variant_geometries)
    mapping = []
    bar = tqdm.tqdm(geometries, desc=geojson_path.name, leave=False, smoothing=0)
    for geometry in bar:
        geometry_area = geometry.area
        best_iou, best_index = 0.0, 0
        # IoU <= min(area) / max(area), so stop once no remaining variant can beat the best.
        bounds = [min(geometry_area, area) / max(geometry_area, area) for area in variant_areas]
        for bound, index in sorted(zip(bounds, range(len(bounds))), reverse=True):
            if bound <= best_iou:
                break
            if shapely.equals_exact(geometry, variant_geometries[index], 0):
                area = geometry_area
            else:
                area = geometry.intersection(variant_geometries[index]).area
            iou = area / (geometry_area + variant_areas[index] - area)
            if iou > best_iou:
                best_iou, best_index = iou, index
        assert best_iou > 0
        mapping.append(timezones.index(features[best_index]["properties"]["tzid"]))
    tqdm.tqdm.write(str(bar))
    return mapping


def main(lltz_path: Path, geojson_paths: list[Path], *, quadtree_max_depth: int = 4):
    if len(geojson_paths) != 3:
        raise typer.BadParameter("expected 3 geojson files: all, 1970 and now")
    features = sorted(
        json.loads(geojson_paths[0].read_text())["features"],
        key=lambda x: x["properties"]["tzid"],
    )
    timezones = [f["properties"]["tzid"] for f in features]
    geometries = [shapely.geometry.shape(feature["geometry"]) for feature in features]
    nodes = bytearray()
    nodes_offsets: dict[bytes, int] = {}

    def store(buffer: bytes) -> int:
        if buffer not in nodes_offsets:
            assert len(nodes) < 1 << 30
            nodes_offsets[buffer] = len(nodes)
            nodes.extend(buffer)
        return nodes_offsets[buffer]

    def resolve(node: Node) -> int:
        match node:
            case bytes():
                return (2 << 30) | store(node)
            case list():
                return (3 << 30) | store(struct.pack("<4I", *map(resolve, node)))
            case _:
                return node

    with (
        concurrent.futures.ThreadPoolExecutor() as thread_executor,
        concurrent.futures.ProcessPoolExecutor() as process_executor,
    ):
        mapping_futures = [
            thread_executor.submit(map_timezones, timezones, geometries, path)
            for path in geojson_paths[1:]
        ]
        geometries = [
            shapely.affinity.affine_transform(
                geometry, [SCALE, 0, 0, SCALE, 180 * SCALE, 90 * SCALE]
            )
            for geometry in geometries
        ]
        str_tree = shapely.STRtree(geometries)
        cells = []
        for longitude in range(0, 360):
            box = shapely.box(
                longitude * SCALE - 1, 0 * SCALE - 1, (longitude + 1) * SCALE + 1, 180 * SCALE + 1
            )
            indexes = sorted(str_tree.query(box, predicate="intersects"))
            cells.append(
                process_executor.submit(
                    process_longitude,
                    longitude,
                    [geometries[index].intersection(box) for index in indexes],
                    indexes,
                    quadtree_max_depth,
                )
            )
        bar = tqdm.tqdm(cells, desc=geojson_paths[0].name, leave=False, smoothing=0)
        cells = [[resolve(node) for node in cell.result()] for cell in bar]
        tqdm.tqdm.write(str(bar))
        mappings = [list(range(len(timezones))), *(future.result() for future in mapping_futures)]
    output = bytearray()
    output.extend(b"LLTZ2\x00\x00\x00")
    timezones_bytes = "\0".join(timezones).encode("utf-8")
    output.extend(struct.pack("<H", len(timezones_bytes)))
    output.extend(timezones_bytes)
    for mapping in mappings:
        output.extend(struct.pack(f"<{len(mapping)}H", *mapping))
    for row in zip(*cells):
        output.extend(struct.pack(f"<{len(row)}I", *row))
    output.extend(nodes)
    lltz_path.parent.mkdir(parents=True, exist_ok=True)
    lltz_path.write_bytes(output)


if __name__ == "__main__":
    typer.run(main)
