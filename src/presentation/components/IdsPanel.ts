import type { AppState } from '../../application/AppState';
import type { Store } from '../../application/Store';
import type { IdsFacet } from '../../domain/ids/IdsDocument';
import type { IdsReport } from '../../domain/ids/IdsReport';
import { describeFacet, type IdsSpecResult } from '../../domain/ids/IdsValidator';
import type { ElementKey } from '../../domain/models/ElementKey';
import { CARDINALITY_LABEL, STATUS_LABEL, type IdsService } from '../../domain/services/IdsService';
import { h } from '../../shared/dom';

/** Máximo de elementos fallidos listados por especificación (el CSV los incluye todos). */
const MAX_FAILURES_SHOWN = 200;

interface IdsPanelActions {
  openFile: () => void;
  loadSample: () => void;
  focus: (key: ElementKey) => void;
  download: (filename: string, content: string, mime: string) => void;
}

/** Revisión de modelos con IDS: documento cargado, resumen y resultado por especificación. */
export class IdsPanel {
  constructor(
    private root: HTMLElement,
    private store: Store<AppState>,
    private ids: IdsService,
    private actions: IdsPanelActions,
  ) {
    store.select((s) => s.ids, () => this.render());
    store.select((s) => s.models.length, () => this.render(), false);
    store.select((s) => s.selection, (sel) => this.markSelection(sel), false);
  }

  private render(): void {
    const { ids, models } = this.store.getState();
    const nodes: Node[] = [
      h(
        'div',
        { className: 'ids-actions' },
        h('button', { className: 'btn btn-primary', type: 'button', onclick: this.actions.openFile }, 'Cargar IDS'),
        h('button', { className: 'btn', type: 'button', onclick: this.actions.loadSample }, 'IDS de ejemplo'),
      ),
    ];

    if (ids.error) nodes.push(h('div', { className: 'ids-error', role: 'alert' }, ids.error));

    if (!ids.document) {
      nodes.push(
        h(
          'p',
          { className: 'panel-empty' },
          'Carga un fichero .ids (Information Delivery Specification de buildingSMART) para comprobar si los modelos cumplen los requisitos de información. También puedes arrastrarlo al visor.',
        ),
      );
      this.root.replaceChildren(...nodes);
      return;
    }

    const doc = ids.document;
    const meta = [doc.version && `v${doc.version}`, doc.author, doc.date, doc.milestone].filter(Boolean).join(' · ');
    nodes.push(
      h(
        'div',
        { className: 'ids-doc' },
        h('div', { className: 'model-name', title: ids.filename ?? '' }, doc.title),
        meta && h('div', { className: 'model-meta' }, meta),
        doc.description && h('div', { className: 'model-meta' }, doc.description),
        h('div', { className: 'model-meta' }, `${ids.filename} · ${doc.specifications.length} especificaciones`),
        h(
          'div',
          { className: 'ids-doc-actions' },
          h('button', { className: 'btn btn-icon', type: 'button', disabled: models.length === 0, onclick: () => void this.ids.validate() }, 'Validar de nuevo'),
          h('button', { className: 'btn btn-icon', type: 'button', disabled: !ids.report, onclick: () => this.exportCsv() }, 'Exportar CSV'),
          h('button', { className: 'btn btn-icon danger', type: 'button', onclick: () => this.ids.clear() }, 'Quitar'),
        ),
        h(
          'label',
          { className: 'ids-toggle' },
          h('input', {
            type: 'checkbox',
            checked: ids.colorize,
            onchange: (e: Event) =>
              this.store.setState((s) => ({ ids: { ...s.ids, colorize: (e.target as HTMLInputElement).checked } })),
          }),
          'Colorear resultados en el 3D',
        ),
      ),
    );

    if (models.length === 0) {
      nodes.push(h('p', { className: 'panel-empty' }, 'Carga uno o varios modelos IFC para validarlos contra este IDS.'));
    } else if (ids.report) {
      nodes.push(this.renderSummary(ids.report), ...ids.report.results.map((r) => this.renderSpec(r, ids.report!, ids.activeSpec)));
    }

    this.root.replaceChildren(...nodes);
    this.markSelection(this.store.getState().selection);
  }

  private renderSummary(report: IdsReport): HTMLElement {
    const evaluated = report.results.filter((r) => r.status !== 'skipped');
    const passed = evaluated.filter((r) => r.status === 'pass').length;
    const ratio = evaluated.length ? passed / evaluated.length : 0;
    const failedElements = new Set(report.results.flatMap((r) => r.failures.map((f) => `${f.key.modelId}:${f.key.expressId}`))).size;
    return h(
      'div',
      { className: 'ids-summary' },
      h('div', { className: 'ids-summary-title' }, `${passed} de ${evaluated.length} especificaciones cumplen`),
      h('div', { className: 'ids-bar', role: 'img', 'aria-label': `${Math.round(ratio * 100)} % de especificaciones cumplen` }, h('span', { style: `width:${ratio * 100}%` })),
      h(
        'div',
        { className: 'model-meta' },
        `${failedElements} elementos con incidencias · ${Object.values(report.modelNames).join(', ')} · ${(report.durationMs / 1000).toFixed(1)} s`,
      ),
    );
  }

