/** Minimal typed event bus (D11). */
export type Listener<E> = (event: E) => void;

export class EventBus<E> {
  private listeners = new Set<Listener<E>>();

  on(listener: Listener<E>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: E): void {
    for (const l of this.listeners) l(event);
  }

  emitAll(events: readonly E[]): void {
    for (const e of events) this.emit(e);
  }

  clear(): void {
    this.listeners.clear();
  }
}
