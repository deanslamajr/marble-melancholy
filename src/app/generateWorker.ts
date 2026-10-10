// Web Worker entry: runs the generator pipeline off the main thread (G16).
import { generateLevel } from "../level/generate/pipeline";
import type { GenerateMessage, GenerateRequest } from "./generateClient";

/** Progress messages go to the page at most this often, in ms. */
const PROGRESS_MS = 50;

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<GenerateRequest>) => void) | null;
  postMessage(message: GenerateMessage): void;
};

scope.onmessage = async (e) => {
  const { seed, difficulty } = e.data;
  let last = -PROGRESS_MS;
  try {
    const result = await generateLevel({
      seed,
      difficulty,
      onProgress: (progress) => {
        const now = performance.now();
        if (now - last < PROGRESS_MS) return;
        last = now;
        scope.postMessage({ type: "progress", progress });
      },
    });
    scope.postMessage({ type: "done", result });
  } catch (err) {
    scope.postMessage({ type: "error", message: (err as Error).message });
  }
};
