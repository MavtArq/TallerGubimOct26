import * as WebIFC from 'web-ifc';
import wasmUrl from 'web-ifc/web-ifc.wasm?url';
import type { EngineHandle, IIfcEngine } from '../../domain/interfaces/IIfcEngine';
import type {
  ElementProperties,
  GeometryChunk,
  ModelMetadata,
  PropertyEntry,
  PropertyGroup,
  SpatialNode,
} from '../../domain/models/LoadedModel';
import type { IdsModelView } from '../../domain/ids/IdsModelView';
import { decodeIfcString, formatIfcValue } from './ifc-values';
import { WebIfcIdsView } from './WebIfcIdsView';

/** Atributos directos que se muestran en el panel de propiedades, en este orden. */
const SHOWN_ATTRIBUTES = [
  'GlobalId',
  'Name',
  'Description',
  'ObjectType',
  'LongName',
  'Tag',
  'PredefinedType',
  'Elevation',
] as const;

const QUANTITY_VALUE_KEYS = ['LengthValue', 'AreaValue', 'VolumeValue', 'CountValue', 'WeightValue', 'TimeValue'];

/** Adaptador de web-ifc al puerto IIfcEngine (hilo principal, WASM single-thread). */
export class WebIfcEngine implements IIfcEngine {
  private api = new WebIFC.IfcAPI();
  private ready: Promise<void> | null = null;

  init(): Promise<void> {
    // Single-thread: GitHub Pages no sirve las cabeceras COOP/COEP que exige SharedArrayBuffer.
    this.ready ??= this.api.Init((path) => (path.endsWith('.wasm') ? wasmUrl : path), true);
    return this.ready;
  }

  open(data: Uint8Array): EngineHandle {
    const handle = this.api.OpenModel(data, { COORDINATE_TO_ORIGIN: false });
    if (handle < 0) throw new Error('web-ifc no ha podido abrir el fichero');
    return handle;
  }

  close(handle: EngineHandle): void {
    this.api.CloseModel(handle);
  }

  getMetadata(handle: EngineHandle): ModelMetadata {
    const project = this.firstLineOfType(handle, WebIFC.IFCPROJECT);
    const app = this.firstLineOfType(handle, WebIFC.IFCAPPLICATION);
    const person = this.firstLineOfType(handle, WebIFC.IFCPERSON);
    const author = person
      ? [text(person.GivenName), text(person.FamilyName)].filter(Boolean).join(' ') || null
      : null;
    return {
      schema: this.api.GetModelSchema(handle),
      projectName: text(project?.Name) ?? text(project?.LongName),
      application: text(app?.ApplicationFullName),
      author,
    };
  }

