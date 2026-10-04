import { useEffect, useRef, useState } from "preact/hooks";
import { useController } from "../context";

export interface MenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  hint?: string;
}

/** Vertical menu driven by keyboard (arrows/Enter/Esc), gamepad (via synthetic keys), mouse and touch. */
export function MenuList(props: { items: MenuItem[]; onBack?: () => void; testId?: string }) {
  const c = useController();
  const [focus, setFocus] = useState(() =>
    Math.max(
      0,
      props.items.findIndex((i) => !i.disabled),
    ),
  );
  const itemsRef = useRef(props.items);
  itemsRef.current = props.items;
  const backRef = useRef(props.onBack);
  backRef.current = props.onBack;

  useEffect(() => {
    const move = (d: number) => {
      setFocus((f) => {
        const items = itemsRef.current;
        let n = f;
        for (let k = 0; k < items.length; k++) {
          n = (n + d + items.length) % items.length;
          if (!items[n]?.disabled) break;
        }
        if (n !== f) c.audio.playUi("menuMove");
        return n;
      });
    };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA"))
        return;
      if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") {
        e.preventDefault();
        move(-1);
      } else if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") {
        e.preventDefault();
        move(1);
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setFocus((f) => {
          const item = itemsRef.current[f];
          if (item && !item.disabled) {
            c.audio.playUi("menuSelect");
            queueMicrotask(item.onSelect);
          }
          return f;
        });
      } else if (e.key === "Escape" || e.key === "Backspace") {
        if (backRef.current) {
          e.preventDefault();
          c.audio.playUi("menuBack");
          backRef.current();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [c]);

  return (
    <ul class="menu" role="menu" data-testid={props.testId}>
      {props.items.map((item, i) => (
        <li key={item.label} role="none">
          <button
            type="button"
            role="menuitem"
            class={`menu-item ${i === focus ? "focused" : ""}`}
            disabled={item.disabled}
            onMouseEnter={() => setFocus(i)}
            onClick={() => {
              c.audio.playUi("menuSelect");
              item.onSelect();
            }}
          >
            <span class="menu-caret">{i === focus ? "▶" : ""}</span>
            {item.label}
            {item.hint && <span class="menu-hint">{item.hint}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}
