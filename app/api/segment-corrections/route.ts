import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

type SegmentCorrection = {
  text?: string;
  tokenMerges?: { match: string[]; text: string }[];
};

type CorrectionRequest = {
  action: "save" | "reset";
  id: string;
  text?: string;
};

const correctionsPath = path.join(process.cwd(), "data", "segment-corrections.json");

async function readCorrections() {
  try {
    return JSON.parse(await fs.readFile(correctionsPath, "utf8")) as Record<string, SegmentCorrection>;
  } catch {
    return {};
  }
}

async function writeCorrections(corrections: Record<string, SegmentCorrection>) {
  await fs.mkdir(path.dirname(correctionsPath), { recursive: true });
  await fs.writeFile(correctionsPath, `${JSON.stringify(corrections, null, 2)}\n`, "utf8");
}

export async function POST(request: Request) {
  const payload = (await request.json()) as CorrectionRequest;
  if (!payload.id || !["save", "reset"].includes(payload.action)) {
    return Response.json({ error: "Invalid correction request." }, { status: 400 });
  }

  const corrections = await readCorrections();

  if (payload.action === "reset") {
    delete corrections[payload.id];
    await writeCorrections(corrections);
    return Response.json({ ok: true });
  }

  const text = payload.text?.trim();
  if (!text) return Response.json({ error: "Transcript text cannot be empty." }, { status: 400 });

  corrections[payload.id] = {
    ...(corrections[payload.id] ?? {}),
    text
  };
  await writeCorrections(corrections);
  return Response.json({ ok: true });
}
