import type { ElementKey } from '../models/ElementKey';
import {
  IDS_RELATIONS,
  type EntityFacet,
  type FacetCardinality,
  type IdsFacet,
  type IdsRelation,
  type IdsSpecification,
} from './IdsDocument';
import type { IdsModelView } from './IdsModelView';
import { describeName, describeValue, formatActual, matchesEntityName, matchesValue } from './values';

/** pass = existe y cumple · fail = existe pero no cumple · absent = no existe. */
export interface FacetOutcome {
  status: 'pass' | 'fail' | 'absent';
  detail: string;
}

export interface IdsFailure {
  key: ElementKey;
  label: string;
  entity: string;
  globalId: string | null;
  reasons: string[];
}

export type SpecStatus = 'pass' | 'fail' | 'skipped';

export interface IdsSpecResult {
  index: number;
  spec: IdsSpecification;
  status: SpecStatus;
  applicableCount: number;
  passed: ElementKey[];
  failures: IdsFailure[];
  /** Aclaración del estado (p. ej. por qué no aplica o por qué falla sin elementos). */
  note: string | null;
}

export interface ModelUnderTest {
  modelId: string;
  view: IdsModelView;
}

const SPATIAL_PARENT_RELATIONS: readonly IdsRelation[] = ['IFCRELAGGREGATES', 'IFCRELCONTAINEDINSPATIALSTRUCTURE'];

export function validateSpecification(spec: IdsSpecification, index: number, models: ModelUnderTest[]): IdsSpecResult {
  const result: IdsSpecResult = { index, spec, status: 'pass', applicableCount: 0, passed: [], failures: [], note: null };
  const inScope = models.filter((m) => schemaMatches(spec.ifcVersions, m.view.schema));
  if (inScope.length === 0) {
    result.status = 'skipped';
    result.note = `No aplica a los esquemas cargados (requiere ${spec.ifcVersions.join(', ')})`;
    return result;
  }

  for (const { modelId, view } of inScope) {
    for (const id of candidates(spec, view)) {
      if (!spec.applicability.every((f) => evaluateFacet(view, id, f).status === 'pass')) continue;
      result.applicableCount++;
      const key = { modelId, expressId: id };

      const reasons =
        spec.cardinality === 'prohibited'
          ? ['La especificación prohíbe elementos que cumplan la aplicabilidad']
          : spec.requirements.flatMap((f) => requirementFailure(view, id, f) ?? []);

      if (reasons.length === 0) result.passed.push(key);
      else result.failures.push({ key, label: view.label(id), entity: view.entityName(id), globalId: view.globalId(id), reasons });
    }
  }

  if (result.failures.length > 0) {
    result.status = 'fail';
  } else if (spec.cardinality === 'required' && result.applicableCount === 0) {
    result.status = 'fail';
    result.note = 'Especificación obligatoria: ningún elemento cumple la aplicabilidad';
  } else if (result.applicableCount === 0) {
    result.note = 'Ningún elemento cumple la aplicabilidad';
  }
  return result;
}

function schemaMatches(versions: string[], schema: string): boolean {
  if (versions.length === 0) return true;
  const s = schema.toUpperCase();
  return versions.some((v) => {
    const u = v.toUpperCase();
    return u === s || (u.startsWith('IFC4X3') && s.startsWith('IFC4X3')) || (u === 'IFC4' && s === 'IFC4');
  });
}

/** Atajo: si la aplicabilidad fija una clase concreta se consulta solo esa clase. */
function candidates(spec: IdsSpecification, view: IdsModelView): number[] {
  const entity = spec.applicability.find((f): f is EntityFacet => f.facet === 'entity');
  if (entity?.name.kind === 'simple') return view.idsOfEntity(entity.name.value.toUpperCase());
  if (entity?.name.kind === 'restriction' && entity.name.enumeration.length > 0 && entity.name.patterns.length === 0) {
    return entity.name.enumeration.flatMap((name) => view.idsOfEntity(name.toUpperCase()));
  }
  return view.allObjectIds();
}

/** Devuelve el motivo de fallo de un requisito, o null si se cumple según su cardinalidad. */
function requirementFailure(view: IdsModelView, id: number, facet: IdsFacet): string | null {
  const outcome = evaluateFacet(view, id, facet);
  const cardinality: FacetCardinality = facet.facet === 'entity' ? 'required' : facet.cardinality;
  switch (cardinality) {
    case 'required':
      return outcome.status === 'pass' ? null : outcome.detail;
    case 'optional':
      return outcome.status === 'fail' ? outcome.detail : null;
    case 'prohibited':
      return outcome.status === 'pass' ? `No debería tener ${describeFacet(facet)}` : null;
  }
}

