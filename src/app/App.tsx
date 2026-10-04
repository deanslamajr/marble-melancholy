import { useEffect, useState } from "preact/hooks";
import type { BuilderApp as BuilderAppType } from "../builder/BuilderApp";
import type { GameController } from "../game/GameController";
import { GameShell } from "../ui/GameShell";
import { route } from "./router";

type BuilderComponent = typeof BuilderAppType;

/** The builder is code-split: players who never open it never download it. */
function LazyBuilder(props: Parameters<BuilderComponent>[0]) {
  const [Comp, setComp] = useState<BuilderComponent | null>(null);
  useEffect(() => {
    let alive = true;
    void import("../builder/BuilderApp").then((m) => {
      if (alive) setComp(() => m.BuilderApp);
    });
    return () => {
      alive = false;
    };
  }, []);
  return Comp ? <Comp {...props} /> : <div class="builder loading">Loading builder…</div>;
}

export function App(props: { controller: GameController }) {
  const r = route.value;
  if (r.name === "builder" || r.name === "builderDraft") {
    return (
      <LazyBuilder
        draftId={r.name === "builderDraft" ? r.draftId : null}
        audio={props.controller.audio}
      />
    );
  }
  return <GameShell controller={props.controller} />;
}
