import type { ComponentChildren } from "preact";

export function Modal(props: {
  title?: string;
  children: ComponentChildren;
  wide?: boolean;
  testId?: string;
}) {
  return (
    <div class="overlay modal-backdrop" data-testid={props.testId}>
      <div class={`modal ${props.wide ? "wide" : ""}`} role="dialog" aria-label={props.title}>
        {props.title && <h2 class="px px-l modal-title">{props.title}</h2>}
        {props.children}
      </div>
    </div>
  );
}
