import type { ToolId } from "../EditorState";
import { checkpointTool } from "./checkpoint";
import { entityTool } from "./entity";
import { goalTool } from "./goal";
import { heightTool } from "./height";
import { selectTool } from "./select";
import { setHeightTool } from "./setHeight";
import { slopeTool } from "./slope";
import { p1Tool, p2Tool } from "./start";
import { surfaceTool } from "./surface";
import type { Tool } from "./types";
import { voidTool } from "./void";
import { wallTool } from "./wall";
import { waypointTool } from "./waypoint";

export const TOOLS: readonly Tool[] = [
  selectTool,
  heightTool,
  setHeightTool,
  slopeTool,
  surfaceTool,
  wallTool,
  voidTool,
  entityTool,
  p1Tool,
  p2Tool,
  goalTool,
  checkpointTool,
  waypointTool,
];

export const TOOL_BY_ID = Object.fromEntries(TOOLS.map((t) => [t.id, t])) as Record<ToolId, Tool>;

export type { Tool, ToolEvent } from "./types";
