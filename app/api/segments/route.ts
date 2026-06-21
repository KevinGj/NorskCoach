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

type TokenMerge = {
  match: string[];
  text: string;
};

type SegmentCorrection = Partial<AudioSegment> & {
  tokenMerges?: TokenMerge[];
};

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

type TimelineToken = {
  type: "word" | "pause";
  text: string;
  start: number;
  end: number;
  index: number;
};

const segmentLeadPadSeconds = 0.12;
const segmentTailPadSeconds = 0.65;
const pauseThresholdSeconds = 0.22;

function trackIdFromSource(source: string) {
  return path.basename(source, path.extname(source)).replace(/\W+/g, "-").toLowerCase();
}

function normalizeToken(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9æøå]/g, "");
}

function applyTokenMerges(words: TranscriptWord[], merges: TokenMerge[] = []) {
  if (!merges.length) return words;
  const merged: TranscriptWord[] = [];
  let index = 0;

  while (index < words.length) {
    const merge = merges.find((candidate) =>
      candidate.match.every((token, offset) => normalizeToken(words[index + offset]?.word ?? "") === normalizeToken(token))
    );

    if (!merge) {
      merged.push(words[index]);
      index += 1;
      continue;
    }

    const group = words.slice(index, index + merge.match.length);
    merged.push({
      word: merge.text,
      start: group[0].start,
      end: group[group.length - 1].end
    });
    index += merge.match.length;
  }

  return merged;
}

function buildTimelineTokens(words: TranscriptWord[], duration: number) {
  const tokens: TimelineToken[] = [];
  let previousEnd = 0;
  let wordIndex = 0;

  for (const word of words) {
    if (word.start - previousEnd >= pauseThresholdSeconds) {
      tokens.push({
        type: "pause",
        text: "",
        start: Number(previousEnd.toFixed(3)),
        end: Number(word.start.toFixed(3)),
        index: tokens.length
      });
    }

    tokens.push({
      type: "word",
      text: word.word,
      start: word.start,
      end: word.end,
      index: wordIndex
    });
    wordIndex += 1;
    previousEnd = Math.max(previousEnd, word.end);
  }

  if (duration - previousEnd >= pauseThresholdSeconds) {
    tokens.push({
      type: "pause",
      text: "",
      start: Number(previousEnd.toFixed(3)),
      end: Number(duration.toFixed(3)),
      index: tokens.length
    });
  }

  return tokens;
}

async function loadTranscriptWords(segment: AudioSegment, correction?: SegmentCorrection) {
  if (!segment.source || typeof segment.start !== "number" || typeof segment.end !== "number") return [];
  const transcriptPath = path.join(process.cwd(), "data", "transcripts", `${trackIdFromSource(segment.source)}.json`);
  let transcript: TranscriptFile;

  try {
    transcript = JSON.parse(await fs.readFile(transcriptPath, "utf8")) as TranscriptFile;
  } catch {
    return [];
  }

  const clipStart = Math.max(0, segment.start - segmentLeadPadSeconds);
  const clipEnd = segment.end + segmentTailPadSeconds;
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

  return applyTokenMerges(words, correction?.tokenMerges);
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
      segments.map(async (segment) => {
        const correction = corrections[segment.id];
        const words = await loadTranscriptWords(segment, correction);
        const correctedSegment = { ...segment, ...(correction ?? {}) };
        const tokenDuration =
          typeof correctedSegment.duration === "number"
            ? correctedSegment.duration
            : typeof segment.start === "number" && typeof segment.end === "number"
              ? segment.end - segment.start
              : 0;

        return {
          ...correctedSegment,
          originalText: segment.text,
          hasTextCorrection: Boolean(correction?.text),
          words,
          tokens: buildTimelineTokens(words, tokenDuration)
        };
      })
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
