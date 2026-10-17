import type { Store } from '../../application/Store';
import type { AppState } from '../../application/AppState';
import type { ElementKey } from '../../domain/models/ElementKey';
import type { SpatialNode } from '../../domain/models/LoadedModel';
import type { ModelService } from '../../domain/services/ModelService';
import { h } from '../../shared/dom';
import { AUTO_EXPAND_TYPES, SPATIAL_CONTAINER_TYPES } from '../../shared/ifc-classes';

interface RenderedNode {
  item: HTMLLIElement;
  row: HTMLButtonElement;
  node: SpatialNode;
  modelId: string;
  childrenList: HTMLUListElement | null;
}

const keyOf = (modelId: string, expressId: number) => `${modelId}:${expressId}`;

/**
 * Árbol de estructura espacial IFC por modelo. Los hijos se crean al desplegar,
 * así modelos con decenas de miles de elementos no bloquean el panel.
 */
export class SpatialTreePanel {
  private expanded = new Set<string>();
  private rendered = new Map<string, RenderedNode>();
  private selectedKey: string | null = null;

  constructor(
    private root: HTMLElement,
    private store: Store<AppState>,
    private models: ModelService,
    private onFocus: (key: ElementKey) => void,
  ) {
    store.select((s) => s.models, () => this.render());
    store.select((s) => s.selection, (sel) => this.markSelection(sel));
  }

  private render(): void {
    const { models } = this.store.getState();
    this.rendered.clear();
    if (models.length === 0) {
      this.root.replaceChildren(h('p', { className: 'panel-empty' }, 'Carga un modelo para ver su estructura espacial.'));
      return;
    }
    this.root.replaceChildren(
      ...models.map((m) => {
        const tree = this.models.getSpatialTree(m.id);
        const list = h('ul', { role: 'tree', 'aria-label': m.filename });
        if (tree) list.append(this.renderNode(m.id, tree, true));
        else list.append(h('li', { className: 'panel-empty' }, 'Sin estructura espacial'));
        return h('div', { className: 'tree-model' }, h('div', { className: 'model-name' }, m.filename), list);
      }),
    );
    this.markSelection(this.store.getState().selection);
  }

  private renderNode(modelId: string, node: SpatialNode, autoExpand: boolean): HTMLLIElement {
    const key = keyOf(modelId, node.expressId);
    const hasChildren = node.children.length > 0;
    if (autoExpand && AUTO_EXPAND_TYPES.has(node.type)) this.expanded.add(key);

    const caret = h('span', { className: 'tree-caret', 'aria-hidden': 'true' }, hasChildren ? '▸' : '');
    const label = node.name ?? node.type;
    const row = h(
      'button',
      {
        type: 'button',
        className: 'tree-row',
        role: 'treeitem',
        'aria-selected': 'false',
        title: `${label} · #${node.expressId}`,
        onclick: () => {
          if (hasChildren && SPATIAL_CONTAINER_TYPES.has(node.type)) this.toggle(key);
          this.store.setState({ selection: { modelId, expressId: node.expressId } });
        },
        ondblclick: () => this.onFocus({ modelId, expressId: node.expressId }),
      },
      caret,
      h('span', { className: 'tree-label' }, label),
      h('span', { className: 'tree-type' }, hasChildren ? `${node.type} (${node.children.length})` : node.type),
    );
    caret.addEventListener('click', (e) => {
      e.stopPropagation();
      if (hasChildren) this.toggle(key);
    });

    const item = h('li', {}, row);
    const entry: RenderedNode = { item, row, node, modelId, childrenList: null };
    this.rendered.set(key, entry);
    if (this.expanded.has(key)) this.expand(entry, autoExpand);
    return item;
  }

  private toggle(key: string): void {
    const entry = this.rendered.get(key);
    if (!entry) return;
    if (this.expanded.has(key)) {
      this.expanded.delete(key);
      entry.childrenList?.remove();
      entry.childrenList = null;
      this.forgetDescendants(entry.node, entry.modelId);
      setCaret(entry, false);
    } else {
      this.expanded.add(key);
      this.expand(entry, false);
    }
  }

  private expand(entry: RenderedNode, autoExpand: boolean): void {
    if (entry.childrenList) return;
    const list = h('ul', { className: 'tree-children', role: 'group' });
    for (const child of entry.node.children) list.append(this.renderNode(entry.modelId, child, autoExpand));
    entry.item.append(list);
    entry.childrenList = list;
    setCaret(entry, true);
    if (this.selectedKey) this.rendered.get(this.selectedKey)?.row.setAttribute('aria-selected', 'true');
  }

  private forgetDescendants(node: SpatialNode, modelId: string): void {
    for (const child of node.children) {
      this.rendered.delete(keyOf(modelId, child.expressId));
      this.forgetDescendants(child, modelId);
    }
  }

  /** Marca la fila seleccionada y despliega sus ancestros (p. ej. tras un clic en el 3D). */
  private markSelection(selection: ElementKey | null): void {
    if (this.selectedKey) this.rendered.get(this.selectedKey)?.row.setAttribute('aria-selected', 'false');
    this.selectedKey = selection ? keyOf(selection.modelId, selection.expressId) : null;
    if (!selection) return;
    const selectedKey = keyOf(selection.modelId, selection.expressId);

    const tree = this.models.getSpatialTree(selection.modelId);
    const path = tree ? findPath(tree, selection.expressId) : null;
    if (!path) return;
    for (const ancestor of path.slice(0, -1)) {
      const key = keyOf(selection.modelId, ancestor.expressId);
      this.expanded.add(key);
      const entry = this.rendered.get(key);
      if (entry) this.expand(entry, false);
    }
    const entry = this.rendered.get(selectedKey);
    if (entry) {
      entry.row.setAttribute('aria-selected', 'true');
      entry.row.scrollIntoView({ block: 'nearest' });
    }
  }
}

function setCaret(entry: RenderedNode, open: boolean): void {
  const caret = entry.row.querySelector('.tree-caret');
  if (caret && entry.node.children.length > 0) caret.textContent = open ? '▾' : '▸';
}

function findPath(node: SpatialNode, expressId: number): SpatialNode[] | null {
  if (node.expressId === expressId) return [node];
  for (const child of node.children) {
    const path = findPath(child, expressId);
    if (path) return [node, ...path];
  }
  return null;
}
