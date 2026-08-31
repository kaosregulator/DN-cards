/**
 * Rebuild pokeball-go / capture / almost overlays from MakeEmoji prerendered
 * GIFs: keep ball paint, punch a single circular subject hole in the center.
 */
import sharp from "sharp";
import { mkdirSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";

const OUT = "/workspace/artifacts/emoji-offline";
const STYLES = ["pokeball-go", "pokeball-capture", "pokeball-almost"] as const;

function isBallPaint(r: number, g: number, b: number, a: number): boolean {
  if (a < 40) return false;
  if (r > 140 && g < 100 && b < 100) return true; // red
  if (r > 190 && g > 190 && b > 190) return true; // white
  if (r < 50 && g < 50 && b < 50) return true; // black
  if (Math.abs(r - g) < 25 && Math.abs(g - b) < 25 && r >= 60 && r <= 200) return true; // grey shade
  return false;
}

async function rebuild(style: string) {
  const gifPath = `/tmp/me-audit/${style}.gif`;
  const meta = await sharp(gifPath, { animated: true }).metadata();
  const pages = meta.pages ?? 1;
  const dir = join(OUT, "assets", "frames", style);
  mkdirSync(dir, { recursive: true });

  for (let p = 0; p < pages; p++) {
    const { data, info } = await sharp(gifPath, { page: p })
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true });

    // Upscale to 128 with nearest for crisp ball edges
    const up = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
      .resize(128, 128, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: "nearest" })
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true });

    const out = Buffer.from(up.data);
    const cw = up.info.width, ch = up.info.height;

    // 1) Keep only ball paint; everything else transparent
    for (let i = 0; i < out.length; i += 4) {
      const r = out[i]!, g = out[i + 1]!, b = out[i + 2]!, a = out[i + 3]!;
      if (!isBallPaint(r, g, b, a)) {
        out[i] = 0; out[i + 1] = 0; out[i + 2] = 0; out[i + 3] = 0;
      }
    }

    // 2) Punch ONE large circular subject window in the ball body, keeping the
    //    black equatorial band and center button as foreground chrome.
    const cx = cw / 2, cy = ch / 2;
    const holeR = Math.min(cw, ch) * 0.42;
    const buttonR = Math.min(cw, ch) * 0.1;
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const i = (y * cw + x) * 4;
        if (out[i + 3]! < 40) continue;
        const dx = x - cx, dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        // Keep center button + its ring
        if (dist < buttonR * 1.8) continue;
        // Keep the black equatorial band
        const r = out[i]!, g = out[i + 1]!, b = out[i + 2]!;
        const isBlackBand = r < 55 && g < 55 && b < 55 && Math.abs(dy) < ch * 0.1;
        if (isBlackBand) continue;
        if (dist < holeR) {
          out[i + 3] = 0;
        }
      }
    }

    const name = `frame_${String(p + 1).padStart(4, "0")}.png`;
    const png = await sharp(out, { raw: { width: cw, height: ch, channels: 4 } }).png().toBuffer();
    writeFileSync(join(dir, name), png);
  }
  console.log(style, pages, "frames rebuilt");
}

async function main() {
  for (const s of STYLES) await rebuild(s);

  const recipesPath = join(OUT, "recipes", "recipes.json");
  const recipes = JSON.parse(readFileSync(recipesPath, "utf8")) as Array<Record<string, unknown>>;
  for (const style of STYLES) {
    const r = recipes.find(x => x.id === style || x.slug === style);
    if (!r) continue;
    r.family = "frames";
    r.primitive = "frames";
    r.assets = { framesHint: style };
    r.offlineReady = true;
    r.fidelity = "extracted-from-prerender";
    r.notes = [
      "Ball overlay extracted from MakeEmoji prerendered GIF; single circular subject hole",
    ];
  }
  writeFileSync(recipesPath, JSON.stringify(recipes, null, 2) + "\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
