import type { ComponentChildren } from "preact";

export function PixelText(props: {
  children: ComponentChildren;
  size?: "s" | "m" | "l" | "xl";
  tone?: "normal" | "dim" | "warn" | "p1" | "p2" | "accent";
  as?: "div" | "span" | "h1" | "h2";
  class?: string;
}) {
  const Tag = props.as ?? "div";
  const cls = `px px-${props.size ?? "m"} tone-${props.tone ?? "normal"} ${props.class ?? ""}`;
  return <Tag class={cls}>{props.children}</Tag>;
}
