import type { Store } from '../../application/Store';
import type { AppState } from '../../application/AppState';
import type { ModelService } from '../../domain/services/ModelService';
import { h } from '../../shared/dom';

/** Lista de modelos federados con visibilidad, encuadre y cierre. */
export class ModelsPanel {
  constructor(
    private root: HTMLElement,
    private store: Store<AppState>,
    private models: ModelService,
    private onFit: (modelId: string) => void,
  ) {
    store.select((s) => s.models, () => this.render());
  }

  private render(): void {
    const { models } = this.store.getState();
    if (models.length === 0) {
      this.root.replaceChildren(
        h('p', { className: 'panel-empty' }, 'No hay modelos cargados. Abre uno o varios ficheros IFC para federarlos en la misma escena.'),
      );
      return;
    }

    this.root.replaceChildren(
      ...models.map((m) => {
        const checkbox = h('input', {
          type: 'checkbox',
          checked: m.visible,
          'aria-label': `Mostrar ${m.filename}`,
          onchange: (e: Event) => this.models.setVisibility(m.id, (e.target as HTMLInputElement).checked),
        });
        const meta = [m.metadata.schema, `${m.elementCount.toLocaleString('es')} elementos`, `${Math.round(m.triangleCount).toLocaleString('es')} triángulos`];
        return h(
          'div',
          { className: 'model-card' },
          checkbox,
          h(
            'div',
            { style: 'min-width:0' },
            h('div', { className: 'model-name', title: m.filename }, m.filename),
            m.metadata.projectName && h('div', { className: 'model-meta' }, m.metadata.projectName),
            h('div', { className: 'model-meta' }, meta.join(' · ')),
            m.metadata.application && h('div', { className: 'model-meta' }, m.metadata.application),
          ),
          h(
            'div',
            { className: 'model-actions' },
            h('button', { className: 'btn btn-icon', type: 'button', title: 'Encuadrar', onclick: () => this.onFit(m.id) }, '⤢'),
            h(
              'button',
              { className: 'btn btn-icon danger', type: 'button', title: 'Cerrar modelo', onclick: () => this.models.unloadModel(m.id) },
              '✕',
            ),
          ),
        );
      }),
    );
  }
}
