import './presentation/styles/tokens.css';
import './presentation/styles/reset.css';
import './presentation/styles/layout.css';
import './presentation/styles/components.css';

import { initialState, type AppState, type PanelId, type RenderMode } from './application/AppState';
import { Store } from './application/Store';
import { elementStatusByModel } from './domain/ids/IdsReport';
import { IdsService } from './domain/services/IdsService';
import { ModelService } from './domain/services/ModelService';
import { WebIfcEngine } from './infrastructure/ifc/WebIfcEngine';
import { parseIds } from './infrastructure/ids/IdsXmlParser';
import { IdsPanel } from './presentation/components/IdsPanel';
import { ModelsPanel } from './presentation/components/ModelsPanel';
import { PropertiesPanel } from './presentation/components/PropertiesPanel';
import { SpatialTreePanel } from './presentation/components/SpatialTreePanel';
import { Viewport3D } from './presentation/viewport/Viewport3D';
import { byId } from './shared/dom';
import { downloadText } from './shared/download';

const SAMPLE_URL = `${import.meta.env.BASE_URL}samples/ejemplo-basico.ifc`;
const SAMPLE_IDS_URL = `${import.meta.env.BASE_URL}samples/ejemplo-basico.ids`;
const isIdsFile = (f: File) => /\.(ids|xml)$/i.test(f.name);

// ── Composición ────────────────────────────────
const store = new Store<AppState>(initialState);
const viewport = new Viewport3D(byId('viewport-3d'));
const modelService = new ModelService(new WebIfcEngine(), viewport, store);
const idsService = new IdsService(modelService, store, parseIds);
const idsInput = byId<HTMLInputElement>('ids-input');

new ModelsPanel(byId('panel-models'), store, modelService, (id) => viewport.fitModel(id));
new SpatialTreePanel(byId('panel-tree'), store, modelService, (key) => viewport.fitElement(key));
new PropertiesPanel(byId('panel-props'), store, modelService);
new IdsPanel(byId('panel-ids'), store, idsService, {
  openFile: () => idsInput.click(),
  loadSample: () => void loadSampleIds(),
  focus: (key) => viewport.fitElement(key),
  download: downloadText,
});

// ── Viewport ↔ estado ──────────────────────────
viewport.onPick = (key) => store.setState({ selection: key });
store.select((s) => s.selection, (sel) => viewport.setSelection(sel));
store.select((s) => s.renderMode, (mode) => viewport.setRenderMode(mode));
store.select((s) => s.section, ({ enabled, level }) => viewport.setSection(enabled, level));

// ── IDS ────────────────────────────────────────
idsInput.addEventListener('change', () => {
  const file = idsInput.files?.[0];
  idsInput.value = '';
  if (file) void idsService.loadFile(file);
});

async function loadSampleIds(): Promise<void> {
  try {
    const res = await fetch(SAMPLE_IDS_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await idsService.loadXml('ejemplo-basico.ids', await res.text());
  } catch (err) {
    store.setState({ status: `No se pudo cargar el IDS de ejemplo: ${(err as Error).message}` });
  }
}

// Revalida al añadir o quitar modelos (no al cambiar su visibilidad).
store.select(
  (s) => s.models.map((m) => m.id).join(','),
  () => {
    if (store.getState().ids.document) void idsService.validate();
  },
  false,
);
store.select((s) => s.ids, ({ colorize, report, activeSpec }) =>
  viewport.setStatusColoring(colorize && report ? elementStatusByModel(report, activeSpec) : null),
);

// Al seleccionar en el 3D se muestran las propiedades, salvo que el usuario esté navegando el árbol.
store.select(
  (s) => s.selection,
  (sel) => {
    if (sel && store.getState().activePanel === 'models') store.setState({ activePanel: 'props' });
  },
  false,
);

// ── Toolbar ────────────────────────────────────
const fileInput = byId<HTMLInputElement>('file-input');
byId('btn-open').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const files = [...(fileInput.files ?? [])];
  fileInput.value = '';
  void modelService.loadFiles(files);
});

