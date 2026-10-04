import type { AudioEngine } from "../audio/AudioEngine";
import { BuilderHome } from "./BuilderHome";
import { Editor } from "./Editor";

/** `#/builder` → Builder Home; `#/builder/:draftId` → Editor (§6.2). */
export function BuilderApp(props: { draftId: string | null; audio: AudioEngine }) {
  return props.draftId ? (
    <Editor key={props.draftId} draftId={props.draftId} audio={props.audio} />
  ) : (
    <BuilderHome />
  );
}