  streamGeometry(handle: EngineHandle, onChunk: (chunk: GeometryChunk) => void): void {
    this.api.StreamAllMeshes(handle, (mesh) => {
      const placed = mesh.geometries;
      for (let i = 0; i < placed.size(); i++) {
        const pg = placed.get(i);
        const geom = this.api.GetGeometry(handle, pg.geometryExpressID);
        // Las vistas apuntan al heap del WASM: se copian antes de liberar la geometría.
        const vertices = this.api.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize()).slice();
        const indices = this.api.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize()).slice();
        geom.delete();
        if (indices.length === 0) continue;
        onChunk({
          expressId: mesh.expressID,
          color: [pg.color.x, pg.color.y, pg.color.z, pg.color.w],
          vertices,
          indices,
          transform: Array.from(pg.flatTransformation),
        });
      }
      // El FlatMesh del streaming lo gestiona el WASM: no tiene delete() en este modo.
    });
  }

  async getSpatialTree(handle: EngineHandle): Promise<SpatialNode | null> {
    try {
      const root = await this.api.properties.getSpatialStructure(handle, false);
      return this.toSpatialNode(handle, root);
    } catch (err) {
      console.warn('No se pudo leer la estructura espacial', err);
      return null;
    }
  }

  async getProperties(handle: EngineHandle, expressId: number): Promise<ElementProperties> {
    const line = await this.api.properties.getItemProperties(handle, expressId, false);
    const type = this.api.GetNameFromTypeCode(line.type);

    const attributes: PropertyEntry[] = [{ name: 'Clase IFC', value: type }, { name: 'Express ID', value: String(expressId) }];
    for (const key of SHOWN_ATTRIBUTES) {
      const value = formatIfcValue(line[key]);
      if (value !== null) attributes.push({ name: key, value });
    }

    // Con includeType=true web-ifc devuelve solo lo del IfcTypeObject, así que se piden ambos.
    const props = this.api.properties;
    const [psets, typePsets, materials, typeMaterials] = await Promise.all([
      props.getPropertySets(handle, expressId, true, false).catch(() => []),
      props.getPropertySets(handle, expressId, true, true).catch(() => []),
      props.getMaterialsProperties(handle, expressId, true, false).catch(() => []),
      props.getMaterialsProperties(handle, expressId, true, true).catch(() => []),
    ]);

    return {
      expressId,
      type,
      name: text(line.Name),
      attributes,
      groups: [...psets.map((p) => toPropertyGroup(p)), ...typePsets.map((p) => toPropertyGroup(p, ' (tipo)'))].filter(
        (g): g is PropertyGroup => g !== null,
      ),
      materials: collectMaterialNames([...materials, ...typeMaterials]),
    };
  }

  createIdsView(handle: EngineHandle): IdsModelView {
    return new WebIfcIdsView(this.api, handle);
  }

  private toSpatialNode(handle: EngineHandle, node: { expressID: number; type: string; children: any[] }): SpatialNode {
    let name: string | null = null;
    try {
      const line = this.api.GetLine(handle, node.expressID, false);
      name = text(line?.Name) ?? text(line?.LongName);
    } catch {
      // Entidad sin atributo Name: se muestra solo la clase.
    }
    return {
      expressId: node.expressID,
      // web-ifc da "IfcWall", "IfcBuildingStorey"… salvo la raíz, que llega como "IFCPROJECT".
      type: node.type === 'IFCPROJECT' ? 'IfcProject' : node.type,
      name,
      children: (node.children ?? []).map((child) => this.toSpatialNode(handle, child)),
    };
  }

  private firstLineOfType(handle: EngineHandle, type: number): any | null {
    const ids = this.api.GetLineIDsWithType(handle, type);
    return ids.size() > 0 ? this.api.GetLine(handle, ids.get(0), false) : null;
  }
}

function text(attr: unknown): string | null {
  const value = (attr as { value?: unknown } | null | undefined)?.value;
  return typeof value === 'string' && value.trim() !== '' ? decodeIfcString(value) : null;
}

function toPropertyGroup(pset: any, suffix = ''): PropertyGroup | null {
  const name = (text(pset?.Name) ?? 'Sin nombre') + suffix;
  const entries: PropertyEntry[] = [];

  for (const prop of pset?.HasProperties ?? []) {
    const value =
      formatIfcValue(prop?.NominalValue) ??
      formatIfcValue(prop?.EnumerationValues) ??
      formatIfcValue(prop?.ListValues);
    entries.push({ name: text(prop?.Name) ?? '—', value: value ?? '—' });
  }

  for (const qty of pset?.Quantities ?? []) {
    const key = QUANTITY_VALUE_KEYS.find((k) => qty?.[k] != null);
    entries.push({ name: text(qty?.Name) ?? '—', value: (key && formatIfcValue(qty[key])) || '—' });
  }

  return entries.length > 0 ? { name, entries } : null;
}

/** Recorre cualquier definición de material (capas, perfiles, constituyentes…) buscando IfcMaterial. */
function collectMaterialNames(defs: unknown[]): string[] {
  const names = new Set<string>();
  const visit = (obj: any, depth: number) => {
    if (!obj || typeof obj !== 'object' || depth > 6) return;
    if (Array.isArray(obj)) return obj.forEach((o) => visit(o, depth + 1));
    if (obj.type === WebIFC.IFCMATERIAL) {
      const name = text(obj.Name);
      if (name) names.add(name);
      return;
    }
    for (const value of Object.values(obj)) visit(value, depth + 1);
  };
  visit(defs, 0);
  return [...names];
}
