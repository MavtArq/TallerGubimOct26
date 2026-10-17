import * as WebIFC from 'web-ifc';
import type { IdsRelation } from '../../domain/ids/IdsDocument';
import type {
  IdsClassificationData,
  IdsModelView,
  IdsPropertyData,
  IdsPropertySetData,
  IfcScalar,
} from '../../domain/ids/IdsModelView';
import { decodeIfcString } from './ifc-values';

const SKIPPED_ATTRIBUTES = new Set(['expressID', 'type']);
/** Tipo IFC por defecto de cada valor de cantidad si web-ifc no lo trae. */
const QUANTITY_TYPES: Record<string, string> = {
  LengthValue: 'IFCLENGTHMEASURE',
  AreaValue: 'IFCAREAMEASURE',
  VolumeValue: 'IFCVOLUMEMEASURE',
  CountValue: 'IFCCOUNTMEASURE',
  WeightValue: 'IFCMASSMEASURE',
  TimeValue: 'IFCTIMEMEASURE',
};

/** Relación → [atributo de los hijos, atributo del contenedor]. */
const PARENT_RELATIONS: Record<IdsRelation, [number, string, string]> = {
  IFCRELAGGREGATES: [WebIFC.IFCRELAGGREGATES, 'RelatedObjects', 'RelatingObject'],
  IFCRELCONTAINEDINSPATIALSTRUCTURE: [WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE, 'RelatedElements', 'RelatingStructure'],
  IFCRELNESTS: [WebIFC.IFCRELNESTS, 'RelatedObjects', 'RelatingObject'],
  IFCRELVOIDSELEMENT: [WebIFC.IFCRELVOIDSELEMENT, 'RelatedOpeningElement', 'RelatingBuildingElement'],
  IFCRELFILLSELEMENT: [WebIFC.IFCRELFILLSELEMENT, 'RelatedBuildingElement', 'RelatingOpeningElement'],
};

/** Vista IDS de un modelo abierto en web-ifc. Indexa las relaciones una sola vez al crearse. */
export class WebIfcIdsView implements IdsModelView {
  readonly schema: string;
  private psetsOf = new Map<number, number[]>();
  private typeOf = new Map<number, number>();
  private materialsOf = new Map<number, number[]>();
  private classificationsOf = new Map<number, number[]>();
  private parentsOf = new Map<IdsRelation, Map<number, number[]>>();

  private lines = new Map<number, any>();
  private psetCache = new Map<number, IdsPropertySetData | null>();
  private materialCache = new Map<number, string[]>();
  private classificationCache = new Map<number, IdsClassificationData | null>();

  constructor(
    private api: WebIFC.IfcAPI,
    private handle: number,
  ) {
    this.schema = api.GetModelSchema(handle);
    this.indexRelation(WebIFC.IFCRELDEFINESBYPROPERTIES, 'RelatedObjects', 'RelatingPropertyDefinition', this.psetsOf);
    this.indexRelation(WebIFC.IFCRELASSOCIATESMATERIAL, 'RelatedObjects', 'RelatingMaterial', this.materialsOf);
    this.indexRelation(WebIFC.IFCRELASSOCIATESCLASSIFICATION, 'RelatedObjects', 'RelatingClassification', this.classificationsOf);
    const types = new Map<number, number[]>();
    this.indexRelation(WebIFC.IFCRELDEFINESBYTYPE, 'RelatedObjects', 'RelatingType', types);
    for (const [obj, [type]] of types) this.typeOf.set(obj, type);
    for (const [relation, [code, childAttr, parentAttr]] of Object.entries(PARENT_RELATIONS)) {
      const map = new Map<number, number[]>();
      this.indexRelation(code, childAttr, parentAttr, map);
      this.parentsOf.set(relation as IdsRelation, map);
    }
    this.lines.clear();
  }

  allObjectIds(): number[] {
    return vectorToArray(this.api.GetLineIDsWithType(this.handle, WebIFC.IFCOBJECTDEFINITION, true));
  }

  idsOfEntity(entityName: string): number[] {
    let code: number | undefined;
    try {
      code = this.api.GetTypeCodeFromName(entityName.toUpperCase());
    } catch {
      return [];
    }
    return code ? vectorToArray(this.api.GetLineIDsWithType(this.handle, code, false)) : [];
  }

  entityName(id: number): string {
    return this.api.GetNameFromTypeCode(this.api.GetLineType(this.handle, id)).toUpperCase();
  }

  predefinedType(id: number): string | null {
    const own = predefinedOf(this.line(id));
    if (own) return own;
    const type = this.typeOf.get(id);
    return type ? predefinedOf(this.line(type)) : null;
  }

  attributeNames(id: number): string[] {
    return Object.keys(this.line(id) ?? {}).filter((k) => !SKIPPED_ATTRIBUTES.has(k));
  }

