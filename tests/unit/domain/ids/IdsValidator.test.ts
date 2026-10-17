import { describe, expect, it } from 'vitest';
import type { IdsFacet, IdsRelation, IdsSpecification, IdsValue } from '../../../../src/domain/ids/IdsDocument';
import type { IdsModelView, IdsPropertySetData, IfcScalar } from '../../../../src/domain/ids/IdsModelView';
import { validateSpecification } from '../../../../src/domain/ids/IdsValidator';

// ── Modelo de prueba en memoria ──────────────────

interface FakeElement {
  entity: string;
  attrs?: Record<string, IfcScalar | null>;
  predefinedType?: string;
  psets?: IdsPropertySetData[];
  materials?: string[];
  classifications?: { system: string; codes: string[] }[];
  parents?: Partial<Record<IdsRelation, number[]>>;
}

function fakeView(elements: Record<number, FakeElement>, schema = 'IFC4'): IdsModelView {
  const get = (id: number) => elements[id];
  return {
    schema,
    allObjectIds: () => Object.keys(elements).map(Number),
    idsOfEntity: (name) => Object.entries(elements).filter(([, e]) => e.entity === name).map(([id]) => Number(id)),
    entityName: (id) => get(id).entity,
    predefinedType: (id) => get(id).predefinedType ?? null,
    attributeNames: (id) => Object.keys(get(id).attrs ?? {}),
    attribute: (id, name) => {
      const v = get(id).attrs?.[name];
      return { present: v != null && v !== '', values: v == null ? [] : [v] };
    },
    propertySets: (id) => get(id).psets ?? [],
    materials: (id) => get(id).materials ?? [],
    classifications: (id) => (get(id).classifications ?? []).map((c) => ({ system: c.system, identifications: c.codes })),
    parents: (id, rel) => get(id).parents?.[rel] ?? [],
    label: (id) => `#${id}`,
    globalId: () => null,
    clearCache: () => {},
  };
}

const v = (value: string): IdsValue => ({ kind: 'simple', value });
const entity = (name: string, predefinedType?: string): IdsFacet => ({
  facet: 'entity',
  name: v(name),
  predefinedType: predefinedType ? v(predefinedType) : null,
});
const property = (pset: string, name: string, value?: string, extra: Partial<IdsFacet> = {}): IdsFacet =>
  ({ facet: 'property', propertySet: v(pset), baseName: v(name), value: value ? v(value) : null, dataType: null, cardinality: 'required', ...extra }) as IdsFacet;

function spec(applicability: IdsFacet[], requirements: IdsFacet[], extra: Partial<IdsSpecification> = {}): IdsSpecification {
  return {
    name: 'test',
    identifier: null,
    description: null,
    instructions: null,
    ifcVersions: [],
    cardinality: 'required',
    applicability,
    requirements,
    requirementsDescription: null,
    ...extra,
  };
}

const pset = (name: string, props: Record<string, IfcScalar>, dataType = 'IFCLABEL'): IdsPropertySetData => ({
  name,
  properties: Object.entries(props).map(([n, value]) => ({ name: n, values: [value], dataType })),
});

const run = (s: IdsSpecification, elements: Record<number, FakeElement>, schema?: string) =>
  validateSpecification(s, 0, [{ modelId: 'm1', view: fakeView(elements, schema) }]);

// ── Tests ────────────────────────────────────────

