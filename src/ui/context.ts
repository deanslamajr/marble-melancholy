import { createContext } from "preact";
import { useContext } from "preact/hooks";
import type { GameController } from "../game/GameController";

export const ControllerContext = createContext<GameController | null>(null);

export function useController(): GameController {
  const c = useContext(ControllerContext);
  if (!c) throw new Error("GameController missing from context");
  return c;
}
