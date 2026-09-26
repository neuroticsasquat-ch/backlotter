// Renders every raster icon in `public/` from `public/favicon.svg`, the single source of
// the logo. Run by hand inside the container whenever the logo changes:
//
//     task shell
//     pnpm icons
//
// The outputs are committed. There is deliberately no build-time generation: these assets
// change rarely, and putting a native image binary in the Cloudflare Workers Builds deploy
// path is a risk for no benefit (D-1404.1).
//
// Plain ESM JavaScript rather than TypeScript because the repo has no TS runner outside Vite.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

const PUBLIC_DIR = new URL("../public/", import.meta.url);
const SOURCE = new URL("favicon.svg", PUBLIC_DIR);

/** Replace `needle` exactly once, failing loudly if the logo no longer contains it. */
function replaceOnce(svg, needle, replacement) {
  const parts = svg.split(needle);
  if (parts.length !== 2) {
    throw new Error(
      `expected exactly one occurrence of ${JSON.stringify(needle)} in favicon.svg, found ${parts.length - 1}`,
    );
  }
  return parts.join(replacement);
}

async function renderPng(svg, size, name) {
  const png = await sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
  await writeFile(new URL(name, PUBLIC_DIR), png);
  console.log(`wrote ${name} (${size}x${size})`);
}

const favicon = await readFile(SOURCE, "utf8");

// Full-bleed variant: the platform supplies the corner radius, so drop ours. Nothing else
// moves — the glyph already sits well inside the maskable safe zone (the central circle of
// 80% diameter), and shrinking it further would only make the icon look small.
const fullBleed = replaceOnce(favicon, ' rx="14"', "");

await mkdir(new URL("icons/", PUBLIC_DIR), { recursive: true });

await renderPng(favicon, 192, "icons/icon-192.png");
await renderPng(favicon, 512, "icons/icon-512.png");
await renderPng(fullBleed, 512, "icons/icon-512-maskable.png");
// iOS applies its own mask to the touch icon, so it takes the full-bleed tile too. Stays
// at its historic path and size.
await renderPng(fullBleed, 180, "apple-touch-icon.png");
