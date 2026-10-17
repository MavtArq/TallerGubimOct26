export type Listener<T> = (state: T, prev: T) => void;
export type Unsubscribe = () => void;

/** Store observable mínimo: estado inmutable + suscripción por selector. */
export class Store<T extends object> {
  private listeners = new Set<Listener<T>>();

  constructor(private state: T) {}

  getState(): T {
    return this.state;
  }

  setState(patch: Partial<T> | ((state: T) => Partial<T>)): void {
    const prev = this.state;
    const next = typeof patch === 'function' ? patch(prev) : patch;
    this.state = { ...prev, ...next };
    for (const listener of this.listeners) listener(this.state, prev);
  }

  subscribe(listener: Listener<T>): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Notifica solo cuando cambia el valor seleccionado (comparación por referencia). */
  select<K>(selector: (state: T) => K, callback: (value: K, prev: K) => void, immediate = true): Unsubscribe {
    if (immediate) callback(selector(this.state), selector(this.state));
    return this.subscribe((state, prev) => {
      const value = selector(state);
      const prevValue = selector(prev);
      if (value !== prevValue) callback(value, prevValue);
    });
  }
}
