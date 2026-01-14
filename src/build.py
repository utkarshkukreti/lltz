import json
import struct
from pathlib import Path

import shapely
import shapely.affinity
import tqdm
import typer

SCALE = 1_000_000


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
) -> list[tuple[int, bytearray]]:
    for geometry in geometries:
        shapely.prepare(geometry)
    str_tree = shapely.STRtree(geometries)

    def encode(
        x_min: int,
        x_max: int,
        y_min: int,
        y_max: int,
        depth: int,
    ) -> tuple[int, bytearray]:
        box = shapely.box(x_min, y_min, x_max, y_max)
        match_indexes = sorted(str_tree.query(box, predicate="intersects"))
        if not match_indexes:
            return 0 << 30, bytearray()
        elif len(match_indexes) == 1 and geometries[match_indexes[0]].contains(box):
            return (1 << 30) | indexes[match_indexes[0]], bytearray()
        elif depth >= quadtree_max_depth:
            buffer = bytearray()
            buffer.extend(struct.pack("<B", len(match_indexes)))
            for index in match_indexes:
                timezone_index = indexes[index]
                polygons = to_polygons(geometries[index].intersection(box))
                buffer.extend(struct.pack("<HB", timezone_index, len(polygons)))
                for polygon in polygons:
                    polygon_buffer = bytearray()
                    polygon_buffer.extend(struct.pack("<B", len(polygon)))
                    xs = [x for ring in polygon for x, _ in ring]
                    ys = [y for ring in polygon for _, y in ring]
                    polygon_buffer.extend(
                        struct.pack(
                            "<HHHH",
                            min(xs) - x_min,
                            max(xs) - x_min,
                            min(ys) - y_min,
                            max(ys) - y_min,
                        )
                    )
                    for ring in polygon:
                        polygon_buffer.extend(struct.pack("<H", len(ring)))
                        for x, y in ring:
                            polygon_buffer.extend(struct.pack("<HH", x - x_min, y - y_min))
                    buffer.extend(struct.pack("<H", len(polygon_buffer)))
                    buffer.extend(polygon_buffer)
            return 2 << 30, buffer
        else:
            x_mid = (x_min + x_max) // 2
            y_mid = (y_min + y_max) // 2
            children = [
                encode(cx_min, x_max, cy_min, cy_max, depth + 1)
                for cx_min, x_max, cy_min, cy_max in [
                    (x_min, x_mid, y_min, y_mid),
                    (x_mid, x_max, y_min, y_mid),
                    (x_min, x_mid, y_mid, y_max),
                    (x_mid, x_max, y_mid, y_max),
                ]
            ]
            offsets = []
            children_buffer = bytearray()
            for value, buffer2 in children:
                tag = value >> 30
                if tag == 0 or tag == 1:
                    offsets.append(value)
                else:
                    offsets.append(value | len(children_buffer))
                    children_buffer.extend(buffer2)
            buffer = bytearray()
            buffer.extend(struct.pack("<4I", *offsets))
            buffer.extend(children_buffer)
            return 3 << 30, buffer

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


def main(geojson_path: Path, lltz_path: Path, *, quadtree_max_depth: int = 4):
    features = sorted(
        json.loads(geojson_path.read_text())["features"],
        key=lambda x: x["properties"]["tzid"],
    )
    timezones = [f["properties"]["tzid"] for f in features]
    geometries = [shapely.geometry.shape(feature["geometry"]) for feature in features]
    geometries = [
        shapely.affinity.affine_transform(geometry, [SCALE, 0, 0, SCALE, 180 * SCALE, 90 * SCALE])
        for geometry in geometries
    ]
    str_tree = shapely.STRtree(geometries)
    cells_buffers = []
    for longitude in tqdm.tqdm(range(0, 360), desc=geojson_path.name):
        box = shapely.box(
            longitude * SCALE - 1, 0 * SCALE - 1, (longitude + 1) * SCALE + 1, 180 * SCALE + 1
        )
        indexes = sorted(str_tree.query(box, predicate="intersects"))
        cells_buffers.append(
            process_longitude(
                longitude,
                [geometries[index].intersection(box) for index in indexes],
                indexes,
                quadtree_max_depth,
            )
        )
    cells_buffer = bytearray()
    cells_offsets = []
    for latitude_index in range(180):
        for longitude_index in range(360):
            value, buffer = cells_buffers[longitude_index][latitude_index]
            tag = value >> 30
            if tag == 0 or tag == 1:
                cells_offsets.append(value)
            else:
                cells_offsets.append(value | len(cells_buffer))
                cells_buffer.extend(buffer)
    output = bytearray()
    output.extend(b"LLTZ1\x00\x00\x00")
    timezones_bytes = "\0".join(timezones).encode("utf-8")
    output.extend(struct.pack("<H", len(timezones_bytes)))
    output.extend(timezones_bytes)
    output.extend(struct.pack(f"<{len(cells_offsets)}I", *cells_offsets))
    output.extend(cells_buffer)
    lltz_path.parent.mkdir(parents=True, exist_ok=True)
    lltz_path.write_bytes(output)


if __name__ == "__main__":
    typer.run(main)
