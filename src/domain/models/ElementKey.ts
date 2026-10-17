/**
 * Clave compuesta de un elemento en una escena federada.
 * Los expressID se repiten entre ficheros IFC, por eso siempre van acompañados del id del modelo.
 */
export interface ElementKey {
  modelId: string;
  expressId: number;
}

export function sameElement(a: ElementKey | null, b: ElementKey | null): boolean {
  return a === b || (!!a && !!b && a.modelId === b.modelId && a.expressId === b.expressId);
}
