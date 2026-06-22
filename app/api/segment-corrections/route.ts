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
const manifestPath = path.join(process.cwd(), "data", "audio-segments.json");

function wordCount(text = "") {
  return text.split(/\s+/).filter(Boolean).length;
}

async function readCorrections() {
  try {
    return JSON.parse(await fs.readFile(correctionsPath, "utf8")) as Record<string, SegmentCorrection>;
  } catch {
    return {};
  }
}

async function readOriginalText(id: string) {
  try {
    const segments = JSON.parse(await fs.readFile(manifestPath, "utf8")) as { id: string; text?: string }[];
    return segments.find((segment) => segment.id === id)?.text ?? "";
  } catch {
    return "";
  }
}

async function writeCorrections(corrections: Record<string, SegmentCorrection>) {
  await fs.mkdir(path.dirname(correctionsPath), { recursive: true });
  await fs.writeFile(correctionsPath, `${JSON.stringify(corrections, null, 2)}\n`, "utf8");
}

export async function POST(request: Request) {
  const payload = (await request.json()) as CorrectionRequest;
  if (!payload.id || !["save", "reset"].includes(payload.action)) {
    return Response.json({ error: "Ugyldig korrigeringsforespørsel." }, { status: 400 });
  }

  const corrections = await readCorrections();

  if (payload.action === "reset") {
    delete corrections[payload.id];
    await writeCorrections(corrections);
    return Response.json({ ok: true });
  }

  const text = payload.text?.trim();
  if (!text) return Response.json({ error: "Transkripsjonsteksten kan ikke være tom." }, { status: 400 });

  const originalText = await readOriginalText(payload.id);
  const originalWordCount = wordCount(originalText);
  const proposedWordCount = wordCount(text);
  if (originalWordCount >= 8 && proposedWordCount < Math.ceil(originalWordCount * 0.7)) {
    return Response.json(
      {
        error: "Den redigerte transkripsjonen er mye kortere enn originalen. Lagring er blokkert for å unngå at hele teksten erstattes med et utdrag.",
        originalWordCount,
        proposedWordCount
      },
      { status: 409 }
    );
  }

  corrections[payload.id] = {
    ...(corrections[payload.id] ?? {}),
    text
  };
  await writeCorrections(corrections);
  return Response.json({ ok: true });
}
