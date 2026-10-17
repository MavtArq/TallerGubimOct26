/** Nodo de la estructura espacial IFC (IfcProject → IfcSite → IfcBuilding → IfcBuildingStorey → elementos). */
export interface SpatialNode {
  expressId: number;
  /** Nombre de la clase IFC, p. ej. "IfcWall". */
  type: string;
  name: string | null;
  children: SpatialNode[];
}

export interface ModelMetadata {
  schema: string;
  projectName: string | null;
  application: string | null;
  author: string | null;
}

/** Fragmento de geometría de un elemento, en coordenadas locales + matriz de colocación. */
export interface GeometryChunk {
  expressId: number;
  /** RGBA en [0, 1]. */
  color: [number, number, number, number];
  /** Vértices intercalados: x, y, z, nx, ny, nz. */
  vertices: Float32Array;
  indices: Uint32Array;
  /** Matriz 4x4 column-major (Y arriba). */
  transform: number[];
}

export interface PropertyEntry {
  name: string;
  value: string;
}

export interface PropertyGroup {
  name: string;
  entries: PropertyEntry[];
}

export interface ElementProperties {
  expressId: number;
  type: string;
  name: string | null;
  /** Atributos directos de la entidad (GlobalId, Name, ObjectType…). */
  attributes: PropertyEntry[];
  /** Property Sets y Quantity Sets (de la instancia y de su tipo). */
  groups: PropertyGroup[];
  materials: string[];
}

/** Estado serializable de un modelo cargado (lo que la UI necesita). */
export interface ModelInfo {
  id: string;
  filename: string;
  metadata: ModelMetadata;
  visible: boolean;
  elementCount: number;
  triangleCount: number;
}
