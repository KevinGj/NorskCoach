import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "data", "audio-segments.json");
const reviewPath = path.join(root, "data", "segment-review.html");

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const segments = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const rows = segments
  .map((segment) => {
    const relativeAudio = `../public${segment.audio}`;
    return `
      <article>
        <header>
          <strong>${escapeHtml(segment.id)}</strong>
          <span>${escapeHtml(segment.source)} · ${segment.start}s-${segment.end}s · ${segment.duration}s</span>
        </header>
        <audio controls preload="metadata" src="${escapeHtml(relativeAudio)}"></audio>
        <p>${escapeHtml(segment.text || "(no transcript)")}</p>
      </article>
    `;
  })
  .join("\n");

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Norsk Audio Segment Review</title>
  <style>
    body { background: #06100c; color: #f5fff8; font-family: Arial, sans-serif; margin: 0; padding: 28px; }
    main { max-width: 980px; margin: 0 auto; }
    h1 { font-family: Georgia, serif; font-weight: 500; }
    article { border: 1px solid #1c332a; border-radius: 12px; margin: 16px 0; padding: 18px; background: #0d1914; }
    header { display: flex; gap: 12px; justify-content: space-between; margin-bottom: 12px; }
    span { color: #8fa99a; }
    audio { width: 100%; }
    p { line-height: 1.6; color: #c6f7dc; }
  </style>
</head>
<body>
  <main>
    <h1>Norsk Audio Segment Review</h1>
    <p>Listen for: no title/chapter announcement, whole-sentence boundaries, useful 10-20 second training length.</p>
    ${rows}
  </main>
</body>
</html>`;

await fs.writeFile(reviewPath, html, "utf8");
console.log(reviewPath);
