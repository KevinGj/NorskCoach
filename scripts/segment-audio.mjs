import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import speech from "@google-cloud/speech";
import ffmpegPath from "ffmpeg-static";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputDir = path.join(root, "NorskAudio");
const outputDir = path.join(root, "public", "audio", "norsk-segments");
const transcriptDir = path.join(root, "data", "transcripts");
const tmpDir = path.join(root, "data", "tmp-audio");
const manifestPath = path.join(root, "data", "audio-segments.json");
const client = new speech.SpeechClient();

const minSegmentSeconds = 10;
const maxSegmentSeconds = 20;
const selectedTrack = process.env.TRACK;
const silenceDb = "-34dB";
const silenceDuration = "0.45";
const utteranceLeadPadSeconds = 0.1;
const utteranceTailPadSeconds = 0.45;
const segmentLeadPadSeconds = 0.12;
const segmentTailPadSeconds = 0.65;
const announcementPattern =
  /\b(kapittel|leksjon|spor|track|side|oppgave|dialog|tekst|uttale|grammatikk|lytt|nummer|cd)\b/i;

function run(command, args, allowedExitCodes = [0]) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      if (allowedExitCodes.includes(code ?? 0)) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited ${code}\n${stderr}`));
    });
  });
}

async function getDuration(filePath) {
  const { stderr } = await run(ffmpegPath, ["-hide_banner", "-i", filePath], [0, 1]);
  const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) return 0;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

async function detectSilences(filePath) {
  const { stderr } = await run(ffmpegPath, [
    "-hide_banner",
    "-i",
    filePath,
    "-af",
    `silencedetect=noise=${silenceDb}:d=${silenceDuration}`,
    "-f",
    "null",
    "-"
  ]);

  const events = [];
  for (const line of stderr.split(/\r?\n/)) {
    const start = line.match(/silence_start:\s*([0-9.]+)/);
    const end = line.match(/silence_end:\s*([0-9.]+)/);
    if (start) events.push({ type: "start", time: Number(start[1]) });
    if (end) events.push({ type: "end", time: Number(end[1]) });
  }
  return events.sort((a, b) => a.time - b.time);
}

function buildUtterances(silenceEvents, duration) {
  const utterances = [];
  let speechStart = 0;

  for (const event of silenceEvents) {
    if (event.type === "start") {
      const speechEnd = event.time;
      if (speechEnd - speechStart >= 0.9) {
        utterances.push({ start: speechStart, end: speechEnd });
      }
    }
    if (event.type === "end") {
      speechStart = event.time;
    }
  }

  if (duration - speechStart >= 0.9) {
    utterances.push({ start: speechStart, end: duration });
  }

  const merged = [];
  for (const utterance of utterances) {
    const previous = merged.at(-1);
    if (previous && utterance.end - utterance.start < 1.3) {
      previous.end = utterance.end;
    } else {
      merged.push({ ...utterance });
    }
  }

  return merged
    .map((utterance) => ({
      start: Number(Math.max(0, utterance.start - utteranceLeadPadSeconds).toFixed(3)),
      end: Number(Math.min(duration, utterance.end + utteranceTailPadSeconds).toFixed(3))
    }))
    .filter((utterance) => utterance.end - utterance.start >= 1.1);
}

function seconds(value) {
  if (!value) return 0;
  return Number(value.seconds ?? 0) + Number(value.nanos ?? 0) / 1_000_000_000;
}

async function extractFlac(inputPath, outputPath, start, end) {
  await run(ffmpegPath, [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    start.toFixed(3),
    "-i",
    inputPath,
    "-t",
    Math.max(0.5, end - start).toFixed(3),
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "flac",
    outputPath
  ]);
}

async function transcribeAudio(filePath) {
  const audioBytes = await fs.readFile(filePath);
  const [response] = await client.recognize({
    config: {
      encoding: "FLAC",
      sampleRateHertz: 16000,
      languageCode: "nb-NO",
      alternativeLanguageCodes: ["nn-NO"],
      enableAutomaticPunctuation: true,
      enableWordTimeOffsets: true,
      model: "latest_long"
    },
    audio: { content: audioBytes.toString("base64") }
  });

  const transcript = (response.results ?? [])
    .map((result) => result.alternatives?.[0]?.transcript)
    .filter(Boolean)
    .join(" ")
    .trim();

  const words = [];
  for (const result of response.results ?? []) {
    for (const word of result.alternatives?.[0]?.words ?? []) {
      words.push({
        word: word.word,
        start: seconds(word.startTime),
        end: seconds(word.endTime)
      });
    }
  }

  return { transcript, words };
}

function looksLikeAnnouncement(utterance, index) {
  const text = utterance.text.trim();
  const duration = utterance.end - utterance.start;
  const wordCount = text ? text.split(/\s+/).length : 0;
  if (index < 4 && announcementPattern.test(text)) return true;
  if (index < 3 && duration < 4 && wordCount <= 5) return true;
  return false;
}

function groupUtterances(utterances) {
  const usable = utterances.filter((utterance, index) => !looksLikeAnnouncement(utterance, index));
  const groups = [];
  let current = [];

  for (const utterance of usable) {
    if (!current.length) {
      current.push(utterance);
      continue;
    }

    const candidateStart = current[0].start;
    const candidateDuration = utterance.end - candidateStart;
    const currentDuration = current[current.length - 1].end - candidateStart;

    if (candidateDuration <= maxSegmentSeconds || currentDuration < minSegmentSeconds) {
      current.push(utterance);
    } else {
      groups.push(current);
      current = [utterance];
    }
  }

  if (current.length) groups.push(current);

  return groups
    .map((group) => ({
      start: group[0].start,
      end: group[group.length - 1].end,
      text: group.map((utterance) => utterance.text).filter(Boolean).join(" "),
      utteranceCount: group.length
    }))
    .filter((segment) => {
      const duration = segment.end - segment.start;
      return duration >= 7 && duration <= 24;
    });
}

async function cutSegment(inputPath, outputPath, start, end) {
  await run(ffmpegPath, [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    Math.max(0, start - segmentLeadPadSeconds).toFixed(3),
    "-i",
    inputPath,
    "-t",
    Math.max(0.5, end - start + segmentLeadPadSeconds + segmentTailPadSeconds).toFixed(3),
    "-c:a",
    "libmp3lame",
    "-b:a",
    "128k",
    outputPath
  ]);
}

async function processTrack(file) {
  const inputPath = path.join(inputDir, file);
  const trackId = path.basename(file, path.extname(file)).replace(/\W+/g, "-").toLowerCase();
  const trackTmp = path.join(tmpDir, trackId);
  await fs.rm(trackTmp, { recursive: true, force: true });
  await fs.mkdir(trackTmp, { recursive: true });

  const duration = await getDuration(inputPath);
  const silenceEvents = await detectSilences(inputPath);
  const utterances = buildUtterances(silenceEvents, duration);
  const transcribed = [];

  for (const [index, utterance] of utterances.entries()) {
    const flacPath = path.join(trackTmp, `utterance-${String(index + 1).padStart(3, "0")}.flac`);
    await extractFlac(inputPath, flacPath, utterance.start, utterance.end);
    const transcript = await transcribeAudio(flacPath);
    transcribed.push({
      ...utterance,
      text: transcript.transcript,
      words: transcript.words
    });
  }

  const segments = groupUtterances(transcribed);
  await fs.writeFile(
    path.join(transcriptDir, `${trackId}.json`),
    JSON.stringify({ source: file, duration, utterances: transcribed, segments }, null, 2),
    "utf8"
  );
  await fs.rm(trackTmp, { recursive: true, force: true });

  const created = [];
  for (const [index, segment] of segments.entries()) {
    const id = `${trackId}-${String(index + 1).padStart(2, "0")}`;
    const outputName = `${id}.mp3`;
    await cutSegment(inputPath, path.join(outputDir, outputName), segment.start, segment.end);
    created.push({
      id,
      source: file,
      audio: `/audio/norsk-segments/${outputName}`,
      start: Number(segment.start.toFixed(3)),
      end: Number(segment.end.toFixed(3)),
      duration: Number((segment.end - segment.start).toFixed(3)),
      utteranceCount: segment.utteranceCount,
      text: segment.text
    });
  }

  return created;
}

async function main() {
  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.rm(transcriptDir, { recursive: true, force: true });
  await fs.rm(tmpDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(transcriptDir, { recursive: true });
  await fs.mkdir(tmpDir, { recursive: true });

  const files = (await fs.readdir(inputDir))
    .filter((file) => file.toLowerCase().endsWith(".mp3"))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const selectedFiles = selectedTrack
    ? files.filter((file) => file.toLowerCase().includes(selectedTrack.toLowerCase()))
    : process.env.TRACK_LIMIT
      ? files.slice(0, Number(process.env.TRACK_LIMIT))
      : files;

  if (!selectedFiles.length) {
    throw new Error(`No tracks matched ${selectedTrack}`);
  }

  const manifest = [];
  for (const file of selectedFiles) {
    console.log(`Processing ${file}`);
    const segments = await processTrack(file);
    manifest.push(...segments);
    console.log(`  ${segments.length} segments`);
  }

  await fs.rm(tmpDir, { recursive: true, force: true });
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  console.log(`Created ${manifest.length} audio segments`);
  console.log(`Manifest: ${manifestPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
