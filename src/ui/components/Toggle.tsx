export function Toggle<T extends string | boolean>(props: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div class="field">
      <span class="field-label">{props.label}</span>
      <div class="toggle" role="radiogroup" aria-label={props.label}>
        {props.options.map((o) => (
          <button
            type="button"
            key={String(o.value)}
            role="radio"
            aria-checked={o.value === props.value}
            class={o.value === props.value ? "on" : ""}
            onClick={() => props.onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
