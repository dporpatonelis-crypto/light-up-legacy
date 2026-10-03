#!/usr/bin/env python3
"""Split the supplied single-mesh symbolic tree into six selectable light regions.

Usage: python3 scripts/partition-symbolic-tree.py source.glb public/models/continuity-tree-regions.glb
The source vertex attributes, material, and embedded textures are preserved. Only
triangle index lists are separated, so the assembled sculpture is unchanged.
"""

import json
import struct
import sys
from collections import defaultdict
from pathlib import Path


REGIONS = ('base', 'trunk', 'arms', 'head', 'periphery', 'core')


def region_for(x, y):
    # Coordinates are in the supplied tree's original 1.027 m geometry.
    if y < 0.25:
        return 'base'
    if 0.48 <= y <= 0.64 and abs(x) < 0.11:
        return 'core'
    if y > 0.80 and abs(x) < 0.20:
        return 'head'
    if y > 0.53 and abs(x) > 0.29:
        return 'periphery'
    if y > 0.37 and abs(x) > 0.13:
        return 'arms'
    return 'trunk'


def main(source_path, output_path):
    source = Path(source_path).read_bytes()
    magic, version, declared_length = struct.unpack_from('<4sII', source)
    if (magic, version, declared_length) != (b'glTF', 2, len(source)):
        raise ValueError('Expected a complete GLB 2.0 file')
    json_length, json_type = struct.unpack_from('<I4s', source, 12)
    if json_type != b'JSON':
        raise ValueError('Missing JSON chunk')
    document = json.loads(source[20:20 + json_length])
    bin_header = 20 + json_length
    bin_length, bin_type = struct.unpack_from('<I4s', source, bin_header)
    if bin_type != b'BIN\0':
        raise ValueError('Missing BIN chunk')
    binary = bytearray(source[bin_header + 8:bin_header + 8 + bin_length])
    if len(document['meshes']) != 1 or len(document['meshes'][0]['primitives']) != 1:
        raise ValueError('Expected the supplied single-mesh tree')
    primitive = document['meshes'][0]['primitives'][0]
    positions = document['accessors'][primitive['attributes']['POSITION']]
    indices = document['accessors'][primitive['indices']]
    if positions['componentType'] != 5126 or positions['type'] != 'VEC3':
        raise ValueError('Expected float32 vertex positions')
    if indices['componentType'] != 5123 or indices['type'] != 'SCALAR' or indices['count'] % 3:
        raise ValueError('Expected uint16 triangle indices')
    position_view = document['bufferViews'][positions['bufferView']]
    index_view = document['bufferViews'][indices['bufferView']]
    position_offset = position_view.get('byteOffset', 0) + positions.get('byteOffset', 0)
    index_offset = index_view.get('byteOffset', 0) + indices.get('byteOffset', 0)
    vertices = list(struct.iter_unpack('<3f', binary[position_offset:position_offset + positions['count'] * 12]))
    triangle_indices = struct.unpack_from(f"<{indices['count']}H", binary, index_offset)
    region_indices = defaultdict(list)
    for offset in range(0, len(triangle_indices), 3):
        triangle = triangle_indices[offset:offset + 3]
        x = sum(vertices[index][0] for index in triangle) / 3
        y = sum(vertices[index][1] for index in triangle) / 3
        region_indices[region_for(x, y)].extend(triangle)
    if any(not region_indices[region] for region in REGIONS):
        raise ValueError('A light region has no triangles')

    meshes = []
    root_node = document['nodes'][0]
    root_node.pop('mesh', None)
    root_node['children'] = []
    for region in REGIONS:
        while len(binary) % 4:
            binary.append(0)
        values = region_indices[region]
        byte_offset = len(binary)
        binary.extend(struct.pack(f'<{len(values)}H', *values))
        view_index = len(document['bufferViews'])
        document['bufferViews'].append({
            'buffer': 0, 'byteOffset': byte_offset,
            'byteLength': len(values) * 2, 'target': 34963,
        })
        accessor_index = len(document['accessors'])
        document['accessors'].append({
            'bufferView': view_index, 'componentType': 5123, 'count': len(values),
            'min': [min(values)], 'max': [max(values)], 'type': 'SCALAR',
        })
        name = f'Continuity_tree_{region}'
        part = dict(primitive, indices=accessor_index)
        meshes.append({'name': name, 'primitives': [part]})
        root_node['children'].append(len(document['nodes']))
        document['nodes'].append({'name': name, 'mesh': len(meshes) - 1})
    document['meshes'] = meshes
    document['buffers'][0]['byteLength'] = len(binary)
    json_bytes = json.dumps(document, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    json_bytes += b' ' * (-len(json_bytes) % 4)
    binary += b'\0' * (-len(binary) % 4)
    payload = (struct.pack('<I4s', len(json_bytes), b'JSON') + json_bytes +
               struct.pack('<I4s', len(binary), b'BIN\0') + binary)
    Path(output_path).write_bytes(struct.pack('<4sII', b'glTF', 2, 12 + len(payload)) + payload)
    print(', '.join(f'{region}: {len(region_indices[region]) // 3}' for region in REGIONS))


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