describe('validateSpecification', () => {
  const walls: Record<number, FakeElement> = {
    1: { entity: 'IFCWALL', psets: [pset('Pset_WallCommon', { FireRating: 'EI 120' })] },
    2: { entity: 'IFCWALL', psets: [pset('Pset_WallCommon', { FireRating: 'EI 60' })] },
    3: { entity: 'IFCWALL' },
    4: { entity: 'IFCSLAB' },
  };

  it('separa elementos que cumplen, con valor erróneo y sin la propiedad', () => {
    const r = run(spec([entity('IFCWALL')], [property('Pset_WallCommon', 'FireRating', 'EI 120')]), walls);
    expect(r.status).toBe('fail');
    expect(r.applicableCount).toBe(3);
    expect(r.passed.map((k) => k.expressId)).toEqual([1]);
    expect(r.failures.map((f) => f.key.expressId)).toEqual([2, 3]);
    expect(r.failures[0].reasons[0]).toContain('se esperaba');
    expect(r.failures[1].reasons[0]).toContain('Falta la propiedad Pset_WallCommon.FireRating');
  });

  it('requisito opcional: solo falla si existe con valor incorrecto', () => {
    const r = run(spec([entity('IFCWALL')], [property('Pset_WallCommon', 'FireRating', 'EI 120', { cardinality: 'optional' })]), walls);
    expect(r.failures.map((f) => f.key.expressId)).toEqual([2]);
  });

  it('requisito prohibido: falla si la propiedad existe', () => {
    const r = run(spec([entity('IFCWALL')], [property('Pset_WallCommon', 'FireRating', undefined, { cardinality: 'prohibited' })]), walls);
    expect(r.failures.map((f) => f.key.expressId)).toEqual([1, 2]);
  });

  it('comprueba el dataType de la propiedad', () => {
    const r = run(spec([entity('IFCWALL')], [property('Pset_WallCommon', 'FireRating', undefined, { dataType: 'IFCTEXT' })]), walls);
    // 1 y 2: tipo incorrecto; 3: no tiene la propiedad.
    expect(r.failures.map((f) => f.key.expressId)).toEqual([1, 2, 3]);
    expect(r.failures[0].reasons[0]).toContain('es de tipo IFCLABEL; se esperaba IFCTEXT');
  });

  it('especificación obligatoria sin elementos aplicables falla', () => {
    const r = run(spec([entity('IFCDOOR')], []), walls);
    expect(r.status).toBe('fail');
    expect(r.note).toContain('ningún elemento');
  });

  it('especificación opcional sin elementos aplicables cumple', () => {
    expect(run(spec([entity('IFCDOOR')], [], { cardinality: 'optional' }), walls).status).toBe('pass');
  });

  it('especificación prohibida falla si encuentra elementos', () => {
    expect(run(spec([entity('IFCSLAB')], [], { cardinality: 'prohibited' }), walls).status).toBe('fail');
    expect(run(spec([entity('IFCDOOR')], [], { cardinality: 'prohibited' }), walls).status).toBe('pass');
  });

  it('se omite si el esquema del modelo no está en ifcVersion', () => {
    const r = run(spec([entity('IFCWALL')], [], { ifcVersions: ['IFC2X3'] }), walls, 'IFC4');
    expect(r.status).toBe('skipped');
    expect(run(spec([entity('IFCWALL')], [], { ifcVersions: ['IFC4X3_ADD2'] }), walls, 'IFC4X3_ADD2').status).toBe('pass');
  });

  it('aplicabilidad por propiedad sin faceta entity recorre todos los objetos', () => {
    const r = run(spec([property('Pset_WallCommon', 'FireRating')], []), walls);
    expect(r.applicableCount).toBe(2);
  });

  it('filtra por predefinedType', () => {
    const elements: Record<number, FakeElement> = {
      1: { entity: 'IFCSLAB', predefinedType: 'ROOF' },
      2: { entity: 'IFCSLAB', predefinedType: 'FLOOR' },
    };
    expect(run(spec([entity('IFCSLAB', 'ROOF')], []), elements).applicableCount).toBe(1);
  });

  it('evalúa atributos, materiales y clasificaciones', () => {
    const elements: Record<number, FakeElement> = {
      1: { entity: 'IFCCOLUMN', attrs: { Name: 'P1', Tag: '' }, materials: ['Hormigón HA-30'], classifications: [{ system: 'Uniclass 2015', codes: ['EF_20_10'] }] },
      2: { entity: 'IFCCOLUMN', attrs: { Name: null }, materials: ['Acero S275'], classifications: [{ system: 'OmniClass', codes: ['21-02'] }] },
    };
    const ids = (r: ReturnType<typeof run>) => r.failures.map((f) => f.key.expressId);
    expect(ids(run(spec([entity('IFCCOLUMN')], [{ facet: 'attribute', name: v('Name'), value: null, cardinality: 'required' }]), elements))).toEqual([2]);
    expect(ids(run(spec([entity('IFCCOLUMN')], [{ facet: 'attribute', name: v('Tag'), value: null, cardinality: 'required' }]), elements))).toEqual([1, 2]);
    expect(
      ids(run(spec([entity('IFCCOLUMN')], [{ facet: 'material', value: { kind: 'restriction', base: null, enumeration: [], patterns: ['Hormig.*'] }, cardinality: 'required' }]), elements)),
    ).toEqual([2]);
    expect(ids(run(spec([entity('IFCCOLUMN')], [{ facet: 'classification', system: v('Uniclass 2015'), value: null, cardinality: 'required' }]), elements))).toEqual([2]);
    expect(ids(run(spec([entity('IFCCOLUMN')], [{ facet: 'classification', system: null, value: v('21-02'), cardinality: 'required' }]), elements))).toEqual([1]);
  });

  it('partOf sube por contención y agregación', () => {
    const elements: Record<number, FakeElement> = {
      10: { entity: 'IFCBUILDING' },
      11: { entity: 'IFCBUILDINGSTOREY', parents: { IFCRELAGGREGATES: [10] } },
      12: { entity: 'IFCWALL', parents: { IFCRELCONTAINEDINSPATIALSTRUCTURE: [11] } },
      13: { entity: 'IFCWALL' },
    };
    const partOf = (name: string, relation: IdsRelation | null): IdsFacet => ({
      facet: 'partOf',
      relation,
      entity: entity(name) as Extract<IdsFacet, { facet: 'entity' }>,
      cardinality: 'required',
    });
    const r = run(spec([entity('IFCWALL')], [partOf('IFCBUILDING', 'IFCRELCONTAINEDINSPATIALSTRUCTURE')]), elements);
    expect(r.passed.map((k) => k.expressId)).toEqual([12]);
    expect(r.failures.map((f) => f.key.expressId)).toEqual([13]);
    expect(run(spec([entity('IFCWALL')], [partOf('IFCSITE', null)]), elements).failures[0].reasons[0]).toContain('No forma parte de IFCSITE');
  });
});
