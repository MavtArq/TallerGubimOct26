import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { RenderMode } from '../../application/AppState';
import type { IModelRenderer, RenderedModelStats } from '../../domain/interfaces/IModelRenderer';
import type { ElementStatusGroups } from '../../domain/ids/IdsReport';
import type { ElementKey } from '../../domain/models/ElementKey';
import type { GeometryChunk } from '../../domain/models/LoadedModel';
import {
  buildModelMeshes,
  chunkReferencePoint,
  expressIdAtFace,
  type BuiltModel,
  type ElementRange,
  type FaceLookup,
} from './ModelMeshBuilder';

const HIGHLIGHT_COLOR = 0x2f9bff;
const XRAY_OPACITY = 0.12;
/** Opacidad del resto del modelo mientras se colorean resultados IDS. */
const GHOST_OPACITY = 0.07;
/** Desplazamiento máximo del puntero (px) para considerar un clic y no un arrastre de órbita. */
const CLICK_TOLERANCE = 5;

/** Viewport 3D sobre three.js (WebGL). Implementa el puerto IModelRenderer. */
export class Viewport3D implements IModelRenderer {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000);
  private controls: OrbitControls;
  private raycaster = new THREE.Raycaster();
  private models = new Map<string, BuiltModel>();
  /** Origen común de la escena federada (coordenadas IFC del primer modelo cargado). */
  private origin: THREE.Vector3 | null = null;
  private highlight: THREE.Group | null = null;
  private highlightMaterial = new THREE.MeshBasicMaterial({
    color: HIGHLIGHT_COLOR,
    transparent: true,
    opacity: 0.85,
    depthTest: true,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  private passMaterial = statusMaterial(0x2fb36d);
  private failMaterial = statusMaterial(0xe0483f);
  /** Mallas de coloreado IDS, una por modelo; vacío = sin coloreado. */
  private statusOverlays: THREE.Group[] = [];
  private statusColoring = false;
  private sectionPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  private sectionEnabled = false;
  private grid: THREE.GridHelper | null = null;
  private renderMode: RenderMode = 'shaded';
  private needsRender = true;
  private pointerDown: { x: number; y: number } | null = null;

  /** Se invoca al hacer clic en el visor: elemento bajo el cursor o null si es fondo. */
  onPick: (key: ElementKey | null) => void = () => {};
  onFrame: (info: { triangles: number; drawCalls: number }) => void = () => {};

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, logarithmicDepthBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    container.appendChild(this.renderer.domElement);

    this.camera.position.set(20, 15, 20);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;
    this.controls.addEventListener('change', () => this.requestRender());

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8d8d8d, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(0.6, 1, 0.4);
    this.scene.add(sun);
    this.setGrid(new THREE.Box3(new THREE.Vector3(-10, 0, -10), new THREE.Vector3(10, 0, 10)));

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.bindPointer();
    this.loop();
  }

  // ── IModelRenderer ───────────────────────────

  addModel(modelId: string, chunks: GeometryChunk[]): RenderedModelStats {
    if (!this.origin && chunks.length > 0) this.origin = chunkReferencePoint(chunks[0]);
    const built = buildModelMeshes(modelId, chunks, this.origin ?? new THREE.Vector3());
    this.models.set(modelId, built);
    this.scene.add(built.group);
    this.applyRenderMode();
    this.updateGrid();
    this.requestRender();
    return { elementCount: built.elementRanges.size, triangleCount: built.triangleCount };
  }

  removeModel(modelId: string): void {
    const built = this.models.get(modelId);
    if (!built) return;
    if (this.highlight?.parent === built.group) this.setSelection(null);
    this.statusOverlays = this.statusOverlays.filter((o) => {
      if (o.parent !== built.group) return true;
      disposeOverlay(o);
      return false;
    });
    this.scene.remove(built.group);
    for (const mesh of built.meshes) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.models.delete(modelId);
    if (this.models.size === 0) this.origin = null;
    this.updateGrid();
    this.requestRender();
  }

  setModelVisible(modelId: string, visible: boolean): void {
    const built = this.models.get(modelId);
    if (!built) return;
    built.group.visible = visible;
    this.requestRender();
  }

  fitAll(): void {
    const box = this.visibleBounds();
    if (!box.isEmpty()) this.fitBox(box);
  }

  fitModel(modelId: string): void {
    const built = this.models.get(modelId);
    if (!built) return;
    const box = new THREE.Box3();
    for (const mesh of built.meshes) box.union(mesh.geometry.boundingBox!);
    if (!box.isEmpty()) this.fitBox(box);
  }

  // ── Selección ────────────────────────────────

  setSelection(key: ElementKey | null): void {
    if (this.highlight) {
      this.highlight.parent?.remove(this.highlight);
      disposeOverlay(this.highlight);
      this.highlight = null;
    }
    const built = key ? this.models.get(key.modelId) : undefined;
    const ranges = key ? built?.elementRanges.get(key.expressId) : undefined;
    if (built && ranges) {
      // Mallas de resaltado que reutilizan los vértices de las mallas fusionadas con un índice parcial.
      this.highlight = new THREE.Group();
      for (const [mesh, meshRanges] of groupByMesh(ranges)) {
        this.highlight.add(new THREE.Mesh(subsetGeometry(mesh, meshRanges), this.highlightMaterial));
      }
      built.group.add(this.highlight);
    }
    this.requestRender();
  }

  fitElement(key: ElementKey): void {
    const ranges = this.models.get(key.modelId)?.elementRanges.get(key.expressId);
    if (!ranges) return;
    const box = new THREE.Box3();
    const p = new THREE.Vector3();
    for (const { mesh, start, count } of ranges) {
      const pos = mesh.geometry.getAttribute('position');
      const index = mesh.geometry.getIndex()!;
      for (let i = start; i < start + count; i++) box.expandByPoint(p.fromBufferAttribute(pos, index.getX(i)));
    }
    if (!box.isEmpty()) this.fitBox(box, 1.6);
  }

  // ── Resultados IDS ───────────────────────────

  /** Pinta en verde/rojo los elementos que cumplen/no cumplen y atenúa el resto. null = desactivar. */
  setStatusColoring(groups: Map<string, ElementStatusGroups> | null): void {
    this.statusOverlays.forEach(disposeOverlay);
    this.statusOverlays = [];
    this.statusColoring = groups !== null;
    for (const [modelId, status] of groups ?? []) {
      const built = this.models.get(modelId);
      if (!built) continue;
      const overlay = new THREE.Group();
      for (const [ids, material] of [
        [status.failed, this.failMaterial],
        [status.passed, this.passMaterial],
      ] as const) {
        const ranges = [...ids].flatMap((id) => built.elementRanges.get(id) ?? []);
        for (const [mesh, meshRanges] of groupByMesh(ranges)) {
          overlay.add(new THREE.Mesh(subsetGeometry(mesh, meshRanges), material));
        }
      }
      built.group.add(overlay);
      this.statusOverlays.push(overlay);
    }
    this.applyRenderMode();
    this.requestRender();
  }

  // ── Modos de visualización ───────────────────

  setRenderMode(mode: RenderMode): void {
    this.renderMode = mode;
    this.applyRenderMode();
    this.requestRender();
  }

  /** Activa/desactiva el corte horizontal; `level` es la altura normalizada [0, 1] sobre la escena. */
  setSection(enabled: boolean, level: number): void {
    this.sectionEnabled = enabled;
    this.renderer.clippingPlanes = enabled ? [this.sectionPlane] : [];
    const box = this.visibleBounds();
    if (!box.isEmpty()) this.sectionPlane.constant = THREE.MathUtils.lerp(box.min.y, box.max.y, level);
    this.requestRender();
  }

  requestRender(): void {
    this.needsRender = true;
  }

  // ── Internos ─────────────────────────────────

  private applyRenderMode(): void {
    for (const built of this.models.values()) {
      for (const mesh of built.meshes) {
        const mat = mesh.material as THREE.MeshLambertMaterial;
        const { baseOpacity, baseTransparent } = mat.userData as { baseOpacity: number; baseTransparent: boolean };
        mat.wireframe = this.renderMode === 'wireframe';
        const xray = this.renderMode === 'xray';
        const ghostOpacity = this.statusColoring ? GHOST_OPACITY : xray ? XRAY_OPACITY : 1;
        mat.transparent = ghostOpacity < 1 || baseTransparent;
        mat.opacity = Math.min(baseOpacity, ghostOpacity);
        mat.depthWrite = !mat.transparent;
        mat.needsUpdate = true;
      }
    }
  }

  private visibleBounds(): THREE.Box3 {
    const box = new THREE.Box3();
    for (const built of this.models.values()) {
      if (!built.group.visible) continue;
      for (const mesh of built.meshes) box.union(mesh.geometry.boundingBox!);
    }
    return box;
  }

  private fitBox(box: THREE.Box3, padding = 1.15): void {
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(sphere.radius, 0.5);
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const fitFov = this.camera.aspect < 1 ? 2 * Math.atan(Math.tan(fov / 2) * this.camera.aspect) : fov;
    const distance = (radius * padding) / Math.sin(fitFov / 2);

    const direction = this.camera.position.clone().sub(this.controls.target);
    if (direction.lengthSq() < 1e-6) direction.set(1, 0.8, 1);
    direction.normalize();

    this.controls.target.copy(sphere.center);
    this.camera.position.copy(sphere.center).addScaledVector(direction, distance);
    this.camera.near = Math.max(distance / 1000, 0.01);
    this.camera.far = distance + radius * 20;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.requestRender();
  }

  private updateGrid(): void {
    const box = this.visibleBounds();
    if (!box.isEmpty()) this.setGrid(box);
    if (this.sectionEnabled) this.setSection(true, this.currentSectionLevel());
  }

  private currentSectionLevel(): number {
    const box = this.visibleBounds();
    const height = box.max.y - box.min.y;
    return height > 0 ? THREE.MathUtils.clamp((this.sectionPlane.constant - box.min.y) / height, 0, 1) : 0.5;
  }

  private setGrid(box: THREE.Box3): void {
    if (this.grid) {
      this.scene.remove(this.grid);
      this.grid.geometry.dispose();
      (this.grid.material as THREE.Material).dispose();
    }
    const size = box.getSize(new THREE.Vector3());
    const extent = Math.max(size.x, size.z, 10) * 2;
    const step = 10 ** Math.floor(Math.log10(extent / 10));
    const divisions = Math.min(Math.round(extent / step), 400);
    this.grid = new THREE.GridHelper(divisions * step, divisions, 0x6b7785, 0x3a424d);
    const material = this.grid.material as THREE.Material;
    material.transparent = true;
    material.opacity = 0.35;
    material.depthWrite = false;
    const center = box.getCenter(new THREE.Vector3());
    this.grid.position.set(center.x, box.min.y - 0.01, center.z);
    this.scene.add(this.grid);
  }

  private bindPointer(): void {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => {
      this.pointerDown = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
    });
    el.addEventListener('pointerup', (e) => {
      const start = this.pointerDown;
      this.pointerDown = null;
      if (!start || Math.hypot(e.clientX - start.x, e.clientY - start.y) > CLICK_TOLERANCE) return;
      this.onPick(this.pick(e.clientX, e.clientY));
    });
  }

  private pick(clientX: number, clientY: number): ElementKey | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const targets = [...this.models.values()].filter((m) => m.group.visible).flatMap((m) => m.meshes);
    const hits = this.raycaster.intersectObjects(targets, false);
    // Ignora lo que queda por encima del plano de sección.
    const hit = hits.find((h) => !this.sectionEnabled || this.sectionPlane.distanceToPoint(h.point) >= 0);
    if (!hit || hit.faceIndex == null) return null;
    const { modelId, faceLookup } = hit.object.userData as { modelId: string; faceLookup: FaceLookup };
    return { modelId, expressId: expressIdAtFace(faceLookup, hit.faceIndex) };
  }

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  private loop = (): void => {
    requestAnimationFrame(this.loop);
    // Con damping, los controles siguen emitiendo 'change' mientras la cámara se asienta.
    this.controls.update();
    if (!this.needsRender) return;
    this.needsRender = false;
    this.renderer.render(this.scene, this.camera);
    const { triangles, calls } = this.renderer.info.render;
    this.onFrame({ triangles, drawCalls: calls });
  };
}

