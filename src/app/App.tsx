import { BuilderApp } from "../builder/BuilderApp";
import type { GameController } from "../game/GameController";
import { GameShell } from "../ui/GameShell";
import { route } from "./router";

export function App(props: { controller: GameController }) {
  const r = route.value;
  if (r.name === "builder" || r.name === "builderDraft") {
    return (
      <BuilderApp
        draftId={r.name === "builderDraft" ? r.draftId : null}
        audio={props.controller.audio}
      />
    );
  }
  return <GameShell controller={props.controller} />;
}
