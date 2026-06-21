import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

type AudioSegment = {
  id: string;
  [key: string]: unknown;
};

type SegmentCorrection = Partial<AudioSegment>;

export async function GET() {
  const manifestPath = path.join(process.cwd(), "data", "audio-segments.json");
  const correctionsPath = path.join(process.cwd(), "data", "segment-corrections.json");

  try {
    const raw = await fs.readFile(manifestPath, "utf8");
    const segments = JSON.parse(raw) as AudioSegment[];
    let corrections: Record<string, SegmentCorrection> = {};

    try {
      corrections = JSON.parse(await fs.readFile(correctionsPath, "utf8")) as Record<string, SegmentCorrection>;
    } catch {
      corrections = {};
    }

    const correctedSegments = segments.map((segment) => ({ ...segment, ...(corrections[segment.id] ?? {}) }));

    return new Response(JSON.stringify(correctedSegments), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      }
    });
  } catch {
    return Response.json([], { status: 200 });
  }
}