  attribute(id: number, name: string): { present: boolean; values: IfcScalar[] } {
    const raw = this.line(id)?.[name];
    const values = scalars(raw);
    const present = raw != null && !(Array.isArray(raw) && raw.length === 0) && !(values.length === 1 && values[0] === '');
    return { present, values };
  }

  propertySets(id: number): IdsPropertySetData[] {
    const read = (ids: number[]) => ids.map((p) => this.readPset(p)).filter((p): p is IdsPropertySetData => p !== null);
    // Los IfcTypeObject guardan sus Psets en HasPropertySets.
    if (this.isType(id)) return read(refs(this.line(id).HasPropertySets));
    const own = read(this.psetsOf.get(id) ?? []);
    const type = this.typeOf.get(id);
    const fromType = type !== undefined ? read(refs(this.line(type)?.HasPropertySets)) : [];
    return mergePsets(own, fromType);
  }

  materials(id: number): string[] {
    const sources = [...(this.materialsOf.get(id) ?? []), ...(this.materialsOf.get(this.typeOf.get(id) ?? -1) ?? [])];
    return [...new Set(sources.flatMap((m) => this.readMaterial(m)))];
  }

  classifications(id: number): IdsClassificationData[] {
    const sources = [...(this.classificationsOf.get(id) ?? []), ...(this.classificationsOf.get(this.typeOf.get(id) ?? -1) ?? [])];
    return sources.map((c) => this.readClassification(c)).filter((c): c is IdsClassificationData => c !== null);
  }

  parents(id: number, relation: IdsRelation): number[] {
    return this.parentsOf.get(relation)?.get(id) ?? [];
  }

  label(id: number): string {
    const name = scalars(this.line(id)?.Name)[0];
    return typeof name === 'string' && name !== '' ? name : `${this.api.GetNameFromTypeCode(this.api.GetLineType(this.handle, id))} #${id}`;
  }

  globalId(id: number): string | null {
    const gid = scalars(this.line(id)?.GlobalId)[0];
    return typeof gid === 'string' ? gid : null;
  }

  clearCache(): void {
    this.lines.clear();
    this.psetCache.clear();
    this.materialCache.clear();
    this.classificationCache.clear();
  }

  // ── Internos ─────────────────────────────────

  private line(id: number): any {
    let line = this.lines.get(id);
    if (line === undefined) {
      try {
        line = this.api.GetLine(this.handle, id, false);
      } catch {
        line = null;
      }
      this.lines.set(id, line);
    }
    return line;
  }

  private isType(id: number): boolean {
    return this.line(id)?.HasPropertySets !== undefined;
  }

  private indexRelation(code: number, childAttr: string, parentAttr: string, target: Map<number, number[]>): void {
    for (const relId of vectorToArray(this.api.GetLineIDsWithType(this.handle, code, false))) {
      const rel = this.api.GetLine(this.handle, relId, false);
      // RelatingPropertyDefinition puede ser un conjunto en IFC4 (IfcPropertySetDefinitionSet).
      const parents = refs(rel?.[parentAttr]);
      for (const childId of refs(rel?.[childAttr])) {
        let list = target.get(childId);
        if (!list) target.set(childId, (list = []));
        list.push(...parents);
      }
    }
  }

  private readPset(id: number): IdsPropertySetData | null {
    if (this.psetCache.has(id)) return this.psetCache.get(id)!;
    const pset = this.line(id);
    const name = scalars(pset?.Name)[0];
    let result: IdsPropertySetData | null = null;
    if (pset && typeof name === 'string') {
      const properties: IdsPropertyData[] = [];
      for (const propId of refs(pset.HasProperties)) {
        const prop = this.line(propId);
        const propName = scalars(prop?.Name)[0];
        if (typeof propName !== 'string') continue;
        const valueAttr = prop.NominalValue ?? prop.EnumerationValues ?? prop.ListValues ?? prop.SetPointValue ?? prop.UpperBoundValue ?? prop.LowerBoundValue;
        properties.push({ name: propName, values: scalars(valueAttr), dataType: dataTypeOf(valueAttr) });
      }
      for (const qtyId of refs(pset.Quantities)) {
        const qty = this.line(qtyId);
        const qtyName = scalars(qty?.Name)[0];
        const key = Object.keys(QUANTITY_TYPES).find((k) => qty?.[k] != null);
        if (typeof qtyName !== 'string' || !key) continue;
        properties.push({ name: qtyName, values: scalars(qty[key]), dataType: dataTypeOf(qty[key]) ?? QUANTITY_TYPES[key] });
      }
      result = { name, properties };
    }
    this.psetCache.set(id, result);
    return result;
  }

