import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

export async function GET() {
  const manifestPath = path.join(process.cwd(), "data", "audio-segments.json");

  try {
    const raw = await fs.readFile(manifestPath, "utf8");
    return new Response(raw, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      }
    });
  } catch {
    return Response.json([], { status: 200 });
  }
}
