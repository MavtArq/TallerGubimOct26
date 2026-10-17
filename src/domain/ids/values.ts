import type { IdsValue } from './IdsDocument';
import type { IfcScalar } from './IdsModelView';

/** Tolerancia de IDS 1.0 para comparar números reales. */
function approxEqual(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= 1e-6 * (1 + Math.abs(expected));
}

function asBoolean(value: IfcScalar): boolean | null {
  if (typeof value === 'boolean') return value;
  const s = String(value).toUpperCase();
  if (s === 'TRUE' || s === 'T' || s === '.T.' || s === '1') return true;
  if (s === 'FALSE' || s === 'F' || s === '.F.' || s === '0') return false;
  return null;
}

function matchesSimple(expected: string, actual: IfcScalar): boolean {
  if (typeof actual === 'number') {
    const n = Number(expected);
    return expected.trim() !== '' && !Number.isNaN(n) && approxEqual(actual, n);
  }
  if (typeof actual === 'boolean') return asBoolean(expected) === actual;
  if (actual === expected) return true;
  // IfcLogical/IfcBoolean llegan a veces como 'T'/'F'.
  const a = asBoolean(actual);
  const e = asBoolean(expected);
  return a !== null && e !== null && /^(T|F|\.T\.|\.F\.)$/i.test(actual) && a === e;
}

const regexCache = new Map<string, RegExp | null>();

/** Las expresiones XSD están ancladas implícitamente al valor completo. */
function xsdRegex(pattern: string): RegExp | null {
  if (!regexCache.has(pattern)) {
    try {
      regexCache.set(pattern, new RegExp(`^(?:${pattern})$`, 'u'));
    } catch {
      regexCache.set(pattern, null);
    }
  }
  return regexCache.get(pattern)!;
}

function toNumber(value: IfcScalar): number {
  return typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
}

export function matchesValue(constraint: IdsValue, actual: IfcScalar): boolean {
  if (constraint.kind === 'simple') return matchesSimple(constraint.value, actual);

  const c = constraint;
  if (c.enumeration.length > 0 && !c.enumeration.some((e) => matchesSimple(e, actual))) return false;
  if (c.patterns.length > 0 && !c.patterns.some((p) => xsdRegex(p)?.test(String(actual)) ?? false)) return false;

  if (c.minInclusive !== undefined || c.maxInclusive !== undefined || c.minExclusive !== undefined || c.maxExclusive !== undefined) {
    const n = toNumber(actual);
    if (Number.isNaN(n)) return false;
    if (c.minInclusive !== undefined && n < c.minInclusive && !approxEqual(n, c.minInclusive)) return false;
    if (c.maxInclusive !== undefined && n > c.maxInclusive && !approxEqual(n, c.maxInclusive)) return false;
    if (c.minExclusive !== undefined && n <= c.minExclusive) return false;
    if (c.maxExclusive !== undefined && n >= c.maxExclusive) return false;
  }

  const length = String(actual).length;
  if (c.length !== undefined && length !== c.length) return false;
  if (c.minLength !== undefined && length < c.minLength) return false;
  if (c.maxLength !== undefined && length > c.maxLength) return false;
  return true;
}

/** Comparación de nombres de clase IFC: insensible a mayúsculas. */
export function matchesEntityName(constraint: IdsValue, entityName: string): boolean {
  const upper = entityName.toUpperCase();
  if (constraint.kind === 'simple') return constraint.value.toUpperCase() === upper;
  const withoutPatterns = { ...constraint, enumeration: constraint.enumeration.map((e) => e.toUpperCase()), patterns: [] };
  if (!matchesValue(withoutPatterns, upper)) return false;
  return (
    constraint.patterns.length === 0 ||
    constraint.patterns.some((p) => {
      const re = xsdRegex(p);
      return !!re && (re.test(upper) || re.test(entityName));
    })
  );
}

/** Texto legible de una restricción, para motivos de fallo y resumen de facetas. */
export function describeValue(constraint: IdsValue): string {
  if (constraint.kind === 'simple') return `«${constraint.value}»`;
  const parts: string[] = [];
  const c = constraint;
  if (c.enumeration.length > 0) parts.push(`uno de [${c.enumeration.join(', ')}]`);
  if (c.patterns.length > 0) parts.push(`patrón /${c.patterns.join('|')}/`);
  if (c.minInclusive !== undefined) parts.push(`≥ ${c.minInclusive}`);
  if (c.minExclusive !== undefined) parts.push(`> ${c.minExclusive}`);
  if (c.maxInclusive !== undefined) parts.push(`≤ ${c.maxInclusive}`);
  if (c.maxExclusive !== undefined) parts.push(`< ${c.maxExclusive}`);
  if (c.length !== undefined) parts.push(`longitud ${c.length}`);
  if (c.minLength !== undefined) parts.push(`longitud ≥ ${c.minLength}`);
  if (c.maxLength !== undefined) parts.push(`longitud ≤ ${c.maxLength}`);
  return parts.join(' y ') || 'cualquier valor';
}

/** Como describeValue, pero sin comillas para nombres (clases, Psets, propiedades, atributos). */
export function describeName(constraint: IdsValue): string {
  return constraint.kind === 'simple' ? constraint.value : describeValue(constraint);
}

export function formatActual(value: IfcScalar): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return `«${value}»`;
}
