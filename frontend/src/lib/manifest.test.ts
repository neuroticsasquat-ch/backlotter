import { readFileSync } from "node:fs";
import { join } from "node:path";
// Aliased on purpose: Vite rewrites the literal `new URL(..., import.meta.url)` pattern
// into an asset reference, which resolves to an http: URL that `fileURLToPath` rejects.
// Under a different name the transform does not match and the file URL survives.
import { fileURLToPath, URL as NodeURL } from "node:url";
import { describe, expect, it } from "vitest";

// The manifest is a static asset, not a module: it cannot import SITE_NAME or the theme
// token, so this test is the thing that keeps it honest against the rest of the app.
const PUBLIC_DIR = fileURLToPath(new NodeURL("../../public/", import.meta.url));

/**
 * Read a PNG's declared dimensions straight out of its IHDR chunk, which sits at a fixed
 * offset in every valid file. Deliberately not `sharp` — the tests must not depend on the
 * native image binary that only `scripts/icons.mjs` needs.
 */
function pngSize(relativePath: string): { width: number; height: number } {
  const header = readFileSync(join(PUBLIC_DIR, relativePath)).subarray(0, 24);
  expect(header.subarray(12, 16).toString("ascii")).toBe("IHDR");
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

const manifest = JSON.parse(readFileSync(join(PUBLIC_DIR, "manifest.webmanifest"), "utf8")) as {
  id: string;
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  theme_color: string;
  background_color: string;
  icons: ManifestIcon[];
};

describe("web app manifest", () => {
  it("declares the members iOS needs for a standalone install", () => {
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    // Pinned so a later start_url change does not re-identify the app and orphan installs.
    expect(manifest.id).toBe("/");
  });

  it("uses the app background token for both colours", () => {
    expect(manifest.theme_color).toBe("#0f172a");
    expect(manifest.background_color).toBe("#0f172a");
  });

  it("ships exactly one maskable icon", () => {
    // Never "any maskable" on one file: the safe-zone padding that makes an icon maskable
    // makes it look undersized as a plain icon.
    const maskable = manifest.icons.filter((icon) => icon.purpose === "maskable");
    expect(maskable).toHaveLength(1);
    expect(maskable[0].sizes).toBe("512x512");
  });

  it("points every icon entry at a PNG of its declared size", () => {
    expect(manifest.icons.length).toBeGreaterThan(0);
    for (const icon of manifest.icons) {
      expect(icon.type).toBe("image/png");
      const [width, height] = icon.sizes.split("x").map(Number);
      expect({ src: icon.src, ...pngSize(icon.src) }).toEqual({ src: icon.src, width, height });
    }
  });
});
