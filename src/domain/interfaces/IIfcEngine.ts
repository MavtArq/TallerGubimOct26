import type { IdsModelView } from '../ids/IdsModelView';
import type { ElementProperties, GeometryChunk, ModelMetadata, SpatialNode } from '../models/LoadedModel';

/** Identificador opaco de un modelo abierto dentro del motor IFC. */
export type EngineHandle = number;

/**
 * Puerto del motor IFC. La implementación actual usa web-ifc; el objetivo de la spec
 * es poder sustituirla por IFCLite sin tocar dominio ni presentación.
 */
export interface IIfcEngine {
  init(): Promise<void>;
  open(data: Uint8Array): EngineHandle;
  close(handle: EngineHandle): void;
  getMetadata(handle: EngineHandle): ModelMetadata;
  /** Recorre toda la geometría del modelo. Los buffers entregados son copias propias. */
  streamGeometry(handle: EngineHandle, onChunk: (chunk: GeometryChunk) => void): void;
  getSpatialTree(handle: EngineHandle): Promise<SpatialNode | null>;
  getProperties(handle: EngineHandle, expressId: number): Promise<ElementProperties>;
  /** Vista indexada para validación IDS. */
  createIdsView(handle: EngineHandle): IdsModelView;
}