  private renderSpec(result: IdsSpecResult, report: IdsReport, activeSpec: number | null): HTMLElement {
    const { spec } = result;
    const open = activeSpec === result.index;
    const multiModel = Object.keys(report.modelNames).length > 1;
    const counts =
      result.status === 'skipped' ? '' : spec.cardinality === 'prohibited' ? `${result.applicableCount} encontrados` : `${result.passed.length}/${result.applicableCount} cumplen`;

    const header = h(
      'button',
      {
        type: 'button',
        className: 'ids-spec-header',
        'aria-expanded': String(open),
        onclick: () => this.store.setState((s) => ({ ids: { ...s.ids, activeSpec: open ? null : result.index } })),
      },
      h('span', { className: `ids-badge ids-${result.status}` }, STATUS_LABEL[result.status]),
      h('span', { className: 'ids-spec-name', title: spec.name }, spec.name),
      h('span', { className: 'ids-spec-count' }, counts),
    );

    const card = h('section', { className: `ids-spec${open ? ' open' : ''}` }, header);
    if (!open) {
      if (result.note) card.append(h('div', { className: 'ids-note' }, result.note));
      return card;
    }

    const body = h(
      'div',
      { className: 'ids-spec-body' },
      h('div', { className: 'model-meta' }, [CARDINALITY_LABEL[spec.cardinality], spec.identifier, spec.ifcVersions.join(' ')].filter(Boolean).join(' · ')),
      spec.description && h('p', { className: 'ids-text' }, spec.description),
      spec.instructions && h('p', { className: 'ids-text ids-instructions' }, spec.instructions),
      result.note && h('div', { className: 'ids-note' }, result.note),
      facetList('Aplica a', spec.applicability, false),
      spec.requirements.length > 0 && facetList('Requisitos', spec.requirements, true),
    );

    if (result.failures.length > 0) {
      const list = h('ul', { className: 'ids-failures' });
      for (const f of result.failures.slice(0, MAX_FAILURES_SHOWN)) {
        list.append(
          h(
            'li',
            {},
            h(
              'button',
              {
                type: 'button',
                className: 'ids-failure',
                'data-key': `${f.key.modelId}:${f.key.expressId}`,
                title: 'Clic: seleccionar · Doble clic: encuadrar',
                onclick: () => this.store.setState({ selection: f.key }),
                ondblclick: () => this.actions.focus(f.key),
              },
              h('span', { className: 'ids-failure-label' }, f.label, h('span', { className: 'tree-type' }, f.entity)),
              multiModel && h('span', { className: 'model-meta' }, report.modelNames[f.key.modelId]),
              ...f.reasons.map((r) => h('span', { className: 'ids-reason' }, r)),
            ),
          ),
        );
      }
      body.append(h('div', { className: 'ids-section-title' }, `Elementos que no cumplen (${result.failures.length})`), list);
      if (result.failures.length > MAX_FAILURES_SHOWN) {
        body.append(h('div', { className: 'ids-note' }, `Se muestran ${MAX_FAILURES_SHOWN}; exporta el CSV para ver todos.`));
      }
    }
    card.append(body);
    return card;
  }

  private markSelection(selection: ElementKey | null): void {
    const key = selection ? `${selection.modelId}:${selection.expressId}` : null;
    this.root.querySelectorAll<HTMLElement>('.ids-failure').forEach((el) => el.setAttribute('aria-selected', String(el.dataset.key === key)));
  }

  private exportCsv(): void {
    const csv = this.ids.exportCsv();
    if (!csv) return;
    const name = (this.store.getState().ids.filename ?? 'ids').replace(/\.[^.]+$/, '');
    this.actions.download(`informe-${name}.csv`, csv, 'text/csv;charset=utf-8');
  }
}

function facetList(title: string, facets: IdsFacet[], showCardinality: boolean): HTMLElement {
  return h(
    'div',
    {},
    h('div', { className: 'ids-section-title' }, title),
    h(
      'ul',
      { className: 'ids-facets' },
      ...facets.map((f) => {
        const prefix = showCardinality && f.facet !== 'entity' && f.cardinality !== 'required' ? `${CARDINALITY_LABEL[f.cardinality]}: ` : '';
        return h('li', {}, prefix + describeFacet(f));
      }),
    ),
  );
}
