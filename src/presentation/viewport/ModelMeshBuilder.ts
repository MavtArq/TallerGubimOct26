import * as THREE from 'three';
import type { GeometryChunk } from '../../domain/models/LoadedModel';

/** Tramo del índice de una malla fusionada que pertenece a un elemento. */
export interface ElementRange {
  mesh: THREE.Mesh;
  start: number;
  count: number;
}

/** Tabla ordenada para resolver triángulo → expressId en el picking. */
export interface FaceLookup {
  /** Primer índice (en el index buffer) de cada tramo, ascendente. */
  starts: Uint32Array;
  expressIds: Uint32Array;
}

export interface BuiltModel {
  group: THREE.Group;
  meshes: THREE.Mesh[];
  elementRanges: Map<number, ElementRange[]>;
  triangleCount: number;
}

interface Bucket {
  color: [number, number, number, number];
  chunks: GeometryChunk[];
  vertexCount: number;
  indexCount: number;
}

/**
 * Fusiona la geometría por color/opacidad: unas pocas draw calls por modelo en lugar de una por elemento.
 * Las posiciones se transforman en doble precisión y se restan del `origin` común de la escena
 * para evitar el jitter de float32 en modelos georreferenciados.
 */
export function buildModelMeshes(modelId: string, chunks: GeometryChunk[], origin: THREE.Vector3): BuiltModel {
  const buckets = new Map<string, Bucket>();
  for (const chunk of chunks) {
    const [r, g, b, a] = chunk.color;
    const key = `${r.toFixed(3)}|${g.toFixed(3)}|${b.toFixed(3)}|${a.toFixed(3)}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { color: chunk.color, chunks: [], vertexCount: 0, indexCount: 0 };
      buckets.set(key, bucket);
    }
    bucket.chunks.push(chunk);
    bucket.vertexCount += chunk.vertices.length / 6;
    bucket.indexCount += chunk.indices.length;
  }

  const group = new THREE.Group();
  group.name = modelId;
  const meshes: THREE.Mesh[] = [];
  const elementRanges = new Map<number, ElementRange[]>();
  let triangleCount = 0;

  for (const bucket of buckets.values()) {
    const positions = new Float32Array(bucket.vertexCount * 3);
    const normals = new Float32Array(bucket.vertexCount * 3);
    const indices = new Uint32Array(bucket.indexCount);
    const starts = new Uint32Array(bucket.chunks.length);
    const expressIds = new Uint32Array(bucket.chunks.length);
    const pendingRanges: Array<[number, number, number]> = [];

    let vOffset = 0;
    let iOffset = 0;
    bucket.chunks.forEach((chunk, c) => {
      const m = chunk.transform;
      const v = chunk.vertices;
      const vCount = v.length / 6;
      for (let k = 0; k < vCount; k++) {
        const x = v[k * 6], y = v[k * 6 + 1], z = v[k * 6 + 2];
        const nx = v[k * 6 + 3], ny = v[k * 6 + 4], nz = v[k * 6 + 5];
        const o = (vOffset + k) * 3;
        positions[o] = m[0] * x + m[4] * y + m[8] * z + m[12] - origin.x;
        positions[o + 1] = m[1] * x + m[5] * y + m[9] * z + m[13] - origin.y;
        positions[o + 2] = m[2] * x + m[6] * y + m[10] * z + m[14] - origin.z;
        const tx = m[0] * nx + m[4] * ny + m[8] * nz;
        const ty = m[1] * nx + m[5] * ny + m[9] * nz;
        const tz = m[2] * nx + m[6] * ny + m[10] * nz;
        const len = Math.hypot(tx, ty, tz) || 1;
        normals[o] = tx / len;
        normals[o + 1] = ty / len;
        normals[o + 2] = tz / len;
      }
      const idx = chunk.indices;
      for (let k = 0; k < idx.length; k++) indices[iOffset + k] = idx[k] + vOffset;

      starts[c] = iOffset;
      expressIds[c] = chunk.expressId;
      pendingRanges.push([chunk.expressId, iOffset, idx.length]);
      vOffset += vCount;
      iOffset += idx.length;
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, createMaterial(bucket.color));
    mesh.userData = { modelId, faceLookup: { starts, expressIds } satisfies FaceLookup };
    group.add(mesh);
    meshes.push(mesh);
    triangleCount += indices.length / 3;

    for (const [expressId, start, count] of pendingRanges) {
      let list = elementRanges.get(expressId);
      if (!list) elementRanges.set(expressId, (list = []));
      list.push({ mesh, start, count });
    }
  }

  return { group, meshes, elementRanges, triangleCount };
}

/** Punto de referencia para el origen común: primer vértice de la primera geometría, en doble precisión. */
export function chunkReferencePoint(chunk: GeometryChunk): THREE.Vector3 {
  const m = chunk.transform;
  const [x, y, z] = chunk.vertices;
  return new THREE.Vector3(
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  );
}

/** Busca el elemento al que pertenece un triángulo de una malla fusionada. */
export function expressIdAtFace(lookup: FaceLookup, faceIndex: number): number {
  const target = faceIndex * 3;
  let lo = 0;
  let hi = lookup.starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lookup.starts[mid] <= target) lo = mid;
    else hi = mid - 1;
  }
  return lookup.expressIds[lo];
}

function createMaterial([r, g, b, a]: [number, number, number, number]): THREE.MeshLambertMaterial {
  const transparent = a < 0.999;
  const material = new THREE.MeshLambertMaterial({
    color: new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace),
    transparent,
    opacity: a,
    depthWrite: !transparent,
    // Muchas geometrías IFC tienen normales u orientación de caras inconsistentes.
    side: THREE.DoubleSide,
  });
  material.userData = { baseOpacity: a, baseTransparent: transparent };
  return material;
}
