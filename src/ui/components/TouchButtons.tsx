import { useController } from "../context";

/** Visible pause target in the right-hand tap zone for touch players. */
export function TouchButtons() {
  const c = useController();
  return (
    <div class="touch-buttons">
      <button type="button" class="touch-pause" aria-label="Pause" onClick={() => c.pause()}>
        ❚❚
      </button>
    </div>
  );
}
