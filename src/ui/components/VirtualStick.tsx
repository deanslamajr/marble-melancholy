import { useEffect, useState } from "preact/hooks";
import { TOUCH_RADIUS_PX, type TouchStickState } from "../../input/touch";
import { useController } from "../context";

/** DOM overlay for the floating touch stick (§7.6). Coordinates are CSS px within the stage. */
export function VirtualStick() {
  const c = useController();
  const [s, setS] = useState<TouchStickState | null>(null);
  useEffect(() => c.input.touch.subscribe((st) => setS({ ...st })), [c]);
  if (!s?.active) return null;
  const r = TOUCH_RADIUS_PX;
  return (
    <div
      class="vstick"
      style={{
        left: `${s.originX - r}px`,
        top: `${s.originY - r}px`,
        width: `${2 * r}px`,
        height: `${2 * r}px`,
      }}
    >
      <div class="vstick-knob" style={{ transform: `translate(${s.knobX}px, ${s.knobY}px)` }} />
    </div>
  );
}