  private readMaterial(id: number): string[] {
    if (this.materialCache.has(id)) return this.materialCache.get(id)!;
    const names = new Set<string>();
    const visit = (obj: any, depth: number) => {
      if (!obj || typeof obj !== 'object' || depth > 8) return;
      if (Array.isArray(obj)) return obj.forEach((o) => visit(o, depth + 1));
      // Referencias sin resolver: se cargan bajo demanda.
      if (obj.type === 5 && typeof obj.value === 'number') return visit(this.line(obj.value), depth + 1);
      const typeName = typeof obj.type === 'number' && obj.expressID ? this.api.GetNameFromTypeCode(obj.type).toUpperCase() : '';
      if (typeName.startsWith('IFCMATERIAL')) {
        for (const attr of ['Name', 'Category', 'LayerSetName']) {
          const v = scalars(obj[attr])[0];
          if (typeof v === 'string' && v !== '') names.add(v);
        }
        for (const attr of ['Material', 'Materials', 'MaterialLayers', 'MaterialProfiles', 'MaterialConstituents', 'ForLayerSet', 'ForProfileSet']) {
          visit(obj[attr], depth + 1);
        }
      }
    };
    visit(this.line(id), 0);
    const result = [...names];
    this.materialCache.set(id, result);
    return result;
  }

  private readClassification(id: number): IdsClassificationData | null {
    if (this.classificationCache.has(id)) return this.classificationCache.get(id)!;
    const identifications: string[] = [];
    let system: string | null = null;
    let current = this.line(id);
    for (let depth = 0; current && depth < 10; depth++) {
      const typeName = this.api.GetNameFromTypeCode(current.type).toUpperCase();
      if (typeName === 'IFCCLASSIFICATION') {
        system = (scalars(current.Name)[0] as string | undefined) ?? null;
        break;
      }
      const code = scalars(current.Identification ?? current.ItemReference)[0];
      if (code !== undefined && code !== '') identifications.push(String(code));
      const source = refs(current.ReferencedSource)[0];
      current = source !== undefined ? this.line(source) : null;
    }
    const result = system !== null || identifications.length > 0 ? { system, identifications } : null;
    this.classificationCache.set(id, result);
    return result;
  }
}

function vectorToArray(vec: { size(): number; get(i: number): number }): number[] {
  const out = new Array<number>(vec.size());
  for (let i = 0; i < out.length; i++) out[i] = vec.get(i);
  return out;
}

/** IDs de referencias ({ type: 5, value }) en un atributo simple o de lista. */
function refs(attr: unknown): number[] {
  if (attr == null) return [];
  const list = Array.isArray(attr) ? attr : [attr];
  return list
    .map((r) => (r && typeof r === 'object' && typeof (r as { value?: unknown }).value === 'number' ? (r as { value: number }).value : null))
    .filter((v): v is number => v !== null);
}

/** Valores escalares de un atributo ({ type, value } o listas), ignorando referencias. */
function scalars(attr: unknown): IfcScalar[] {
  if (attr == null) return [];
  if (Array.isArray(attr)) return attr.flatMap(scalars);
  if (typeof attr !== 'object') return isScalar(attr) ? [normalize(attr)] : [];
  const { type, value } = attr as { type?: number; value?: unknown };
  if (type === 5) return [];
  return isScalar(value) ? [normalize(value)] : [];
}

function isScalar(v: unknown): v is IfcScalar {
  return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}

function normalize(v: IfcScalar): IfcScalar {
  return typeof v === 'string' ? decodeIfcString(v) : v;
}

function dataTypeOf(attr: unknown): string | null {
  const first = Array.isArray(attr) ? attr[0] : attr;
  const name = (first as { name?: unknown } | null)?.name;
  return typeof name === 'string' ? name.toUpperCase() : null;
}

function predefinedOf(line: any): string | null {
  const value = scalars(line?.PredefinedType)[0];
  if (typeof value !== 'string' || value === '' || value === 'NOTDEFINED') return null;
  if (value === 'USERDEFINED') {
    const custom = scalars(line?.ObjectType ?? line?.ElementType)[0];
    return typeof custom === 'string' && custom !== '' ? custom : value;
  }
  return value;
}

/** La instancia prevalece sobre el tipo, propiedad a propiedad. */
function mergePsets(own: IdsPropertySetData[], fromType: IdsPropertySetData[]): IdsPropertySetData[] {
  const byName = new Map<string, IdsPropertySetData>();
  for (const ps of fromType) byName.set(ps.name, { name: ps.name, properties: [...ps.properties] });
  for (const ps of own) {
    const existing = byName.get(ps.name);
    if (!existing) {
      byName.set(ps.name, { name: ps.name, properties: [...ps.properties] });
      continue;
    }
    const ownNames = new Set(ps.properties.map((p) => p.name));
    existing.properties = [...ps.properties, ...existing.properties.filter((p) => !ownNames.has(p.name))];
  }
  return [...byName.values()];
}
