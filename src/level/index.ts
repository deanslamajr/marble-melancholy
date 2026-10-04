// Public level-builder API (§6.4). Used by the CLI, the GUI builder and the loader.
export {
  parseSource,
  sourceFromObject,
  decodeLayers,
  encodeLayers,
  type ParseResult,
  type LayerLines,
} from "./parse";
export { serializeSource } from "./serialize";
export { validateSource, analyzeSource, type ValidationReport } from "./validate";
export { solveSolution, type SolveResult } from "./solution/solve";
export {
  compileLevel,
  verifyCompiled,
  decompileToSource,
  buildUnstamped,
  type CompileResult,
  type VerifyReport,
} from "./compile";
export { computeStamp, verifyStamp } from "./stamp";
export { BUILDER_NAME, BUILDER_VERSION, SUPPORTED_VERSIONS } from "./version";
export { diag, formatDiagnostic, diagnosticJson, CODES, type Diagnostic } from "./diagnostics";
export { ENTITY_SPECS, CHECKPOINT_PARAMS, defaultEntity } from "./entities/specs";
export { encodeRuns, decodeRuns, runsLength } from "./solution/replay";
export type * from "./types";