function statusMaterial(color: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({
    color,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -0.5,
    polygonOffsetUnits: -0.5,
  });
}

function groupByMesh(ranges: ElementRange[]): Map<THREE.Mesh, ElementRange[]> {
  const byMesh = new Map<THREE.Mesh, ElementRange[]>();
  for (const range of ranges) {
    let list = byMesh.get(range.mesh);
    if (!list) byMesh.set(range.mesh, (list = []));
    list.push(range);
  }
  return byMesh;
}

/** Geometría con un subconjunto de triángulos de una malla fusionada, compartiendo sus vértices. */
function subsetGeometry(mesh: THREE.Mesh, ranges: ElementRange[]): THREE.BufferGeometry {
  const source = mesh.geometry;
  const sourceIndex = source.getIndex()!.array;
  const index = new Uint32Array(ranges.reduce((n, r) => n + r.count, 0));
  let offset = 0;
  for (const r of ranges) {
    index.set(sourceIndex.subarray(r.start, r.start + r.count), offset);
    offset += r.count;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', source.getAttribute('position'));
  geometry.setAttribute('normal', source.getAttribute('normal'));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  return geometry;
}

/** Libera solo los índices propios: los atributos de vértices pertenecen a las mallas fusionadas. */
function disposeOverlay(group: THREE.Group): void {
  group.parent?.remove(group);
  for (const child of group.children) {
    const geometry = (child as THREE.Mesh).geometry;
    // dispose() liberaría en la GPU también los buffers compartidos; se desligan antes.
    geometry.deleteAttribute('position');
    geometry.deleteAttribute('normal');
    geometry.dispose();
  }
}
