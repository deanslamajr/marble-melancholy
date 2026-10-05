import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fullscreenSupported } from "../../../src/ui/fullscreen";
import { ICONS, renderIcon } from "../../../tools/icons/generate";

/** RGBA pixels of an unfiltered 8-bit RGBA PNG (what the generator writes). */
function decodePixels(png: Buffer, size: number): Buffer {
  const idat: Buffer[] = [];
  for (let o = 8; o < png.length;) {
    const len = png.readUInt32BE(o);
    if (png.toString("ascii", o + 4, o + 8) === "IDAT") idat.push(png.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const rows: Buffer[] = [];
  for (let y = 0; y < size; y++)
    rows.push(raw.subarray(y * (size * 4 + 1) + 1, (y + 1) * (size * 4 + 1)));
  return Buffer.concat(rows);
}

function fakeDocument(opts: { enabled?: boolean; webkit?: boolean; element?: object | null }) {
  const documentElement: Record<string, unknown> = {};
  if (opts.enabled !== undefined) documentElement.requestFullscreen = () => Promise.resolve();
  if (opts.webkit) documentElement.webkitRequestFullscreen = () => undefined;
  return {
    documentElement,
    fullscreenEnabled: opts.enabled,
    webkitFullscreenEnabled: opts.webkit,
    fullscreenElement: opts.element ?? null,
  };
}

function displayMode(mode: string) {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes(`display-mode: ${mode}`) }));
}

describe("fullscreen toggle", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is offered where the Fullscreen API works on elements", () => {
    displayMode("browser");
    vi.stubGlobal("document", fakeDocument({ enabled: true }));
    expect(fullscreenSupported()).toBe(true);
    vi.stubGlobal("document", fakeDocument({ webkit: true }));
    expect(fullscreenSupported()).toBe(true);
  });

  it("is hidden on iPhone Safari, which has no element fullscreen", () => {
    displayMode("browser");
    vi.stubGlobal("document", fakeDocument({}));
    expect(fullscreenSupported()).toBe(false);
    vi.stubGlobal("document", fakeDocument({ enabled: false }));
    expect(fullscreenSupported()).toBe(false);
  });

  it("is hidden when launched from the home screen in fullscreen display mode", () => {
    displayMode("fullscreen");
    vi.stubGlobal("document", fakeDocument({ enabled: true }));
    expect(fullscreenSupported()).toBe(false);
    // The API's own fullscreen also reports display-mode: fullscreen; keep the exit toggle then.
    vi.stubGlobal("document", fakeDocument({ enabled: true, element: {} }));
    expect(fullscreenSupported()).toBe(true);
  });
});

describe("web app manifest and icons", () => {
  const manifest = JSON.parse(readFileSync("public/manifest.webmanifest", "utf8")) as {
    display: string;
    orientation: string;
    start_url: string;
    icons: { src: string; sizes: string; purpose: string }[];
  };

  it("asks for a fullscreen landscape app with relative URLs", () => {
    expect(manifest.display).toBe("fullscreen");
    expect(manifest.orientation).toBe("landscape");
    expect(manifest.start_url).toBe("./");
    expect(manifest.icons.map((i) => i.purpose)).toContain("maskable");
    for (const i of manifest.icons) expect(i.src.startsWith("/")).toBe(false);
  });

  it("ships every icon as a PNG of the declared size, matching the generator", () => {
    const declared = new Set(manifest.icons.map((i) => i.src));
    for (const { file, size } of ICONS) {
      const png = readFileSync(`public/icons/${file}`);
      expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([size, size]);
      if (file !== "apple-touch-icon.png") expect(declared.has(`icons/${file}`)).toBe(true);
    }
    // Small enough to regenerate here; catches hand-edited or stale icons. Pixels, not bytes,
    // are compared because zlib output may differ between Node versions.
    const png = readFileSync("public/icons/apple-touch-icon.png");
    expect(decodePixels(png, 180).equals(Buffer.from(renderIcon(180)))).toBe(true);
  });

  it("is linked from index.html, with the iOS home-screen tags", () => {
    const html = readFileSync("index.html", "utf8");
    for (const tag of [
      'rel="manifest" href="/manifest.webmanifest"',
      'rel="apple-touch-icon" href="/icons/apple-touch-icon.png"',
      'name="apple-mobile-web-app-capable" content="yes"',
      'name="apple-mobile-web-app-status-bar-style"',
    ]) {
      expect(html).toContain(tag);
    }
  });
});