export function evaluateFacet(view: IdsModelView, id: number, facet: IdsFacet): FacetOutcome {
  switch (facet.facet) {
    case 'entity':
      return evaluateEntity(view, id, facet);

    case 'attribute': {
      const names = view.attributeNames(id).filter((n) => matchesValue(facet.name, n));
      const present = names.map((n) => ({ n, ...view.attribute(id, n) })).filter((a) => a.present);
      if (present.length === 0) return { status: 'absent', detail: `Falta el atributo ${describeName(facet.name)}` };
      if (facet.value) {
        for (const a of present) {
          if (!a.values.some((v) => matchesValue(facet.value!, v))) {
            const actual = a.values.length ? a.values.map(formatActual).join(', ') : '(referencia)';
            return { status: 'fail', detail: `Atributo ${a.n} = ${actual}; se esperaba ${describeValue(facet.value)}` };
          }
        }
      }
      return { status: 'pass', detail: '' };
    }

    case 'property': {
      const label = `${describeName(facet.propertySet)}.${describeName(facet.baseName)}`;
      const found = view
        .propertySets(id)
        .filter((ps) => matchesValue(facet.propertySet, ps.name))
        .flatMap((ps) => ps.properties.filter((p) => matchesValue(facet.baseName, p.name)).map((p) => ({ ps, p })))
        .filter(({ p }) => p.values.length > 0);
      if (found.length === 0) return { status: 'absent', detail: `Falta la propiedad ${label}` };
      for (const { ps, p } of found) {
        const name = `${ps.name}.${p.name}`;
        if (facet.dataType && p.dataType && p.dataType.toUpperCase() !== facet.dataType.toUpperCase()) {
          return { status: 'fail', detail: `${name} es de tipo ${p.dataType}; se esperaba ${facet.dataType.toUpperCase()}` };
        }
        if (facet.value && !p.values.some((v) => matchesValue(facet.value!, v))) {
          return { status: 'fail', detail: `${name} = ${p.values.map(formatActual).join(', ')}; se esperaba ${describeValue(facet.value)}` };
        }
      }
      return { status: 'pass', detail: '' };
    }

    case 'material': {
      const materials = view.materials(id);
      if (materials.length === 0) return { status: 'absent', detail: 'Sin material asignado' };
      if (facet.value && !materials.some((m) => matchesValue(facet.value!, m))) {
        return { status: 'fail', detail: `Materiales [${materials.join(', ')}]; se esperaba ${describeValue(facet.value)}` };
      }
      return { status: 'pass', detail: '' };
    }

    case 'classification': {
      const all = view.classifications(id);
      if (all.length === 0) return { status: 'absent', detail: 'Sin clasificación' };
      const bySystem = facet.system ? all.filter((c) => c.system !== null && matchesValue(facet.system!, c.system)) : all;
      if (bySystem.length === 0) {
        const systems = all.map((c) => c.system ?? '¿?').join(', ');
        return { status: 'fail', detail: `Sistemas de clasificación [${systems}]; se esperaba ${describeName(facet.system!)}` };
      }
      if (facet.value && !bySystem.some((c) => c.identifications.some((code) => matchesValue(facet.value!, code)))) {
        const codes = bySystem.flatMap((c) => c.identifications).join(', ') || '(sin código)';
        return { status: 'fail', detail: `Códigos [${codes}]; se esperaba ${describeValue(facet.value)}` };
      }
      return { status: 'pass', detail: '' };
    }

    case 'partOf': {
      const target = `${describeName(facet.entity.name)}${facet.relation ? ` (${facet.relation})` : ''}`;
      const ancestors = collectAncestors(view, id, facet.relation);
      if (ancestors.length === 0) return { status: 'absent', detail: `No forma parte de ningún ${target}` };
      if (!ancestors.some((a) => evaluateEntity(view, a, facet.entity).status === 'pass')) {
        return { status: 'fail', detail: `No forma parte de ${target}` };
      }
      return { status: 'pass', detail: '' };
    }
  }
}

function evaluateEntity(view: IdsModelView, id: number, facet: EntityFacet): FacetOutcome {
  const entity = view.entityName(id);
  if (!matchesEntityName(facet.name, entity)) {
    return { status: 'fail', detail: `La clase ${entity} no es ${describeName(facet.name)}` };
  }
  if (facet.predefinedType) {
    const predefined = view.predefinedType(id);
    if (predefined === null || !matchesValue(facet.predefinedType, predefined)) {
      return { status: 'fail', detail: `PredefinedType ${predefined ?? '(vacío)'}; se esperaba ${describeValue(facet.predefinedType)}` };
    }
  }
  return { status: 'pass', detail: '' };
}

/**
 * Ancestros transitivos por la relación indicada. Para la contención espacial se sube también
 * por agregación (un muro en una planta forma parte del edificio). Sin relación: cualquiera.
 */
function collectAncestors(view: IdsModelView, id: number, relation: IdsRelation | null): number[] {
  const relations: readonly IdsRelation[] =
    relation === null ? IDS_RELATIONS : relation === 'IFCRELCONTAINEDINSPATIALSTRUCTURE' ? SPATIAL_PARENT_RELATIONS : [relation];
  const seen = new Set<number>([id]);
  const queue = [id];
  const result: number[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const rel of relations) {
      for (const parent of view.parents(current, rel)) {
        if (seen.has(parent)) continue;
        seen.add(parent);
        result.push(parent);
        queue.push(parent);
      }
    }
  }
  return result;
}

export function describeFacet(facet: IdsFacet): string {
  switch (facet.facet) {
    case 'entity':
      return `clase ${describeName(facet.name)}${facet.predefinedType ? ` de tipo ${describeValue(facet.predefinedType)}` : ''}`;
    case 'attribute':
      return `atributo ${describeName(facet.name)}${facet.value ? ` = ${describeValue(facet.value)}` : ''}`;
    case 'property':
      return `propiedad ${describeName(facet.propertySet)}.${describeName(facet.baseName)}${
        facet.value ? ` = ${describeValue(facet.value)}` : ''
      }${facet.dataType ? ` (${facet.dataType})` : ''}`;
    case 'material':
      return facet.value ? `material ${describeValue(facet.value)}` : 'material asignado';
    case 'classification':
      return `clasificación${facet.system ? ` del sistema ${describeName(facet.system)}` : ''}${
        facet.value ? ` con código ${describeValue(facet.value)}` : ''
      }`;
    case 'partOf':
      return `formar parte de ${describeFacet(facet.entity)}${facet.relation ? ` (${facet.relation})` : ''}`;
  }
}
