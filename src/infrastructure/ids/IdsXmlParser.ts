import {
  IDS_RELATIONS,
  type EntityFacet,
  type FacetCardinality,
  type IdsDocument,
  type IdsFacet,
  type IdsRelation,
  type IdsSpecification,
  type IdsValue,
} from '../../domain/ids/IdsDocument';

/** Lee un fichero .ids (XML, IDS 1.0; acepta también la sintaxis de 0.9). Ignora prefijos de namespace. */
export function parseIds(xml: string): IdsDocument {
  const dom = new DOMParser().parseFromString(xml, 'application/xml');
  if (dom.getElementsByTagName('parsererror').length > 0) throw new Error('El fichero no es un XML válido');
  const root = dom.documentElement;
  if (root.localName !== 'ids') throw new Error('El XML no es un documento IDS (falta el elemento <ids>)');

  const info = child(root, 'info');
  const specs = children(child(root, 'specifications'), 'specification').map(parseSpecification);
  if (specs.length === 0) throw new Error('El IDS no contiene especificaciones');

  return {
    title: text(child(info, 'title')) ?? 'IDS sin título',
    version: text(child(info, 'version')),
    author: text(child(info, 'author')),
    date: text(child(info, 'date')),
    description: text(child(info, 'description')),
    purpose: text(child(info, 'purpose')),
    milestone: text(child(info, 'milestone')),
    specifications: specs,
  };
}

function parseSpecification(el: Element, index: number): IdsSpecification {
  const applicability = child(el, 'applicability');
  const requirements = child(el, 'requirements');
  // IDS 1.0: minOccurs/maxOccurs en <applicability>; IDS 0.9: en <specification>.
  const occursEl = applicability?.hasAttribute('minOccurs') || applicability?.hasAttribute('maxOccurs') ? applicability : el;
  return {
    name: el.getAttribute('name') || `Especificación ${index + 1}`,
    identifier: el.getAttribute('identifier'),
    description: el.getAttribute('description'),
    instructions: el.getAttribute('instructions'),
    ifcVersions: (el.getAttribute('ifcVersion') ?? '').split(/\s+/).filter(Boolean),
    cardinality: occursToCardinality(occursEl, 'required'),
    applicability: elementChildren(applicability).map(parseFacet).filter((f): f is IdsFacet => f !== null),
    requirements: elementChildren(requirements).map(parseFacet).filter((f): f is IdsFacet => f !== null),
    requirementsDescription: requirements?.getAttribute('description') ?? null,
  };
}

function parseFacet(el: Element): IdsFacet | null {
  const cardinality = facetCardinality(el);
  switch (el.localName) {
    case 'entity':
      return parseEntity(el);
    case 'attribute':
      return { facet: 'attribute', name: requiredValue(el, 'name'), value: optionalValue(el, 'value'), cardinality };
    case 'property':
      return {
        facet: 'property',
        propertySet: requiredValue(el, 'propertySet'),
        // IDS 1.0 usa <baseName>; 0.9 usaba <name>.
        baseName: optionalValue(el, 'baseName') ?? requiredValue(el, 'name'),
        value: optionalValue(el, 'value'),
        dataType: el.getAttribute('dataType') ?? el.getAttribute('measure'),
        cardinality,
      };
    case 'material':
      return { facet: 'material', value: optionalValue(el, 'value'), cardinality };
    case 'classification':
      return { facet: 'classification', system: optionalValue(el, 'system'), value: optionalValue(el, 'value'), cardinality };
    case 'partOf': {
      const entityEl = child(el, 'entity');
      if (!entityEl) throw new Error('Faceta partOf sin <entity>');
      const relation = el.getAttribute('relation')?.toUpperCase() ?? null;
      return {
        facet: 'partOf',
        relation: relation && IDS_RELATIONS.includes(relation as IdsRelation) ? (relation as IdsRelation) : null,
        entity: parseEntity(entityEl),
        cardinality,
      };
    }
    default:
      return null;
  }
}

function parseEntity(el: Element): EntityFacet {
  return { facet: 'entity', name: requiredValue(el, 'name'), predefinedType: optionalValue(el, 'predefinedType') };
}

function facetCardinality(el: Element): FacetCardinality {
  const c = el.getAttribute('cardinality');
  if (c === 'required' || c === 'optional' || c === 'prohibited') return c;
  return occursToCardinality(el, 'required');
}

function occursToCardinality(el: Element | null, fallback: FacetCardinality): FacetCardinality {
  if (!el) return fallback;
  if (el.getAttribute('maxOccurs') === '0') return 'prohibited';
  if (el.getAttribute('minOccurs') === '0') return 'optional';
  return fallback;
}

function requiredValue(el: Element, name: string): IdsValue {
  const value = optionalValue(el, name);
  if (!value) throw new Error(`Faceta <${el.localName}> sin <${name}>`);
  return value;
}

function optionalValue(el: Element, name: string): IdsValue | null {
  const container = child(el, name);
  return container ? parseValue(container) : null;
}

function parseValue(el: Element): IdsValue | null {
  const simple = child(el, 'simpleValue');
  if (simple) return { kind: 'simple', value: simple.textContent?.trim() ?? '' };
  const restriction = child(el, 'restriction');
  if (!restriction) {
    const raw = el.textContent?.trim();
    return raw ? { kind: 'simple', value: raw } : null;
  }

  const values = (tag: string) => children(restriction, tag).map((c) => c.getAttribute('value') ?? '');
  const num = (tag: string) => {
    const v = values(tag)[0];
    return v === undefined || v === '' || Number.isNaN(Number(v)) ? undefined : Number(v);
  };
  return {
    kind: 'restriction',
    base: restriction.getAttribute('base'),
    enumeration: values('enumeration'),
    patterns: values('pattern'),
    minInclusive: num('minInclusive'),
    maxInclusive: num('maxInclusive'),
    minExclusive: num('minExclusive'),
    maxExclusive: num('maxExclusive'),
    length: num('length'),
    minLength: num('minLength'),
    maxLength: num('maxLength'),
  };
}

// ── Helpers DOM (por localName, sin depender del prefijo) ──

function elementChildren(el: Element | null): Element[] {
  return el ? Array.from(el.children) : [];
}

function children(el: Element | null, localName: string): Element[] {
  return elementChildren(el).filter((c) => c.localName === localName);
}

function child(el: Element | null, localName: string): Element | null {
  return children(el, localName)[0] ?? null;
}

function text(el: Element | null): string | null {
  const t = el?.textContent?.trim();
  return t ? t : null;
}
