// Main-thread side of the generator worker (G16). The pipeline itself only loads inside the worker.
import type { Difficulty } from "../level/generate/generate";
import type { GenerateLevelResult, GenerateProgress } from "../level/generate/pipeline";

export interface GenerateRequest {
  seed: number;
  difficulty: Difficulty;
}

export type GenerateMessage =
  | { type: "progress"; progress: GenerateProgress }
  | { type: "done"; result: GenerateLevelResult }
  | { type: "error"; message: string };

export const GENERATION_CANCELLED = "generation cancelled";

export interface GenerateJob {
  result: Promise<GenerateLevelResult>;
  /** Stops the worker at once; `result` then rejects with GENERATION_CANCELLED. */
  cancel(): void;
}

/**
 * Runs the generator pipeline in its own module worker, so the search never blocks painting or
 * input on the page. One worker per job; it is terminated when the job settles or is cancelled.
 */
export function generateInWorker(
  req: GenerateRequest,
  onProgress?: (p: GenerateProgress) => void,
): GenerateJob {
  const worker = new Worker(new URL("./generateWorker.ts", import.meta.url), { type: "module" });
  let cancel = () => {};
  const result = new Promise<GenerateLevelResult>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<GenerateMessage>) => {
      const m = e.data;
      if (m.type === "progress") {
        onProgress?.(m.progress);
        return;
      }
      worker.terminate();
      if (m.type === "done") resolve(m.result);
      else reject(new Error(m.message));
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || "the generator worker failed to start"));
    };
    cancel = () => {
      worker.terminate();
      reject(new Error(GENERATION_CANCELLED));
    };
  });
  worker.postMessage(req);
  return { result, cancel: () => cancel() };
}
