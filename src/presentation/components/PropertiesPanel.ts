import type { Store } from '../../application/Store';
import type { AppState } from '../../application/AppState';
import type { ElementKey } from '../../domain/models/ElementKey';
import type { ElementProperties, PropertyEntry } from '../../domain/models/LoadedModel';
import type { ModelService } from '../../domain/services/ModelService';
import { h } from '../../shared/dom';

/** Atributos, Property Sets, Quantity Sets y materiales del elemento seleccionado. */
export class PropertiesPanel {
  /** Evita que una respuesta lenta de una selección anterior pise a la actual. */
  private requestId = 0;

  constructor(
    private root: HTMLElement,
    store: Store<AppState>,
    private models: ModelService,
  ) {
    store.select((s) => s.selection, (sel) => void this.show(sel));
  }

  private async show(selection: ElementKey | null): Promise<void> {
    const request = ++this.requestId;
    if (!selection) {
      this.root.replaceChildren(h('p', { className: 'panel-empty' }, 'Haz clic en un elemento del modelo o del árbol para ver sus propiedades.'));
      return;
    }
    this.root.replaceChildren(h('p', { className: 'panel-empty' }, 'Leyendo propiedades…'));
    try {
      const props = await this.models.getProperties(selection);
      if (request !== this.requestId) return;
      if (!props) {
        this.root.replaceChildren(h('p', { className: 'panel-empty' }, 'El elemento ya no está disponible.'));
        return;
      }
      this.root.replaceChildren(...this.renderProperties(props));
    } catch (err) {
      if (request !== this.requestId) return;
      console.error(err);
      this.root.replaceChildren(h('p', { className: 'panel-empty' }, `No se pudieron leer las propiedades: ${(err as Error).message}`));
    }
  }

  private renderProperties(props: ElementProperties): Node[] {
    const nodes: Node[] = [
      h(
        'div',
        { className: 'props-header' },
        h('h2', { className: 'props-title' }, props.name ?? props.type),
        h('div', { className: 'props-subtitle' }, `${props.type} · #${props.expressId}`),
      ),
      group('Atributos', props.attributes, true),
    ];
    if (props.materials.length > 0) {
      nodes.push(group('Materiales', props.materials.map((name, i) => ({ name: `Material ${i + 1}`, value: name })), true));
    }
    for (const g of props.groups) nodes.push(group(g.name, g.entries, false));
    return nodes;
  }
}

function group(title: string, entries: PropertyEntry[], open: boolean): HTMLElement {
  return h(
    'details',
    { className: 'props-group', open },
    h('summary', {}, title),
    h(
      'table',
      { className: 'props-table' },
      h(
        'tbody',
        {},
        ...entries.map((e) =>
          h('tr', {}, h('th', { scope: 'row' }, e.name), h('td', { className: e.name === 'GlobalId' ? 'mono' : undefined }, e.value)),
        ),
      ),
    ),
  );
}