byId('btn-sample').addEventListener('click', async () => {
  try {
    store.setState({ busy: 'Descargando modelo de ejemplo…' });
    const res = await fetch(SAMPLE_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await modelService.loadModel('ejemplo-basico.ifc', new Uint8Array(await res.arrayBuffer()));
  } catch (err) {
    console.error(err);
    store.setState({ busy: null, status: `No se pudo cargar el ejemplo: ${(err as Error).message}` });
  }
});

byId('btn-fit').addEventListener('click', () => viewport.fitAll());

const modeButtons = document.querySelectorAll<HTMLButtonElement>('.segmented [data-mode]');
modeButtons.forEach((btn) =>
  btn.addEventListener('click', () => store.setState({ renderMode: btn.dataset.mode as RenderMode })),
);
store.select((s) => s.renderMode, (mode) =>
  modeButtons.forEach((btn) => btn.setAttribute('aria-checked', String(btn.dataset.mode === mode))),
);

const sectionBtn = byId('btn-section');
const sectionControl = byId('section-control');
const sectionRange = byId<HTMLInputElement>('section-range');
sectionBtn.addEventListener('click', () =>
  store.setState((s) => ({ section: { ...s.section, enabled: !s.section.enabled } })),
);
sectionRange.addEventListener('input', () =>
  store.setState((s) => ({ section: { ...s.section, level: Number(sectionRange.value) } })),
);
store.select((s) => s.section, ({ enabled, level }) => {
  sectionBtn.setAttribute('aria-pressed', String(enabled));
  sectionControl.hidden = !enabled;
  sectionRange.value = String(level);
});

// ── Pestañas del sidebar ───────────────────────
const tabs = document.querySelectorAll<HTMLButtonElement>('.tabs [data-tab]');
const panels = document.querySelectorAll<HTMLElement>('.panel[data-panel]');
tabs.forEach((tab) => tab.addEventListener('click', () => store.setState({ activePanel: tab.dataset.tab as PanelId })));
store.select((s) => s.activePanel, (active) => {
  tabs.forEach((tab) => tab.setAttribute('aria-selected', String(tab.dataset.tab === active)));
  panels.forEach((panel) => (panel.hidden = panel.dataset.panel !== active));
});

// ── Arrastrar y soltar ─────────────────────────
const dropOverlay = byId('drop-overlay');
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer?.types.includes('Files')) return;
  dragDepth++;
  dropOverlay.hidden = false;
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropOverlay.hidden = true;
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  dropOverlay.hidden = true;
  const files = [...(e.dataTransfer?.files ?? [])];
  const idsFile = files.find(isIdsFile);
  const ifcFiles = files.filter((f) => !isIdsFile(f));
  void (async () => {
    // Primero los modelos, para que el IDS se valide una sola vez con todos cargados.
    if (ifcFiles.length > 0) await modelService.loadFiles(ifcFiles);
    if (idsFile) await idsService.loadFile(idsFile);
  })();
});

// ── Atajos de teclado ──────────────────────────
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'f' || e.key === 'F') viewport.fitAll();
  if (e.key === 'Escape') store.setState({ selection: null });
});

// ── Overlays y barra de estado ─────────────────
const loadingOverlay = byId('loading-overlay');
const loadingText = byId('loading-text');
store.select((s) => s.busy, (busy) => {
  loadingOverlay.hidden = busy === null;
  if (busy) loadingText.textContent = busy;
});
store.select((s) => s.models.length, (count) => (byId('empty-state').hidden = count > 0));
store.select((s) => s.status, (status) => (byId('status-message').textContent = status));

const statusInfo = byId('status-info');
viewport.onFrame = ({ triangles, drawCalls }) => {
  const count = store.getState().models.length;
  statusInfo.textContent = count
    ? `${count} modelo${count > 1 ? 's' : ''} · ${triangles.toLocaleString('es')} triángulos · ${drawCalls} draw calls · WebGL`
    : 'WebGL · web-ifc';
};
