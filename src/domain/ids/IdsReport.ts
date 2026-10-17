import type { IdsSpecResult } from './IdsValidator';

export interface IdsReport {
  results: IdsSpecResult[];
  /** modelId → nombre de fichero, en el momento de validar. */
  modelNames: Record<string, string>;
  date: string;
  durationMs: number;
}

export interface ElementStatusGroups {
  passed: Set<number>;
  failed: Set<number>;
}

/**
 * Agrupa los elementos por resultado para colorear el 3D. Con varias especificaciones,
 * un elemento que falla en cualquiera cuenta como fallido.
 */
export function elementStatusByModel(report: IdsReport, specIndex: number | null): Map<string, ElementStatusGroups> {
  const groups = new Map<string, ElementStatusGroups>();
  const get = (modelId: string) => {
    let g = groups.get(modelId);
    if (!g) groups.set(modelId, (g = { passed: new Set(), failed: new Set() }));
    return g;
  };
  const results = specIndex === null ? report.results : report.results.filter((r) => r.index === specIndex);
  for (const r of results) {
    for (const f of r.failures) get(f.key.modelId).failed.add(f.key.expressId);
  }
  for (const r of results) {
    for (const k of r.passed) {
      const g = get(k.modelId);
      if (!g.failed.has(k.expressId)) g.passed.add(k.expressId);
    }
  }
  return groups;
}
