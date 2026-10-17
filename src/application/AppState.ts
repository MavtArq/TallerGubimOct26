import type { IdsDocument } from '../domain/ids/IdsDocument';
import type { IdsReport } from '../domain/ids/IdsReport';
import type { ElementKey } from '../domain/models/ElementKey';
import type { ModelInfo } from '../domain/models/LoadedModel';

export type RenderMode = 'shaded' | 'wireframe' | 'xray';
export type PanelId = 'models' | 'tree' | 'props' | 'ids';

export interface IdsState {
  filename: string | null;
  document: IdsDocument | null;
  report: IdsReport | null;
  error: string | null;
  /** Colorea en el 3D los elementos que cumplen (verde) y los que no (rojo). */
  colorize: boolean;
  /** Especificación desplegada en el panel; filtra el coloreado. null = todas. */
  activeSpec: number | null;
}

export interface AppState {
  models: ModelInfo[];
  selection: ElementKey | null;
  renderMode: RenderMode;
  section: {
    enabled: boolean;
    /** Altura de corte normalizada [0, 1] sobre la caja de la escena. */
    level: number;
  };
  ids: IdsState;
  activePanel: PanelId;
  /** Texto de la operación en curso; null si no hay ninguna. */
  busy: string | null;
  status: string;
}

export const initialState: AppState = {
  models: [],
  selection: null,
  renderMode: 'shaded',
  section: { enabled: false, level: 0.5 },
  ids: { filename: null, document: null, report: null, error: null, colorize: true, activeSpec: null },
  activePanel: 'models',
  busy: null,
  status: 'Listo',
};
