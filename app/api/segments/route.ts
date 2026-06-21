import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

type AudioSegment = {
  id: string;
  source?: string;
  start?: number;
  end?: number;
  [key: string]: unknown;
};

type SegmentCorrection = Partial<AudioSegment>;

type TranscriptWord = {
  word: string;
  start: number;
  end: number;
};

type TranscriptUtterance = {
  start: number;
  end: number;
  words?: TranscriptWord[];
};

type TranscriptFile = {
  utterances?: TranscriptUtterance[];
};

const segmentLeadPadSeconds = 0.12;

function trackIdFromSource(source: string) {
  return path.basename(source, path.extname(source)).replace(/\W+/g, "-").toLowerCase();
}

async function loadTranscriptWords(segment: AudioSegment) {
  if (!segment.source || typeof segment.start !== "number" || typeof segment.end !== "number") return [];
  const transcriptPath = path.join(process.cwd(), "data", "transcripts", `${trackIdFromSource(segment.source)}.json`);
  let transcript: TranscriptFile;

  try {
    transcript = JSON.parse(await fs.readFile(transcriptPath, "utf8")) as TranscriptFile;
  } catch {
    return [];
  }

  const clipStart = Math.max(0, segment.start - segmentLeadPadSeconds);
  const clipEnd = segment.end + 0.65;
  const words: TranscriptWord[] = [];

  for (const utterance of transcript.utterances ?? []) {
    if (utterance.end < segment.start || utterance.start > segment.end) continue;
    for (const word of utterance.words ?? []) {
      const absoluteStart = utterance.start + word.start;
      const absoluteEnd = utterance.start + word.end;
      if (absoluteEnd < segment.start || absoluteStart > clipEnd) continue;
      words.push({
        word: word.word,
        start: Number(Math.max(0, absoluteStart - clipStart).toFixed(3)),
        end: Number(Math.max(0, absoluteEnd - clipStart).toFixed(3))
      });
    }
  }

  return words;
}

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

    const correctedSegments = await Promise.all(
      segments.map(async (segment) => ({
        ...segment,
        words: await loadTranscriptWords(segment),
        ...(corrections[segment.id] ?? {})
      }))
    );

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
