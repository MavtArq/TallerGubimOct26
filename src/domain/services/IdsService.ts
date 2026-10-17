import type { AppState } from '../../application/AppState';
import type { Store } from '../../application/Store';
import { nextFrame } from '../../shared/async';
import type { IdsDocument } from '../ids/IdsDocument';
import type { IdsReport } from '../ids/IdsReport';
import { validateSpecification, type IdsSpecResult, type ModelUnderTest } from '../ids/IdsValidator';
import type { ModelService } from './ModelService';

export const CARDINALITY_LABEL = { required: 'Obligatoria', optional: 'Opcional', prohibited: 'Prohibida' } as const;
export const STATUS_LABEL = { pass: 'Cumple', fail: 'No cumple', skipped: 'No aplica' } as const;

/** Carga de documentos IDS y validación de los modelos cargados contra ellos. */
export class IdsService {
  private running = false;
  private rerunRequested = false;

  constructor(
    private models: ModelService,
    private store: Store<AppState>,
    private parse: (xml: string) => IdsDocument,
  ) {}

  async loadFile(file: File): Promise<void> {
    await this.loadXml(file.name, await file.text());
  }

  async loadXml(filename: string, xml: string): Promise<void> {
    let document: IdsDocument;
    try {
      document = this.parse(xml);
    } catch (err) {
      this.patch({ error: `No se pudo leer ${filename}: ${(err as Error).message}` });
      this.store.setState({ activePanel: 'ids' });
      return;
    }
    this.patch({ filename, document, report: null, error: null, activeSpec: null });
    this.store.setState({
      activePanel: 'ids',
      status: `IDS «${document.title}» cargado · ${document.specifications.length} especificaciones`,
    });
    await this.validate();
  }

  clear(): void {
    this.patch({ filename: null, document: null, report: null, error: null, activeSpec: null });
  }

  /** Valida todos los modelos cargados. Si ya hay una validación en curso, se repite al terminar. */
  async validate(): Promise<void> {
    const { ids, models } = this.store.getState();
    if (!ids.document) return;
    if (models.length === 0) {
      this.patch({ report: null });
      return;
    }
    if (this.running) {
      this.rerunRequested = true;
      return;
    }

    this.running = true;
    const t0 = performance.now();
    try {
      this.store.setState({ busy: 'Preparando validación IDS…' });
      await nextFrame();
      const targets: ModelUnderTest[] = models
        .map((m) => ({ modelId: m.id, view: this.models.getIdsView(m.id) }))
        .filter((t): t is ModelUnderTest => t.view !== null);

      const specs = ids.document.specifications;
      const results: IdsSpecResult[] = [];
      for (const [i, spec] of specs.entries()) {
        this.store.setState({ busy: `Validando IDS (${i + 1}/${specs.length}): ${spec.name}` });
        await nextFrame();
        results.push(validateSpecification(spec, i, targets));
      }
      targets.forEach((t) => t.view.clearCache());

      const report: IdsReport = {
        results,
        modelNames: Object.fromEntries(models.map((m) => [m.id, m.filename])),
        date: new Date().toISOString(),
        durationMs: performance.now() - t0,
      };
      const passed = results.filter((r) => r.status === 'pass').length;
      const evaluated = results.filter((r) => r.status !== 'skipped').length;
      this.patch({ report, error: null });
      this.store.setState({ busy: null, status: `Validación IDS: ${passed} de ${evaluated} especificaciones cumplen` });
    } catch (err) {
      console.error(err);
      this.patch({ error: `Error durante la validación: ${(err as Error).message}` });
      this.store.setState({ busy: null });
    } finally {
      this.running = false;
    }

    if (this.rerunRequested) {
      this.rerunRequested = false;
      await this.validate();
    }
  }

  /** Informe CSV (separador «;» y BOM para que Excel en español lo abra directamente). */
  exportCsv(): string | null {
    const { report, document } = this.store.getState().ids;
    if (!report || !document) return null;
    const rows: string[][] = [
      ['Especificación', 'Identificador', 'Cardinalidad', 'Estado', 'Aplicables', 'Cumplen', 'Modelo', 'Elemento', 'Clase', 'GlobalId', 'Motivos'],
    ];
    for (const r of report.results) {
      const base = [
        r.spec.name,
        r.spec.identifier ?? '',
        CARDINALITY_LABEL[r.spec.cardinality],
        STATUS_LABEL[r.status],
        String(r.applicableCount),
        String(r.passed.length),
      ];
      if (r.failures.length === 0) {
        rows.push([...base, '', '', '', '', r.note ?? '']);
        continue;
      }
      for (const f of r.failures) {
        rows.push([...base, report.modelNames[f.key.modelId] ?? f.key.modelId, f.label, f.entity, f.globalId ?? '', f.reasons.join(' | ')]);
      }
    }
    const escape = (v: string) => (/[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    return '﻿' + rows.map((row) => row.map(escape).join(';')).join('\r\n');
  }

  private patch(partial: Partial<AppState['ids']>): void {
    this.store.setState((s) => ({ ids: { ...s.ids, ...partial } }));
  }
}
