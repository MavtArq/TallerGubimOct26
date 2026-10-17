import type { GeometryChunk } from '../models/LoadedModel';

export interface RenderedModelStats {
  elementCount: number;
  triangleCount: number;
}

/** Puerto del renderer 3D, desde el punto de vista del dominio. */
export interface IModelRenderer {
  addModel(modelId: string, chunks: GeometryChunk[]): RenderedModelStats;
  removeModel(modelId: string): void;
  setModelVisible(modelId: string, visible: boolean): void;
  fitAll(): void;
}
