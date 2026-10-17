import type { Store } from '../../application/Store';
import { nextFrame } from '../../shared/async';
import type { AppState } from '../../application/AppState';
import type { IdsModelView } from '../ids/IdsModelView';
import type { EngineHandle, IIfcEngine } from '../interfaces/IIfcEngine';
import type { IModelRenderer } from '../interfaces/IModelRenderer';
import type { ElementKey } from '../models/ElementKey';
import type { ElementProperties, GeometryChunk, ModelInfo, SpatialNode } from '../models/LoadedModel';

interface RegistryEntry {
  handle: EngineHandle;
  spatialTree: SpatialNode | null;
  /** Se crea la primera vez que se valida con IDS. */
  idsView: IdsModelView | null;
}

/** Gestión de modelos federados: carga, registro, visibilidad y descarga. */
export class ModelService {
  private registry = new Map<string, RegistryEntry>();
  private nextId = 1;

  constructor(
    private engine: IIfcEngine,
    private renderer: IModelRenderer,
    private store: Store<AppState>,
  ) {}

  async loadFiles(files: File[]): Promise<void> {
    const ifcFiles = files.filter((f) => f.name.toLowerCase().endsWith('.ifc'));
    if (ifcFiles.length === 0) {
      this.store.setState({ status: 'Ningún fichero .ifc entre los seleccionados' });
      return;
    }
    for (const file of ifcFiles) {
      try {
        await this.loadModel(file.name, new Uint8Array(await file.arrayBuffer()));
      } catch (err) {
        console.error(err);
        this.store.setState({ busy: null, status: `Error al cargar ${file.name}: ${(err as Error).message}` });
      }
    }
  }

  async loadModel(filename: string, data: Uint8Array): Promise<string> {
    const id = `m${this.nextId++}`;
    const t0 = performance.now();

    this.store.setState({ busy: `Inicializando motor IFC…` });
    await this.engine.init();

    this.store.setState({ busy: `Procesando ${filename} (${formatBytes(data.byteLength)})…` });
    // Cede un frame para que el overlay de carga se pinte antes del trabajo síncrono del WASM.
    await nextFrame();

    const handle = this.engine.open(data);
    try {
      const metadata = this.engine.getMetadata(handle);

      const chunks: GeometryChunk[] = [];
      this.engine.streamGeometry(handle, (chunk) => chunks.push(chunk));
      const stats = this.renderer.addModel(id, chunks);

      this.store.setState({ busy: `Leyendo estructura espacial de ${filename}…` });
      await nextFrame();
      const spatialTree = await this.engine.getSpatialTree(handle);

      this.registry.set(id, { handle, spatialTree, idsView: null });
      const info: ModelInfo = { id, filename, metadata, visible: true, ...stats };
      const seconds = ((performance.now() - t0) / 1000).toFixed(1);
      this.store.setState((s) => ({
        models: [...s.models, info],
        busy: null,
        status: `${filename} cargado en ${seconds} s · ${stats.elementCount} elementos`,
      }));
      this.renderer.fitAll();
      return id;
    } catch (err) {
      this.renderer.removeModel(id);
      this.engine.close(handle);
      throw err;
    }
  }

  unloadModel(id: string): void {
    const entry = this.registry.get(id);
    if (!entry) return;
    this.renderer.removeModel(id);
    this.engine.close(entry.handle);
    this.registry.delete(id);
    this.store.setState((s) => ({
      models: s.models.filter((m) => m.id !== id),
      selection: s.selection?.modelId === id ? null : s.selection,
    }));
  }

  setVisibility(id: string, visible: boolean): void {
    this.renderer.setModelVisible(id, visible);
    this.store.setState((s) => ({
      models: s.models.map((m) => (m.id === id ? { ...m, visible } : m)),
    }));
  }

  getSpatialTree(id: string): SpatialNode | null {
    return this.registry.get(id)?.spatialTree ?? null;
  }

  getIdsView(id: string): IdsModelView | null {
    const entry = this.registry.get(id);
    if (!entry) return null;
    entry.idsView ??= this.engine.createIdsView(entry.handle);
    return entry.idsView;
  }

  async getProperties(key: ElementKey): Promise<ElementProperties | null> {
    const entry = this.registry.get(key.modelId);
    if (!entry) return null;
    return this.engine.getProperties(entry.handle, key.expressId);
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
