import { useController } from "../context";

/** The only touch control that pauses (I14). */
export function TouchButtons() {
  const c = useController();
  return (
    <div class="touch-buttons">
      <button
        type="button"
        class="touch-pause"
        aria-label="Pause"
        onClick={() => c.pause("button")}
      >
        ❚❚
      </button>
    </div>
  );
}
