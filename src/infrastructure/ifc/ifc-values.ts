/**
 * Decodifica las secuencias de escape de cadenas STEP (ISO 10303-21):
 * \X2\00F3\X0\ (UTF-16), \X\F3 (ISO-8859-1) y \S\c (ISO-8859-1 + 128).
 */
export function decodeIfcString(value: string): string {
  return value
    .replace(/\\X2\\((?:[0-9A-F]{4})+)\\X0\\/gi, (_, hex: string) =>
      String.fromCharCode(...(hex.match(/.{4}/g) ?? []).map((h) => parseInt(h, 16))),
    )
    .replace(/\\X\\([0-9A-F]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\S\\(.)/g, (_, c: string) => String.fromCharCode(c.charCodeAt(0) + 128));
}

/** Convierte un valor IFC tal como lo entrega web-ifc ({ type, value } o arrays) a texto legible. */
export function formatIfcValue(raw: unknown): string | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) {
    const parts = raw.map(formatIfcValue).filter((v): v is string => v !== null);
    return parts.length > 0 ? parts.join(', ') : null;
  }
  const value = typeof raw === 'object' && 'value' in raw ? (raw as { value: unknown }).value : raw;
  switch (typeof value) {
    case 'string':
      if (value === '') return null;
      if (value === 'T' || value === '.T.') return 'Sí';
      if (value === 'F' || value === '.F.') return 'No';
      return decodeIfcString(value);
    case 'number':
      return Number.isInteger(value) ? String(value) : String(Math.round(value * 10000) / 10000);
    case 'boolean':
      return value ? 'Sí' : 'No';
    default:
      return null;
  }
}
