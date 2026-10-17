import { describe, expect, it } from 'vitest';
import type { IdsValue } from '../../../../src/domain/ids/IdsDocument';
import { matchesEntityName, matchesValue } from '../../../../src/domain/ids/values';

const simple = (value: string): IdsValue => ({ kind: 'simple', value });
const restriction = (r: Partial<Extract<IdsValue, { kind: 'restriction' }>>): IdsValue => ({
  kind: 'restriction',
  base: null,
  enumeration: [],
  patterns: [],
  ...r,
});

describe('matchesValue', () => {
  it('compara cadenas de forma exacta', () => {
    expect(matchesValue(simple('EI 120'), 'EI 120')).toBe(true);
    expect(matchesValue(simple('EI 120'), 'ei 120')).toBe(false);
  });

  it('compara números con la tolerancia de IDS', () => {
    expect(matchesValue(simple('0.25'), 0.25000001)).toBe(true);
    expect(matchesValue(simple('0.25'), 0.251)).toBe(false);
    expect(matchesValue(simple('abc'), 1)).toBe(false);
  });

  it('acepta booleanos xs:boolean e IFC (T/F)', () => {
    expect(matchesValue(simple('true'), true)).toBe(true);
    expect(matchesValue(simple('false'), true)).toBe(false);
    expect(matchesValue(simple('true'), 'T')).toBe(true);
    expect(matchesValue(simple('TRUE'), true)).toBe(true);
  });

  it('evalúa enumeraciones y patrones anclados', () => {
    expect(matchesValue(restriction({ enumeration: ['A', 'B'] }), 'B')).toBe(true);
    expect(matchesValue(restriction({ enumeration: ['A', 'B'] }), 'C')).toBe(false);
    expect(matchesValue(restriction({ patterns: ['M-[0-9]{2}'] }), 'M-07')).toBe(true);
    expect(matchesValue(restriction({ patterns: ['M-[0-9]{2}'] }), 'XM-07')).toBe(false);
  });

  it('evalúa rangos numéricos y longitudes', () => {
    const range = restriction({ minInclusive: 0.2, maxExclusive: 0.3 });
    expect(matchesValue(range, 0.2)).toBe(true);
    expect(matchesValue(range, 0.3)).toBe(false);
    expect(matchesValue(range, '0.25')).toBe(true);
    expect(matchesValue(range, 'n/a')).toBe(false);
    expect(matchesValue(restriction({ minLength: 2, maxLength: 3 }), 'abcd')).toBe(false);
  });
});

describe('matchesEntityName', () => {
  it('ignora mayúsculas en nombres de clase', () => {
    expect(matchesEntityName(simple('IFCWALL'), 'IfcWall')).toBe(true);
    expect(matchesEntityName(simple('IfcWall'), 'IFCWALL')).toBe(true);
    expect(matchesEntityName(simple('IFCWALL'), 'IFCWALLSTANDARDCASE')).toBe(false);
    expect(matchesEntityName(restriction({ enumeration: ['IfcSlab', 'IFCCOLUMN'] }), 'IFCSLAB')).toBe(true);
    expect(matchesEntityName(restriction({ patterns: ['IFCWALL.*'] }), 'IFCWALLSTANDARDCASE')).toBe(true);
  });
});
