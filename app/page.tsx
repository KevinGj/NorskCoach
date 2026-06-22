"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CoachFeedback, ExerciseType, LearnerProfile, Scores } from "@/lib/coach";

type StageId = ExerciseType | "reference" | "feedback";

type SessionStage = {
  id: StageId;
  title: string;
  minutes: number;
};

type SessionEntry = {
  date: string;
  minutes: number;
  scores: Scores;
  focus: string;
};

type Segment = {
  sentence: string;
  start: number;
  end: number;
};

type TimedWord = {
  word: string;
  start: number;
  end: number;
};

type TimelineToken = {
  type: "word" | "pause";
  text: string;
  start: number;
  end: number;
  index: number;
};

type AudioSegment = {
  id: string;
  source: string;
  audio: string;
  analysis?: string;
  start: number;
  end: number;
  duration: number;
  utteranceCount: number;
  text: string;
  originalText?: string;
  hasTextCorrection?: boolean;
  words?: TimedWord[];
  tokens?: TimelineToken[];
};

type VoiceOption = {
  name: string;
  label: string;
};

type PitchPoint = number | null;

type AudioAnalysis = {
  duration: number;
  waveform: number[];
  spectrogram: number[][];
  pitch: PitchPoint[];
  pitchHz: (number | null)[];
};

type Severity = "good" | "yellow" | "red";

type WordScore = {
  word: string;
  severity: Severity;
};

type VarianceZone = {
  start: number;
  width: number;
  severity: Exclude<Severity, "good">;
};

const voices: VoiceOption[] = [
  { name: "nb-NO-Chirp3-HD-Aoede", label: "Aoede" },
  { name: "nb-NO-Chirp3-HD-Achernar", label: "Achernar" },
  { name: "nb-NO-Chirp3-HD-Achird", label: "Achird" },
  { name: "nb-NO-Chirp3-HD-Charon", label: "Charon" },
  { name: "nb-NO-Chirp3-HD-Kore", label: "Kore" },
  { name: "nb-NO-Chirp3-HD-Puck", label: "Puck" },
  { name: "nb-NO-Chirp3-HD-Zephyr", label: "Zephyr" }
];

const stages: SessionStage[] = [
  { id: "reference", title: "Referanse", minutes: 5 },
  { id: "shadowing", title: "Skygging", minutes: 5 },
  { id: "conversation", title: "Samtale", minutes: 5 },
  { id: "storytelling", title: "Fortelling", minutes: 3 },
  { id: "feedback", title: "Veiledning", minutes: 2 }
];

const referenceParagraph =
  "Når jeg går ned mot havna tidlig om morgenen, merker jeg ofte hvordan byen våkner før menneskene gjør det. Det ligger et svakt lys over vannet, og lyden av en buss som bremser ved torget blander seg med måkeskrik og lave stemmer fra folk som skal på jobb. Jeg prøver å gå litt saktere akkurat der, fordi rytmen i stedet gjør noe med tankene mine. Først kommer de korte stegene over brosteinen, så en pause ved krysset, og deretter den lange, rolige bevegelsen langs kaia. Hvis været skifter, slik det ofte gjør her, må man nesten smile av hvor fort samtalen forandrer seg. Noen sier at regnet er tungt, andre sier at det bare renser lufta. For meg er det nettopp denne blandingen av praktisk hverdag og stille oppmerksomhet som gjør norsk språk så levende.";

const fallbackAudioSegment: AudioSegment = {
  id: "sample-reference",
  source: "Eksempelreferanse",
  audio: "",
  start: 0,
  end: 18,
  duration: 18,
  utteranceCount: 1,
  text: referenceParagraph
};

const shadowingLines = [
  "Jeg skal på butikken etter jobb.",
  "Det var hyggelig å treffe deg igjen.",
  "Kan du sende meg rapporten før lunsj?",
  "Vi tar det litt roligere i morgen."
];

const conversationPrompts = [
  "Hvordan har dagen din vært?",
  "Hva har du jobbet med i det siste?",
  "Hvordan går det med planene dine for sommeren?",
  "Hva ville du anbefalt en ny nabo å gjøre først?"
];

const storytellingPrompts = [
  "Fortell om gården din i Nordland.",
  "Beskriv en fisketur du husker godt.",
  "Hva liker du best med å bo i Norge?",
  "Fortell om en utfordring du løste på jobb."
];

const emptyProfile: LearnerProfile = {
  pronunciation_issues: [],
  strengths: [],
  common_patterns: []
};

const emptyScores: Scores = {
  pronunciation: 0,
  rhythm: 0,
  fluency: 0
};

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function averageScores(entries: SessionEntry[]): Scores {
  if (!entries.length) return emptyScores;
  return {
    pronunciation: Math.round(entries.reduce((sum, entry) => sum + entry.scores.pronunciation, 0) / entries.length),
    rhythm: Math.round(entries.reduce((sum, entry) => sum + entry.scores.rhythm, 0) / entries.length),
    fluency: Math.round(entries.reduce((sum, entry) => sum + entry.scores.fluency, 0) / entries.length)
  };
}

function streak(entries: SessionEntry[]) {
  const days = new Set(entries.map((entry) => entry.date));
  let count = 0;
  const cursor = new Date();
  while (days.has(cursor.toISOString().slice(0, 10))) {
    count += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}

function makeSegments(sentences: string[]): Segment[] {
  let cursor = 0;
  return sentences.map((sentence, index) => {
    const wordCount = sentence.trim().split(/\s+/).length;
    const duration = Math.max(3.4, wordCount * 0.44 + 1.1 + (index % 2) * 0.4);
    const segment = { sentence: sentence.trim(), start: cursor, end: cursor + duration };
    cursor += duration + 0.55;
    return segment;
  });
}

function splitSentenceText(text: string) {
  return text.match(/[^.!?]+(?:[.!?]+|$)/g)?.map((sentence) => sentence.trim()).filter(Boolean) ?? [];
}

function normalizeTimelineText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function wordsFromText(text: string) {
  return text
    .split(/\s+/)
    .map(normalizeTimelineText)
    .filter(Boolean);
}

function findBestTokenRange(sentenceWords: string[], wordTokens: TimelineToken[], cursor: number) {
  if (!sentenceWords.length || !wordTokens.length) return null;
  const expectedStart = Math.min(cursor, wordTokens.length - 1);
  const windowStart = Math.max(0, expectedStart - 5);
  const windowEnd = Math.min(wordTokens.length - 1, expectedStart + 7);
  let best: { startIndex: number; endIndex: number; score: number } | null = null;

  for (let startIndex = windowStart; startIndex <= windowEnd; startIndex += 1) {
    const availableCount = wordTokens.length - startIndex;
    const compareCount = Math.min(sentenceWords.length, availableCount);
    if (!compareCount) continue;

    let matches = 0;
    for (let offset = 0; offset < compareCount; offset += 1) {
      if (normalizeTimelineText(wordTokens[startIndex + offset].text) === sentenceWords[offset]) {
        matches += 1;
      }
    }

    const score = matches / Math.max(sentenceWords.length, 1);
    const candidate = {
      startIndex,
      endIndex: Math.min(wordTokens.length - 1, startIndex + sentenceWords.length - 1),
      score
    };

    if (!best || candidate.score > best.score || (candidate.score === best.score && Math.abs(candidate.startIndex - expectedStart) < Math.abs(best.startIndex - expectedStart))) {
      best = candidate;
    }
  }

  if (best && best.score >= 0.28) return best;
  return {
    startIndex: expectedStart,
    endIndex: Math.min(wordTokens.length - 1, expectedStart + sentenceWords.length - 1),
    score: 0
  };
}

function makeSegmentsForAudio(segment: AudioSegment): Segment[] {
  const sentenceTexts = splitSentenceText(segment.text);
  if (sentenceTexts.length < 2) {
    return [{ sentence: segment.text, start: 0, end: segment.duration }];
  }

  const wordTokens = segment.tokens?.filter((token) => token.type === "word").sort((a, b) => a.start - b.start) ?? [];
  if (wordTokens.length) {
    let cursor = 0;
    const tokenSegments = sentenceTexts.map((sentence, index) => {
      const sentenceWords = wordsFromText(sentence);
      const range = findBestTokenRange(sentenceWords, wordTokens, cursor);
      if (!range) return null;

      const nextSentenceWords = wordsFromText(sentenceTexts[index + 1] ?? "");
      const nextRange = nextSentenceWords.length ? findBestTokenRange(nextSentenceWords, wordTokens, range.endIndex + 1) : null;
      const rawStart = wordTokens[range.startIndex]?.start ?? 0;
      const rawEnd = wordTokens[range.endIndex]?.end ?? rawStart + 2;
      const nextStart = nextRange ? wordTokens[nextRange.startIndex]?.start : segment.duration;
      const startPad = index === 0 ? 0 : 0.28;
      const endPad = index === sentenceTexts.length - 1 ? 0.22 : 0.36;
      const start = Math.max(0, rawStart - startPad);
      const endLimit = Math.max(start + 0.4, Math.min(segment.duration, nextStart - 0.04));
      const end = Math.min(endLimit, Math.max(start + 0.4, rawEnd + endPad));

      cursor = Math.max(range.endIndex + 1, cursor + sentenceWords.length);
      return { sentence, start, end };
    });

    if (tokenSegments.every(Boolean)) return tokenSegments as Segment[];
  }

  const timed = makeSegments(sentenceTexts);
  const timedDuration = Math.max(...timed.map((sentence) => sentence.end));
  return timed.map((sentence) => ({
    ...sentence,
    start: (sentence.start / timedDuration) * segment.duration,
    end: (sentence.end / timedDuration) * segment.duration
  }));
}

function makeNativePitch(sentenceIndex: number, count = 72): PitchPoint[] {
  return Array.from({ length: count }, (_, index) => {
    const progress = index / (count - 1);
    const unvoicedGate = Math.sin(progress * Math.PI * (9 + sentenceIndex)) < -0.72;
    if (unvoicedGate && index % 3 !== 0) return null;
    const phraseFall = progress * 20;
    const melody = Math.sin(progress * Math.PI * (2.6 + sentenceIndex * 0.12)) * 16;
    const syllableLift = Math.sin(progress * Math.PI * (12 + sentenceIndex)) * 5;
    return Math.max(18, Math.min(82, 45 - melody + phraseFall - syllableLift));
  });
}

function downmixToMono(buffer: AudioBuffer) {
  const samples = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const channelData = buffer.getChannelData(channel);
    for (let index = 0; index < channelData.length; index += 1) {
      samples[index] += channelData[index] / buffer.numberOfChannels;
    }
  }
  return samples;
}

function frameRms(samples: Float32Array) {
  if (!samples.length) return 0;
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    sum += samples[index] * samples[index];
  }
  return Math.sqrt(sum / samples.length);
}

function getFrame(samples: Float32Array, center: number, size: number) {
  const start = Math.max(0, Math.min(samples.length - size, Math.round(center - size / 2)));
  return samples.slice(start, start + size);
}

function analyzeWaveform(samples: Float32Array, columns = 180) {
  const values = Array.from({ length: columns }, (_, column) => {
    const start = Math.floor((column / columns) * samples.length);
    const end = Math.max(start + 1, Math.floor(((column + 1) / columns) * samples.length));
    let peak = 0;
    for (let index = start; index < end; index += 1) {
      peak = Math.max(peak, Math.abs(samples[index] ?? 0));
    }
    return peak;
  });
  const max = Math.max(0.01, ...values);
  return values.map((value) => 12 + (value / max) * 72);
}

function goertzelMagnitude(frame: Float32Array, sampleRate: number, frequency: number) {
  const omega = (2 * Math.PI * frequency) / sampleRate;
  const coeff = 2 * Math.cos(omega);
  let q0 = 0;
  let q1 = 0;
  let q2 = 0;

  for (let index = 0; index < frame.length; index += 1) {
    const windowed = frame[index] * (0.5 - 0.5 * Math.cos((2 * Math.PI * index) / Math.max(1, frame.length - 1)));
    q0 = coeff * q1 - q2 + windowed;
    q2 = q1;
    q1 = q0;
  }

  return Math.sqrt(q1 * q1 + q2 * q2 - q1 * q2 * coeff) / frame.length;
}

function analyzeSpectrogram(samples: Float32Array, sampleRate: number, columns = 140) {
  const bands = [2800, 2100, 1600, 1200, 900, 650, 450, 300, 160];
  const frameSize = Math.min(4096, Math.max(1024, 2 ** Math.floor(Math.log2(samples.length / Math.max(columns, 1)))));
  const raw = Array.from({ length: columns }, (_, column) => {
    const center = ((column + 0.5) / columns) * samples.length;
    const frame = getFrame(samples, center, frameSize);
    const energyGate = Math.min(1, frameRms(frame) / 0.045);
    return bands.map((band) => Math.log1p(goertzelMagnitude(frame, sampleRate, band) * 90) * energyGate);
  });
  const max = Math.max(0.01, ...raw.flat());
  return raw.map((column) => column.map((value) => Math.max(0, Math.min(1, value / max))));
}

function percentile(values: number[], ratio: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)))] ?? 0;
}

function stabilizePitchHz(values: (number | null)[]) {
  const stabilized: (number | null)[] = [];
  let previous: number | null = null;

  values.forEach((value) => {
    if (!value) {
      stabilized.push(null);
      return;
    }

    let pitch = value;
    if (previous) {
      while (pitch > previous * 1.65 && pitch / 2 >= 70) pitch /= 2;
      while (pitch < previous / 1.65 && pitch * 2 <= 450) pitch *= 2;
    }
    previous = pitch;
    stabilized.push(pitch);
  });

  return stabilized.map((value, index) => {
    if (!value) return null;
    const window = stabilized
      .slice(Math.max(0, index - 1), Math.min(stabilized.length, index + 2))
      .filter((pitch): pitch is number => Boolean(pitch))
      .sort((a, b) => a - b);
    return window[Math.floor(window.length / 2)] ?? value;
  });
}

function normalizePitchSeriesToLane(values: (number | null)[]) {
  const voiced = values.filter((pitch): pitch is number => Boolean(pitch));
  if (!voiced.length) return values.map(() => null);
  const low = Math.max(70, percentile(voiced, 0.08));
  const high = Math.min(450, Math.max(low + 12, percentile(voiced, 0.92)));
  const lowLog = Math.log2(low);
  const range = Math.max(0.08, Math.log2(high) - lowLog);

  return values.map((pitch) => {
    if (!pitch) return null;
    const normalized = (Math.log2(Math.max(low, Math.min(high, pitch))) - lowLog) / range;
    return Math.max(18, Math.min(82, 82 - normalized * 64));
  });
}

function analyzePitch(samples: Float32Array, sampleRate: number, points = 160) {
  const frameSize = Math.min(3072, Math.max(2048, 2 ** Math.floor(Math.log2(samples.length / Math.max(points, 1)))));
  const raw = Array.from({ length: points }, (_, index) => {
    const center = ((index + 0.5) / points) * samples.length;
    const frame = getFrame(samples, center, frameSize);
    return detectPitch(frame, sampleRate);
  });
  const pitchHz = stabilizePitchHz(raw);
  return {
    pitch: normalizePitchSeriesToLane(pitchHz),
    pitchHz
  };
}

function analyzeAudioBuffer(buffer: AudioBuffer): AudioAnalysis {
  const samples = downmixToMono(buffer);
  const pitchAnalysis = analyzePitch(samples, buffer.sampleRate);
  return {
    duration: buffer.duration,
    waveform: analyzeWaveform(samples),
    spectrogram: analyzeSpectrogram(samples, buffer.sampleRate),
    pitch: pitchAnalysis.pitch,
    pitchHz: pitchAnalysis.pitchHz
  };
}

function resampleNumbers(values: number[], count: number, fallback: number[]) {
  const source = values.length ? values : fallback;
  return Array.from({ length: count }, (_, index) => {
    const sourceIndex = Math.round((index / Math.max(1, count - 1)) * Math.max(0, source.length - 1));
    return source[sourceIndex] ?? 0;
  });
}

function resamplePitch(values: PitchPoint[], count: number, fallback: PitchPoint[]) {
  const source = values.length ? values : fallback;
  return Array.from({ length: count }, (_, index) => {
    const sourceIndex = Math.round((index / Math.max(1, count - 1)) * Math.max(0, source.length - 1));
    return source[sourceIndex] ?? null;
  });
}

function resampleSpectrogram(values: number[][], count: number, fallback: number[][]) {
  const source = values.length ? values : fallback;
  return Array.from({ length: count }, (_, index) => {
    const sourceIndex = Math.round((index / Math.max(1, count - 1)) * Math.max(0, source.length - 1));
    return source[sourceIndex] ?? Array.from({ length: 9 }, () => 0);
  });
}

function sliceTimeline<T>(values: T[], analysis: AudioAnalysis | null, start: number, end: number) {
  if (!analysis || !values.length) return [];
  const safeDuration = Math.max(0.1, analysis.duration);
  const from = Math.floor((Math.max(0, start) / safeDuration) * values.length);
  const to = Math.ceil((Math.max(start + 0.1, end) / safeDuration) * values.length);
  return values.slice(Math.max(0, from), Math.min(values.length, Math.max(from + 1, to)));
}

function pointsToPolyline(points: PitchPoint[]) {
  return points
    .map((point, index) => {
      if (point === null) return "";
      return `${(index / Math.max(1, points.length - 1)) * 100},${point}`;
    })
    .filter(Boolean)
    .join(" ");
}

function pointsToPolylineSegments(points: PitchPoint[]) {
  const segments: string[] = [];
  let current: string[] = [];

  points.forEach((point, index) => {
    if (point === null) {
      if (current.length) segments.push(current.join(" "));
      current = [];
      return;
    }
    current.push(`${(index / Math.max(1, points.length - 1)) * 100},${point}`);
  });

  if (current.length) segments.push(current.join(" "));
  return segments;
}

function detectPitch(buffer: Float32Array, sampleRate: number) {
  const rms = frameRms(buffer);
  if (rms < 0.012) return null;

  const minTau = Math.max(2, Math.floor(sampleRate / 450));
  const maxTau = Math.min(buffer.length - 2, Math.floor(sampleRate / 70));
  const difference = new Float32Array(maxTau + 1);

  for (let tau = 1; tau <= maxTau; tau += 1) {
    let sum = 0;
    for (let index = 0; index < buffer.length - tau; index += 1) {
      const delta = buffer[index] - buffer[index + tau];
      sum += delta * delta;
    }
    difference[tau] = sum;
  }

  let runningTotal = 0;
  let bestTau = -1;
  let bestValue = Number.POSITIVE_INFINITY;

  for (let tau = 1; tau <= maxTau; tau += 1) {
    runningTotal += difference[tau];
    if (tau < minTau || runningTotal === 0) continue;
    const clarity = (difference[tau] * tau) / runningTotal;
    if (clarity < bestValue) {
      bestValue = clarity;
      bestTau = tau;
    }
    if (clarity < 0.12) {
      bestTau = tau;
      bestValue = clarity;
      break;
    }
  }

  if (bestTau < minTau || bestValue > 0.28) return null;
  const before = difference[bestTau - 1] ?? difference[bestTau];
  const at = difference[bestTau];
  const after = difference[bestTau + 1] ?? difference[bestTau];
  const adjustment = before + after - 2 * at === 0 ? 0 : (before - after) / (2 * (before + after - 2 * at));
  return sampleRate / (bestTau + Math.max(-0.5, Math.min(0.5, adjustment)));
}

function normalizePitchToLane(pitch: number | null, samples: number[]) {
  if (!pitch) return null;
  const voiced = samples.length ? samples : [110, 220];
  const min = Math.min(...voiced);
  const max = Math.max(...voiced);
  const range = Math.max(1, max - min);
  return Math.max(18, Math.min(82, 82 - ((pitch - min) / range) * 64));
}

function isEditableShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select" || target.isContentEditable;
}

function normalizeToken(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9æøå]/g, "");
}

function scoreTranscriptWords(reference: string, transcript: string): WordScore[] {
  if (!transcript.trim()) {
    return reference.split(/\s+/).filter(Boolean).map((word) => ({ word, severity: "good" }));
  }

  const spoken = transcript
    .split(/\s+/)
    .map(normalizeToken)
    .filter(Boolean);
  const spokenSet = new Set(spoken);
  let cursor = 0;

  return reference.split(/\s+/).filter(Boolean).map((word) => {
    const token = normalizeToken(word);
    const orderedIndex = spoken.indexOf(token, cursor);
    if (!token || orderedIndex >= cursor) {
      if (orderedIndex >= cursor) cursor = orderedIndex + 1;
      return { word, severity: "good" };
    }
    if (spokenSet.has(token)) return { word, severity: "yellow" };
    return { word, severity: "red" };
  });
}

function buildVarianceZones(nativePitch: PitchPoint[], studentPitch: PitchPoint[]): VarianceZone[] {
  if (!studentPitch.length) return [];

  const severities = nativePitch.map((nativePoint, index) => {
    const studentIndex = Math.round((index / Math.max(1, nativePitch.length - 1)) * Math.max(0, studentPitch.length - 1));
    const studentPoint = studentPitch[studentIndex];
    if (nativePoint === null || studentPoint === null || studentPoint === undefined) return "good" as Severity;
    const variance = Math.abs(nativePoint - studentPoint);
    if (variance > 28) return "red";
    if (variance > 16) return "yellow";
    return "good";
  });

  const zones: VarianceZone[] = [];
  let zoneStart = -1;
  let zoneSeverity: VarianceZone["severity"] | null = null;

  severities.forEach((severity, index) => {
    if (severity === "good") {
      if (zoneSeverity && zoneStart >= 0) {
        zones.push({
          start: (zoneStart / severities.length) * 100,
          width: ((index - zoneStart) / severities.length) * 100,
          severity: zoneSeverity
        });
      }
      zoneStart = -1;
      zoneSeverity = null;
      return;
    }

    if (zoneSeverity === severity) return;
    if (zoneSeverity && zoneStart >= 0) {
      zones.push({
        start: (zoneStart / severities.length) * 100,
        width: ((index - zoneStart) / severities.length) * 100,
        severity: zoneSeverity
      });
    }
    zoneStart = index;
    zoneSeverity = severity;
  });

  if (zoneSeverity && zoneStart >= 0) {
    zones.push({
      start: (zoneStart / severities.length) * 100,
      width: ((severities.length - zoneStart) / severities.length) * 100,
      severity: zoneSeverity
    });
  }

  return zones.filter((zone) => zone.width >= 3);
}

function summarizeSeverity(words: WordScore[], zones: VarianceZone[], vowelSeverity: Severity) {
  const missingWords = words.filter((word) => word.severity === "red").length;
  const weakWords = words.filter((word) => word.severity === "yellow").length;
  const redZones = zones.filter((zone) => zone.severity === "red").length;
  if (missingWords || redZones || vowelSeverity === "red") return "red";
  if (weakWords || zones.length || vowelSeverity === "yellow") return "yellow";
  return "good";
}

function truncateSentence(sentence: string) {
  return sentence.length > 45 ? `${sentence.slice(0, 45).trim()}...` : sentence;
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metricCard">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ScoreCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="scoreCard">
      <div>
        <span>{label}</span>
        <strong>{value || "--"}</strong>
      </div>
      <div className="miniTrack">
        <span style={{ width: `${value || 7}%` }} />
      </div>
    </div>
  );
}

function scoreToFive(value: number) {
  return Math.max(1, Math.min(5, Math.round(value / 20)));
}

function ExerciseScoreRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="exerciseScoreRow">
      <span>{label}</span>
      <strong>{value}/5</strong>
      <div className="scoreDots" aria-label={`${label}: ${value} av 5`}>
        {Array.from({ length: 5 }, (_, index) => (
          <i className={index < value ? "filled" : ""} key={index} />
        ))}
      </div>
    </div>
  );
}

function ExerciseAnalysisPanel({
  activeSentence,
  transcript,
  feedback,
  studentPitch
}: {
  activeSentence: string;
  transcript: string;
  feedback: CoachFeedback | null;
  studentPitch: PitchPoint[];
}) {
  const hasTranscript = Boolean(transcript.trim());
  const wordScores = scoreTranscriptWords(activeSentence, transcript);
  const redCount = wordScores.filter((word) => word.severity === "red").length;
  const yellowCount = wordScores.filter((word) => word.severity === "yellow").length;
  const wordCount = Math.max(1, wordScores.length);
  const clarityPercent = hasTranscript ? 100 - (redCount / wordCount) * 70 - (yellowCount / wordCount) * 28 : 0;
  const clarityScore = hasTranscript ? scoreToFive(clarityPercent) : 1;
  const rhythmScore = feedback ? scoreToFive(feedback.scores.rhythm) : Math.max(1, Math.min(5, clarityScore - (yellowCount ? 1 : 0)));
  const hasPitchTrace = studentPitch.some((point) => point !== null);
  const melodyScore = hasPitchTrace ? Math.max(2, Math.min(5, scoreToFive(feedback?.scores.fluency ?? clarityPercent))) : 2;
  const allUp = hasTranscript ? Math.round((clarityScore + rhythmScore + melodyScore) / 3) : 1;
  const issueWords = wordScores
    .filter((word) => word.severity !== "good")
    .slice(0, 4)
    .map((word) => word.word.replace(/[,.!?;:]$/, ""));

  return (
    <div className="exerciseAnalysisCard">
      <div className="exerciseAnalysisHeader">
        <p className="microLabel">Analyse av gjeldende øvelse</p>
        <strong>{hasTranscript ? `${allUp}/5` : "--/5"}</strong>
      </div>
      <h3>
        {hasTranscript
          ? clarityScore >= 4
            ? "God tydelighet. Fortsett å forme rytme og melodi."
            : "Tydelig nok til å øve videre. Spiss neste forsøk."
          : "Kjør analyse etter at du har lest inn dette segmentet."}
      </h3>
      <p>
        {hasTranscript
          ? issueWords.length
            ? `Sjekk STT/tekst rundt: ${issueWords.join(", ")}. Les deretter på nytt med jevnere rytme.`
            : "Orduttalen ser tydelig ut i transkripsjonen. Neste fokus: jevn rytme og setningsmelodi."
          : "Ta opp stemmen din, sjekk STT-teksten, og trykk Analyser for dette segmentet."}
      </p>
      <div className="exerciseScores">
        <ExerciseScoreRow label="Tydelighet" value={clarityScore} />
        <ExerciseScoreRow label="Rytme" value={rhythmScore} />
        <ExerciseScoreRow label="Melodi" value={melodyScore} />
      </div>
      {!hasPitchTrace && (
        <p className="analysisMessage">Melodipoeng er foreløpig til vi har fanget pitch-konturen fra stemmen din.</p>
      )}
    </div>
  );
}

function AudioStudyPanel({
  currentTime,
  duration,
  activeSentence,
  timelineTokens,
  transcript,
  sentenceIndex,
  nativeAnalysis,
  analysisStart,
  analysisEnd,
  analysisEngine,
  isAnalyzingAudio,
  studentPitch,
  isStudentListening,
  isPlaying,
  onPause,
  onScrub,
  onPlayToggle,
  onToggleStudent
}: {
  currentTime: number;
  duration: number;
  activeSentence: string;
  timelineTokens: TimelineToken[];
  transcript: string;
  sentenceIndex: number;
  nativeAnalysis: AudioAnalysis | null;
  analysisStart: number;
  analysisEnd: number;
  analysisEngine: string;
  isAnalyzingAudio: boolean;
  studentPitch: PitchPoint[];
  isStudentListening: boolean;
  isPlaying: boolean;
  onPause: () => void;
  onScrub: (time: number) => void;
  onPlayToggle: () => void;
  onToggleStudent: () => void;
}) {
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const playheadPercent = Math.min(100, Math.max(0, (currentTime / duration) * 100));
  const fallbackColumns = Array.from({ length: 108 }, (_, index) => {
    const progress = index / 107;
    const phrasePulse = Math.sin(progress * Math.PI * 9) * 0.5 + 0.5;
    const wordPulse = Math.sin(progress * Math.PI * 42) * 0.5 + 0.5;
    return 18 + phrasePulse * 34 + wordPulse * 24 + (index % 15 === 0 ? 15 : 0);
  });
  const fallbackSpectralColumns = Array.from({ length: 82 }, (_, timeIndex) =>
    Array.from({ length: 9 }, (_, freqIndex) => {
      const time = timeIndex / 81;
      const freq = freqIndex / 8;
      const slope = 0.2 + time * 0.38 + Math.sin(time * Math.PI * 3) * 0.08;
      const formant = Math.abs(freq - slope) < 0.12 || Math.abs(freq - (slope + 0.22)) < 0.08;
      return formant && Math.sin(time * Math.PI * 18) > -0.75 ? 0.75 : 0.12;
    })
  );
  const modeledPitch = makeNativePitch(sentenceIndex);
  const analyzedWaveform = sliceTimeline(nativeAnalysis?.waveform ?? [], nativeAnalysis, analysisStart, analysisEnd);
  const analyzedSpectrogram = sliceTimeline(nativeAnalysis?.spectrogram ?? [], nativeAnalysis, analysisStart, analysisEnd);
  const analyzedPitch = sliceTimeline(nativeAnalysis?.pitch ?? [], nativeAnalysis, analysisStart, analysisEnd);
  const analyzedPitchHz = sliceTimeline(nativeAnalysis?.pitchHz ?? [], nativeAnalysis, analysisStart, analysisEnd);
  const columns = resampleNumbers(analyzedWaveform, 108, fallbackColumns);
  const spectralColumns = resampleSpectrogram(analyzedSpectrogram, 82, fallbackSpectralColumns);
  const nativePitch = resamplePitch(analyzedPitch, 180, modeledPitch);
  const nativePitchHz = resamplePitch(analyzedPitchHz, 180, []);
  const hasRealAnalysis = Boolean(nativeAnalysis && analyzedWaveform.length && analyzedSpectrogram.length);
  const nativePitchSegments = pointsToPolylineSegments(nativePitch);
  const studentPolyline = pointsToPolyline(studentPitch);
  const nativeHzValues = nativePitchHz.filter((pitch): pitch is number => Boolean(pitch));
  const nativeHzLabel = nativeHzValues.length
    ? `${Math.round(Math.min(...nativeHzValues))}-${Math.round(Math.max(...nativeHzValues))} Hz`
    : "ingen stabil F0";
  const voicedStudent = studentPitch.filter((point): point is number => point !== null);
  const latestStudent = voicedStudent.at(-1);
  const vowelX = latestStudent ? Math.max(15, Math.min(85, 100 - latestStudent)) : 55;
  const vowelY = latestStudent ? Math.max(18, Math.min(82, 36 + Math.sin(latestStudent / 11) * 24)) : 60;
  const wordScores = scoreTranscriptWords(activeSentence, transcript);
  const activeGlobalTime = analysisStart + currentTime;
  const visibleWordTokens = timelineTokens.filter(
    (token) => token.type === "word" && token.end >= analysisStart - 0.05 && token.start <= analysisEnd + 0.05
  );
  const activeWordIndex = visibleWordTokens.findIndex(
    (token) => activeGlobalTime >= token.start - 0.03 && activeGlobalTime <= token.end + 0.08
  );
  const varianceZones = buildVarianceZones(nativePitch, studentPitch);
  const vowelDistance = latestStudent ? Math.abs(vowelX - 50) + Math.abs(vowelY - 50) : 0;
  const vowelSeverity: Severity = !latestStudent ? "good" : vowelDistance > 42 ? "red" : vowelDistance > 25 ? "yellow" : "good";
  const totalSeverity = summarizeSeverity(wordScores, varianceZones, vowelSeverity);
  const redWords = wordScores.filter((word) => word.severity === "red").slice(0, 4).map((word) => word.word.replace(/[,.!?;:]$/, ""));
  const yellowWords = wordScores.filter((word) => word.severity === "yellow").slice(0, 4).map((word) => word.word.replace(/[,.!?;:]$/, ""));

  const scrubFromPointer = (clientX: number) => {
    const rect = timelineRef.current?.getBoundingClientRect();
    if (!rect) return;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    onScrub(ratio * duration);
  };

  return (
    <>
      <div className="sectionHead">
        <div>
          <p>Setningsanalyse · Tid · Frekvens · Amplitude</p>
          <h2>Se melodien i stemmen</h2>
          <span className={hasRealAnalysis ? "analysisStatus ready" : "analysisStatus"}>
            {isAnalyzingAudio
              ? "Analyserer lyd..."
              : hasRealAnalysis
                ? analysisEngine === "praat-parselmouth"
                  ? "Praat audioanalyse"
                  : "Ekte audioanalyse"
                : "Modellert forhåndsvisning"}
          </span>
        </div>
        <div className="analysisActions">
          <button className={isStudentListening ? "recording ghostButton" : "ghostButton activeGhost"} onClick={onToggleStudent}>
            {isStudentListening ? "Stopp pitch" : "Mål min pitch"}
          </button>
        </div>
      </div>

      <div className="analysisPanel">
        <button
          className="graphPlayButton"
          onClick={isPlaying ? onPause : onPlayToggle}
          onPointerDown={(event) => event.stopPropagation()}
          type="button"
        >
          {isPlaying ? "Pause" : "▶ Spill"}
        </button>
        <div
          ref={timelineRef}
          className="analysisTrackArea"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            scrubFromPointer(event.clientX);
          }}
          onPointerMove={(event) => {
            if (event.buttons === 1) scrubFromPointer(event.clientX);
          }}
        >
        <div className="playhead" style={{ left: `${playheadPercent}%` }} />
        <div className="waveform" aria-label="Volumkurve for valgt setning">
          {columns.map((height, index) => (
            <span key={index} style={{ height: `${height}%` }} />
          ))}
        </div>
        <div className="pitchOverlay" aria-label="Pitch-overlegg">
          {varianceZones.map((zone, index) => (
            <span
              className={`varianceZone ${zone.severity}`}
              key={`${zone.start}-${index}`}
              style={{ left: `${zone.start}%`, width: `${zone.width}%` }}
            />
          ))}
          <span className="laneLabel">Innfødt</span>
          <span className="pitchRangeLabel">{nativeHzLabel}</span>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {nativePitchSegments.map((segment, index) => (
              <polyline className="nativeLine" key={`${segment}-${index}`} points={segment} />
            ))}
            {studentPolyline && <polyline className="studentLine" points={studentPolyline} />}
          </svg>
          <span className="studentHint">Elev · {studentPolyline ? "aktiv kontur" : "venter på opptak"}</span>
        </div>
        <div className="spectrogram" aria-label="Lærervennlig spektrogram">
          {spectralColumns.map((column, index) => (
            <div className="spectralColumn" key={index}>
              {column.map((intensity, freqIndex) => (
                <span
                  className={intensity > 0.38 ? "hot" : ""}
                  key={freqIndex}
                  style={{
                    opacity: Math.max(0.22, intensity),
                    backgroundColor: intensity > 0.18 ? `rgba(235, 196, 67, ${0.16 + intensity * 0.7})` : undefined
                  }}
                />
              ))}
            </div>
          ))}
        </div>
        <div className="timeReadout">
          <span>{currentTime.toFixed(1)}s</span>
          <span>{duration.toFixed(1)}s</span>
        </div>
        </div>
      </div>

      <div className="activeSentence">
        <span>{sentenceIndex + 1}</span>
        <div>
          <p>Aktiv setning · {currentTime.toFixed(1)}-{duration.toFixed(1)}s</p>
          <strong>
            {wordScores.map((score, index) => (
              <mark className={`wordMark ${score.severity} ${index === activeWordIndex ? "playing" : ""}`} key={`${score.word}-${index}`}>
                {score.word}
              </mark>
            ))}
          </strong>
        </div>
      </div>

      <div className={`focusScore ${totalSeverity}`}>
        <div>
          <p className="microLabel">Fokusområder</p>
          <h3>{totalSeverity === "red" ? "Jobb med disse først" : totalSeverity === "yellow" ? "Nesten der" : "God match"}</h3>
        </div>
        <ul>
          <li>
            <span className={redWords.length ? "red" : "good"} />
            {redWords.length ? `Sjekk STT/tekst rundt: ${redWords.join(", ")}` : "STT-transkripsjonen dekker referansen godt"}
          </li>
          <li>
            <span className={varianceZones.some((zone) => zone.severity === "red") ? "red" : varianceZones.length ? "yellow" : "good"} />
            {varianceZones.length ? "Se de markerte pitch-sonene i grafen" : "Pitch-konturen har ingen store avvik ennå"}
          </li>
          <li>
            <span className={vowelSeverity} />
            {vowelSeverity === "red"
              ? "Vokalplasseringen er langt fra målet"
              : vowelSeverity === "yellow"
                ? "Vokalplasseringen bør justeres litt"
                : "Vokalplasseringen ser stabil ut"}
          </li>
          {yellowWords.length > 0 && (
            <li>
              <span className="yellow" />
              Mulig STT-rekkefølge eller tegnsetting: {yellowWords.join(", ")}
            </li>
          )}
        </ul>
      </div>

      <div className={`vowelChart ${vowelSeverity}`}>
        <div>
          <p className="microLabel">Formant guide · F1/F2</p>
          <h3>Vokalplassering</h3>
          <p>Sikt munnen mot den norske vokalen, punktet viser din nåværende plassering.</p>
        </div>
        <div className="vowelGrid" aria-label="Forenklet vokalkart">
          {["i", "y", "u", "e", "ø", "o", "æ", "a", "å"].map((vowel, index) => (
            <span className="vowelTarget" key={vowel} style={{ left: `${18 + (index % 3) * 32}%`, top: `${18 + Math.floor(index / 3) * 30}%` }}>
              {vowel}
            </span>
          ))}
          <span className="vowelDot" style={{ left: `${vowelX}%`, top: `${vowelY}%` }} />
        </div>
      </div>
    </>
  );
}

export default function Home() {
  const [stageIndex, setStageIndex] = useState(0);
  const [selectedSentence, setSelectedSentence] = useState(0);
  const [audioSegments, setAudioSegments] = useState<AudioSegment[]>([]);
  const [selectedAudioSegmentId, setSelectedAudioSegmentId] = useState(fallbackAudioSegment.id);
  const [trackFilter, setTrackFilter] = useState("all");
  const [segmentQuery, setSegmentQuery] = useState("");
  const [isEditingReferenceText, setIsEditingReferenceText] = useState(false);
  const [referenceTextDraft, setReferenceTextDraft] = useState("");
  const [referenceTextError, setReferenceTextError] = useState("");
  const [isSavingReferenceText, setIsSavingReferenceText] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState(voices[0].name);
  const [referenceTime, setReferenceTime] = useState(0);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [isSpeechLoading, setIsSpeechLoading] = useState(false);
  const [nativeAnalysis, setNativeAnalysis] = useState<AudioAnalysis | null>(null);
  const [isAnalyzingAudio, setIsAnalyzingAudio] = useState(false);
  const [analysisEngine, setAnalysisEngine] = useState("");
  const [studentPitch, setStudentPitch] = useState<PitchPoint[]>([]);
  const [isStudentListening, setIsStudentListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [userRecordingUrl, setUserRecordingUrl] = useState("");
  const [isUserPlaybackPlaying, setIsUserPlaybackPlaying] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [feedback, setFeedback] = useState<CoachFeedback | null>(null);
  const [analysisMessage, setAnalysisMessage] = useState("");
  const [showCoachSummary, setShowCoachSummary] = useState(false);
  const [profile, setProfile] = useState<LearnerProfile>(emptyProfile);
  const [entries, setEntries] = useState<SessionEntry[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const transcriptRef = useRef("");
  const shortcutActionsRef = useRef<{
    toggleListening: () => void | Promise<void>;
    toggleNarration: () => void;
    canRecord: boolean;
  }>({
    toggleListening: () => undefined,
    toggleNarration: () => undefined,
    canRecord: true
  });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const userAudioRef = useRef<HTMLAudioElement | null>(null);
  const userRecordingUrlRef = useRef<string | null>(null);
  const speechRecorderRef = useRef<MediaRecorder | null>(null);
  const speechStreamRef = useRef<MediaStream | null>(null);
  const speechChunksRef = useRef<Blob[]>([]);
  const analysisContextRef = useRef<AudioContext | null>(null);
  const micContextRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micIntervalRef = useRef<number | null>(null);
  const playbackOffsetRef = useRef(0);
  const playbackStopAtRef = useRef<number | null>(null);

  const stage = stages[stageIndex];
  const librarySegments = audioSegments.length ? audioSegments : [fallbackAudioSegment];
  const trackOptions = Array.from(new Set(librarySegments.map((segment) => segment.source)));
  const filteredLibrarySegments = librarySegments.filter((segment) => {
    const matchesTrack = trackFilter === "all" || segment.source === trackFilter;
    const query = segmentQuery.trim().toLowerCase();
    const matchesQuery =
      !query ||
      segment.id.toLowerCase().includes(query) ||
      segment.source.toLowerCase().includes(query) ||
      segment.text.toLowerCase().includes(query);
    return matchesTrack && matchesQuery;
  });
  const selectedAudioSegment =
    librarySegments.find((segment) => segment.id === selectedAudioSegmentId) ?? librarySegments[0] ?? fallbackAudioSegment;
  const activeReferenceDuration = nativeAnalysis?.duration ?? selectedAudioSegment.duration;
  const timingAudioSegment = { ...selectedAudioSegment, duration: activeReferenceDuration };
  const activeReferenceSegments = makeSegmentsForAudio(timingAudioSegment);
  const selectedSegment = activeReferenceSegments[selectedSentence] ?? activeReferenceSegments[0];
  const selectedSentenceDuration = selectedSegment.end - selectedSegment.start;
  const selectedSentenceTime = Math.min(selectedSentenceDuration, Math.max(0, referenceTime - selectedSegment.start));
  const segmentAtReferenceTime = (time: number) =>
    activeReferenceSegments.filter((segment) => time >= segment.start && time <= segment.end).at(-1) ?? activeReferenceSegments[0];
  const prompt = useMemo(() => {
    if (stage.id === "reference") return selectedAudioSegment.text;
    if (stage.id === "shadowing") return shadowingLines[entries.length % shadowingLines.length];
    if (stage.id === "conversation") return conversationPrompts[entries.length % conversationPrompts.length];
    if (stage.id === "storytelling") return storytellingPrompts[entries.length % storytellingPrompts.length];
    return feedback?.focus ?? "Fullfør økten for å få coaching.";
  }, [entries.length, feedback?.focus, selectedAudioSegment.text, stage.id]);
  const averages = averageScores(entries);
  const totalMinutes = entries.reduce((sum, entry) => sum + entry.minutes, 0);
  const activeScores = feedback?.scores ?? averages;
  const loadAudioSegments = useCallback(async () => {
    try {
      const response = await fetch("/api/segments");
      const segments = (await response.json()) as AudioSegment[];
      if (!segments.length) return;
      setAudioSegments(segments);
      setSelectedAudioSegmentId((current) =>
        current === fallbackAudioSegment.id || !segments.some((segment) => segment.id === current)
          ? segments[0].id
          : current
      );
    } catch {
      setAudioSegments([]);
    }
  }, []);

  useEffect(() => {
    const savedProfile = localStorage.getItem("norsk-coach-profile");
    const savedEntries = localStorage.getItem("norsk-coach-entries");
    const savedVoice = localStorage.getItem("norsk-coach-voice");
    const savedSegment = localStorage.getItem("norsk-coach-segment");
    if (savedProfile) setProfile(JSON.parse(savedProfile) as LearnerProfile);
    if (savedEntries) setEntries(JSON.parse(savedEntries) as SessionEntry[]);
    if (savedVoice && voices.some((voice) => voice.name === savedVoice)) setSelectedVoice(savedVoice);
    if (savedSegment) setSelectedAudioSegmentId(savedSegment);
  }, []);

  useEffect(() => {
    void loadAudioSegments();
  }, [loadAudioSegments]);

  useEffect(() => {
    let cancelled = false;

    if (!selectedAudioSegment.audio) {
      setNativeAnalysis(null);
      setAnalysisEngine("");
      setIsAnalyzingAudio(false);
      return () => {
        cancelled = true;
      };
    }

    const loadStoredAnalysis = async () => {
      if (!selectedAudioSegment.analysis) return null;
      const response = await fetch(selectedAudioSegment.analysis);
      if (!response.ok) return null;
      const analysis = (await response.json()) as AudioAnalysis & { engine?: string };
      if (!analysis.waveform?.length || !analysis.spectrogram?.length || !analysis.pitch?.length) return null;
      return analysis;
    };

    const analyzeSelectedAudio = async () => {
      setIsAnalyzingAudio(true);
      try {
        const storedAnalysis = await loadStoredAnalysis();
        if (storedAnalysis) {
          if (!cancelled) {
            setNativeAnalysis(storedAnalysis);
            setAnalysisEngine(storedAnalysis.engine ?? "offline");
          }
          return;
        }

        const response = await fetch(selectedAudioSegment.audio);
        if (!response.ok) throw new Error("Could not load reference audio.");
        const encodedAudio = await response.arrayBuffer();
        const context = analysisContextRef.current ?? new AudioContext();
        analysisContextRef.current = context;
        const decodedAudio = await context.decodeAudioData(encodedAudio.slice(0));
        const analysis = analyzeAudioBuffer(decodedAudio);
        if (!cancelled) {
          setNativeAnalysis(analysis);
          setAnalysisEngine("browser");
        }
      } catch (error) {
        console.warn("Audio analysis failed, using modeled preview.", error);
        if (!cancelled) {
          setNativeAnalysis(null);
          setAnalysisEngine("");
        }
      } finally {
        if (!cancelled) setIsAnalyzingAudio(false);
      }
    };

    void analyzeSelectedAudio();

    return () => {
      cancelled = true;
    };
  }, [selectedAudioSegment.analysis, selectedAudioSegment.audio]);

  useEffect(() => {
    localStorage.setItem("norsk-coach-profile", JSON.stringify(profile));
  }, [profile]);

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  useEffect(() => {
    localStorage.setItem("norsk-coach-entries", JSON.stringify(entries));
  }, [entries]);

  useEffect(() => {
    localStorage.setItem("norsk-coach-voice", selectedVoice);
  }, [selectedVoice]);

  useEffect(() => {
    localStorage.setItem("norsk-coach-segment", selectedAudioSegmentId);
  }, [selectedAudioSegmentId]);

  useEffect(() => {
    setReferenceTextDraft(selectedAudioSegment.text);
    setReferenceTextError("");
    setIsEditingReferenceText(false);
  }, [selectedAudioSegment.id, selectedAudioSegment.text]);

  useEffect(() => {
    setSelectedSentence(0);
    setReferenceTime(0);
    setStudentPitch([]);
    stopAudio();
    stopStudentPitch();
  }, [selectedAudioSegmentId]);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      userAudioRef.current?.pause();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      if (userRecordingUrlRef.current) URL.revokeObjectURL(userRecordingUrlRef.current);
      if (speechRecorderRef.current?.state === "recording") speechRecorderRef.current.stop();
      speechStreamRef.current?.getTracks().forEach((track) => track.stop());
      void analysisContextRef.current?.close();
      micStreamRef.current?.getTracks().forEach((track) => track.stop());
      if (micIntervalRef.current) window.clearInterval(micIntervalRef.current);
      void micContextRef.current?.close();
    };
  }, []);

  const stopAudio = () => {
    audioRef.current?.pause();
    window.speechSynthesis?.cancel();
    playbackStopAtRef.current = null;
    setIsAudioPlaying(false);
  };

  const stopSpeechCapture = () => {
    if (speechRecorderRef.current?.state === "recording") {
      speechRecorderRef.current.stop();
    }
    speechStreamRef.current?.getTracks().forEach((track) => track.stop());
    speechStreamRef.current = null;
    setIsListening(false);
  };

  const transcribeUserRecording = async (blob: Blob) => {
    setIsTranscribing(true);
    setAnalysisMessage("Opptak lagret. Transkriberer med Google STT...");
    try {
      const formData = new FormData();
      formData.append("audio", blob, `opptak.${blob.type.includes("ogg") ? "ogg" : "webm"}`);
      const response = await fetch("/api/transcribe", {
        method: "POST",
        body: formData
      });
      const payload = (await response.json().catch(() => null)) as { transcript?: string; error?: string } | null;
      if (!response.ok || !payload?.transcript) {
        throw new Error(payload?.error ?? "Transkripsjonen feilet.");
      }
      transcriptRef.current = payload.transcript;
      setTranscript(payload.transcript);
      setAnalysisMessage("Transkripsjon klar. Kjører analyse...");
      void runCoachAnalysis(payload.transcript);
    } catch (error) {
      setAnalysisMessage(error instanceof Error ? error.message : "Transkripsjonen feilet, men opptaket er lagret for avspilling.");
    } finally {
      setIsTranscribing(false);
    }
  };

  const startSpeechRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setAnalysisMessage("Nettleseren kan ikke ta opp lyd her. STT kan fortsatt fungere.");
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    speechStreamRef.current = stream;
    speechChunksRef.current = [];

    if (userRecordingUrlRef.current) URL.revokeObjectURL(userRecordingUrlRef.current);
    userRecordingUrlRef.current = null;
    setUserRecordingUrl("");
    setIsUserPlaybackPlaying(false);

    const recorder = new MediaRecorder(stream);
    speechRecorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) speechChunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(speechChunksRef.current, { type: recorder.mimeType || "audio/webm" });
      if (blob.size > 0) {
        const url = URL.createObjectURL(blob);
        userRecordingUrlRef.current = url;
        setUserRecordingUrl(url);
        void transcribeUserRecording(blob);
      }
      speechStreamRef.current?.getTracks().forEach((track) => track.stop());
      speechStreamRef.current = null;
      speechRecorderRef.current = null;
    };
    recorder.start();
  };

  const pauseReferenceAudio = () => {
    const audio = audioRef.current;
    if (audio && !audio.paused) {
      playbackOffsetRef.current = audio.currentTime;
      setReferenceTime(audio.currentTime);
      audio.pause();
    } else {
      stopAudio();
    }
  };

  const stopStudentPitch = () => {
    if (micIntervalRef.current) {
      window.clearInterval(micIntervalRef.current);
      micIntervalRef.current = null;
    }
    micStreamRef.current?.getTracks().forEach((track) => track.stop());
    micStreamRef.current = null;
    void micContextRef.current?.close();
    micContextRef.current = null;
    setIsStudentListening(false);
  };

  const toggleStudentPitch = async () => {
    if (isStudentListening) {
      stopStudentPitch();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) return;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setIsStudentListening(false);
      return;
    }

    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    const buffer = new Float32Array(analyser.fftSize);
    const voicedSamples: number[] = [];

    setStudentPitch([]);
    setIsStudentListening(true);
    micStreamRef.current = stream;
    micContextRef.current = context;
    micIntervalRef.current = window.setInterval(() => {
      analyser.getFloatTimeDomainData(buffer);
      const pitch = detectPitch(buffer, context.sampleRate);
      if (pitch) voicedSamples.push(pitch);
      setStudentPitch((current) => [...current.slice(-90), normalizePitchToLane(pitch, voicedSamples)]);
    }, 90);
  };

  const fallbackSpeech = (text: string, rate: number, offset: number, trackReference: boolean) => {
    if (!("speechSynthesis" in window)) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "nb-NO";
    utterance.rate = rate;
    utterance.onend = () => setIsAudioPlaying(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    playbackOffsetRef.current = offset;
    setIsAudioPlaying(true);

    if (trackReference) {
      const startedAt = performance.now();
      const interval = window.setInterval(() => {
        if (!window.speechSynthesis.speaking) {
          window.clearInterval(interval);
          return;
        }
        setReferenceTime(Math.min(activeReferenceDuration, offset + (performance.now() - startedAt) / 1000));
      }, 50);
    }
  };

  const playGoogleSpeech = async (text: string, rate = 0.94, offset = 0, trackReference = false) => {
    stopAudio();
    setIsSpeechLoading(true);
    try {
      const response = await fetch("/api/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice: selectedVoice, speakingRate: rate })
      });

      if (!response.ok) throw new Error(await response.text());

      const blob = await response.blob();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      playbackOffsetRef.current = offset;
      audio.onplay = () => setIsAudioPlaying(true);
      audio.onpause = () => setIsAudioPlaying(false);
      audio.onended = () => setIsAudioPlaying(false);
      audio.ontimeupdate = () => {
        if (trackReference) {
          const nextTime = Math.min(activeReferenceDuration, playbackOffsetRef.current + audio.currentTime);
          setReferenceTime(nextTime);
          const segment = segmentAtReferenceTime(nextTime);
          setSelectedSentence(Math.max(0, activeReferenceSegments.indexOf(segment)));
        }
      };
      await audio.play();
    } catch (error) {
      console.warn("Google speech failed, falling back to browser TTS.", error);
      fallbackSpeech(text, rate, offset, trackReference);
    } finally {
      setIsSpeechLoading(false);
    }
  };

  const playReferenceAudio = async (url: string, offset = 0, trackReference = true, stopAt: number | null = null) => {
    if (!url) {
      fallbackSpeech(selectedAudioSegment.text, 0.92, offset, trackReference);
      return;
    }

    stopAudio();
    setIsSpeechLoading(true);
    try {
      const audio = new Audio(url);
      audioRef.current = audio;
      playbackOffsetRef.current = offset;
      playbackStopAtRef.current = stopAt;
      audio.currentTime = offset;
      audio.onplay = () => setIsAudioPlaying(true);
      audio.onpause = () => setIsAudioPlaying(false);
      audio.onended = () => {
        playbackStopAtRef.current = null;
        setIsAudioPlaying(false);
      };
      audio.ontimeupdate = () => {
        if (trackReference) {
          const nextTime = Math.min(activeReferenceDuration, audio.currentTime);
          setReferenceTime(nextTime);
          const segment = segmentAtReferenceTime(nextTime);
          setSelectedSentence(Math.max(0, activeReferenceSegments.indexOf(segment)));
          if (playbackStopAtRef.current !== null && nextTime >= playbackStopAtRef.current) {
            audio.pause();
            audio.currentTime = playbackStopAtRef.current;
            setReferenceTime(playbackStopAtRef.current);
            playbackOffsetRef.current = playbackStopAtRef.current;
            playbackStopAtRef.current = null;
          }
        }
      };
      await audio.play();
    } finally {
      setIsSpeechLoading(false);
    }
  };

  const playFullReference = () => {
    if (isAudioPlaying) {
      pauseReferenceAudio();
      return;
    }
    const savedTime = Math.max(referenceTime, playbackOffsetRef.current);
    const resumeTime = savedTime >= activeReferenceDuration - 0.05 ? 0 : Math.min(activeReferenceDuration, Math.max(0, savedTime));
    const segment = segmentAtReferenceTime(resumeTime);
    setSelectedSentence(Math.max(0, activeReferenceSegments.indexOf(segment)));
    setReferenceTime(resumeTime);
    void playReferenceAudio(selectedAudioSegment.audio, resumeTime, true);
  };

  const playSelectedSentence = () => {
    if (isAudioPlaying) {
      pauseReferenceAudio();
      return;
    }
    const resumeTime =
      referenceTime >= selectedSegment.start && referenceTime < selectedSegment.end ? referenceTime : selectedSegment.start;
    setReferenceTime(resumeTime);
    setStudentPitch([]);
    void playReferenceAudio(selectedAudioSegment.audio, resumeTime, true, selectedSegment.end);
  };

  const scrubReference = (time: number) => {
    const globalTime = selectedSegment.start + Math.min(selectedSentenceDuration, Math.max(0, time));
    setReferenceTime(globalTime);
    playbackOffsetRef.current = globalTime;
    if (isAudioPlaying) {
      const audio = audioRef.current;
      if (audio && selectedAudioSegment.audio) {
        audio.currentTime = globalTime;
        playbackStopAtRef.current = selectedSegment.end;
      } else {
        void playReferenceAudio(selectedAudioSegment.audio, globalTime, true, selectedSegment.end);
      }
    }
  };

  const saveReferenceText = async () => {
    setIsSavingReferenceText(true);
    setReferenceTextError("");
    try {
      const response = await fetch("/api/segment-corrections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", id: selectedAudioSegment.id, text: referenceTextDraft })
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Kunne ikke lagre transkripsjonen.");
      }
      await loadAudioSegments();
      setIsEditingReferenceText(false);
    } catch (error) {
      setReferenceTextError(error instanceof Error ? error.message : "Kunne ikke lagre transkripsjonen.");
    } finally {
      setIsSavingReferenceText(false);
    }
  };

  const resetReferenceText = async () => {
    setIsSavingReferenceText(true);
    setReferenceTextError("");
    try {
      const response = await fetch("/api/segment-corrections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset", id: selectedAudioSegment.id })
      });
      if (!response.ok) throw new Error(await response.text());
      await loadAudioSegments();
      setIsEditingReferenceText(false);
    } finally {
      setIsSavingReferenceText(false);
    }
  };

  const speak = () => {
    if (stage.id === "reference") {
      playFullReference();
      return;
    }
    void playGoogleSpeech(prompt, stage.id === "shadowing" ? 0.9 : 0.96);
  };

  const toggleListening = async () => {
    setAnalysisMessage("");
    if (isListening) {
      stopSpeechCapture();
      return;
    }

    try {
      await startSpeechRecording();
    } catch {
      setAnalysisMessage("Fikk ikke tilgang til mikrofonen.");
      return;
    }

    setIsListening(true);
    setAnalysisMessage("Opptak pågår. Trykk Stopp opptak for å transkribere.");
  };

  const toggleNarration = () => {
    if (stage.id === "reference") {
      playSelectedSentence();
      return;
    }
    if (isAudioPlaying) {
      stopAudio();
      return;
    }
    speak();
  };

  shortcutActionsRef.current = {
    toggleListening,
    toggleNarration,
    canRecord: stage.id !== "feedback" && !isTranscribing
  };

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat) return;
      if (isEditableShortcutTarget(event.target)) return;

      const key = event.key.toLowerCase();
      if (key === "p") {
        event.preventDefault();
        shortcutActionsRef.current.toggleNarration();
      }
      if (key === "s" && shortcutActionsRef.current.canRecord) {
        event.preventDefault();
        void shortcutActionsRef.current.toggleListening();
      }
    };

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  const playUserRecording = () => {
    if (!userRecordingUrl) return;
    if (isUserPlaybackPlaying) {
      userAudioRef.current?.pause();
      setIsUserPlaybackPlaying(false);
      return;
    }
    userAudioRef.current?.pause();
    const audio = new Audio(userRecordingUrl);
    userAudioRef.current = audio;
    audio.onended = () => setIsUserPlaybackPlaying(false);
    audio.onpause = () => setIsUserPlaybackPlaying(false);
    audio.onplay = () => setIsUserPlaybackPlaying(true);
    void audio.play();
  };

  const clearUserRecording = () => {
    userAudioRef.current?.pause();
    setIsUserPlaybackPlaying(false);
    if (userRecordingUrlRef.current) URL.revokeObjectURL(userRecordingUrlRef.current);
    userRecordingUrlRef.current = null;
    setUserRecordingUrl("");
  };

  async function runCoachAnalysis(transcriptText: string) {
    if (stage.id === "feedback") return;
    setIsLoading(true);
    setAnalysisMessage("");
    try {
      const response = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: stage.id === "reference" ? "shadowing" : stage.id,
          transcript: transcriptText,
          prompt: stage.id === "reference" ? selectedAudioSegment.text : prompt,
          profile
        })
      });
      if (!response.ok) throw new Error(await response.text());
      const result = (await response.json()) as CoachFeedback;
      setFeedback(result);
      setProfile(result.profile);
      setAnalysisMessage("Analyse klar. Se fokusområder og coach-feedback under.");
    } catch {
      setAnalysisMessage("Kunne ikke kjøre analysen akkurat nå.");
    } finally {
      setIsLoading(false);
    }
  }

  const analyze = async () => {
    if (stage.id === "feedback") return;
    if (isTranscribing) {
      setAnalysisMessage("Venter på Google-transkripsjonen før analyse.");
      return;
    }
    if (!transcript.trim()) {
      setAnalysisMessage("Start tale først, vent på transkripsjonen, eller skriv/lim inn tekst manuelt.");
      return;
    }
    setIsLoading(true);
    setAnalysisMessage("");
    try {
      const response = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: stage.id === "reference" ? "shadowing" : stage.id,
          transcript,
          prompt: stage.id === "reference" ? selectedAudioSegment.text : prompt,
          profile
        })
      });
      if (!response.ok) throw new Error(await response.text());
      const result = (await response.json()) as CoachFeedback;
      setFeedback(result);
      setProfile(result.profile);
      setAnalysisMessage("Analyse klar. Se fokusområder og coach-feedback under.");
    } catch {
      setAnalysisMessage("Kunne ikke kjøre analysen akkurat nå.");
    } finally {
      setIsLoading(false);
    }
  };

  const nextStage = () => {
    if (stageIndex === stages.length - 1) return;
    setStageIndex((current) => current + 1);
    setTranscript("");
    setFeedback(null);
    setAnalysisMessage("");
    clearUserRecording();
    stopAudio();
    stopStudentPitch();
  };

  const finishSession = () => {
    const finalScores = feedback?.scores ?? activeScores;
    const entry: SessionEntry = {
      date: todayKey(),
      minutes: 20,
      scores: finalScores.pronunciation ? finalScores : { pronunciation: 72, rhythm: 70, fluency: 73 },
      focus: feedback?.focus ?? "Fokuser på jevn flyt og norsk setningsmelodi."
    };
    setEntries((current) => [...current.filter((item) => item.date !== entry.date), entry]);
    setStageIndex(0);
    setTranscript("");
    setFeedback(null);
    setAnalysisMessage("");
    clearUserRecording();
  };

  const strengths = profile.strengths.length ? profile.strengths : ["God vilje til å holde samtalen på norsk", "Du svarer tydelig og konsist", "Tydelig artikulasjon"];
  const patterns = profile.common_patterns.length ? profile.common_patterns : ["litt hakkete rytme"];
  const issues = profile.pronunciation_issues.length ? profile.pronunciation_issues : ["norske vokaler og konsonantgrupper"];
  const transcriptWordCount = selectedAudioSegment.text.split(/\s+/).filter(Boolean).length;
  const timedWordCount = selectedAudioSegment.tokens?.filter((token) => token.type === "word").length ?? 0;
  const hasTimingRisk = timedWordCount > 0 && Math.abs(transcriptWordCount - timedWordCount) > 2;
  const originalReferenceWordCount = (selectedAudioSegment.originalText ?? selectedAudioSegment.text).split(/\s+/).filter(Boolean).length;
  const draftReferenceWordCount = referenceTextDraft.split(/\s+/).filter(Boolean).length;
  const isDraftSuspiciouslyShort =
    originalReferenceWordCount >= 8 && draftReferenceWordCount < Math.ceil(originalReferenceWordCount * 0.7);

  return (
    <main>
      <div className="appFrame">
        <header className="topBar">
          <div className="brandLockup">
            <span className="logoMark">N</span>
            <strong>Norsk Coach</strong>
          </div>
          <span className="dailyPill">• 20 min daglig</span>
        </header>

        <section className="hero">
          <div>
            <p className="eyebrow">Personlig taletrener</p>
            <h1>Snakk norsk med bedre <em>rytme</em>, flyt og trygghet.</h1>
            <p className="lead">
              Start med en naturlig norsk referansetekst, se melodien i lydkurven, og øv deg fra helhet til setning til egen tale.
            </p>
          </div>
          <div className="focusCard">
            <span>Dagens fokus</span>
            <strong>{issues[0]}</strong>
            <p>• {patterns[0]}</p>
          </div>
        </section>

        <section className="studyShell">
        <aside className="leftRail">
        <nav className="stageRail" aria-label="Øktstruktur">
          {stages.map((item, index) => (
            <button
              className={index === stageIndex ? "stageStep active" : "stageStep"}
              key={item.id}
              onClick={() => setStageIndex(index)}
            >
              <span>{String(index + 1).padStart(2, "0")} &nbsp;{item.minutes} min</span>
              <strong>{item.title}</strong>
            </button>
          ))}
        </nav>

        <section className="metricsGrid">
          <MetricCard label="Minutter" value={totalMinutes} />
          <MetricCard label="Dager på rad" value={streak(entries)} />
        </section>

        {stage.id === "reference" && (
          <div className="segmentLibrary railLibrary">
            <div className="libraryFilters">
              <label>
                Spor
                <select value={trackFilter} onChange={(event) => setTrackFilter(event.target.value)}>
                  <option value="all">Alle spor</option>
                  {trackOptions.map((track) => (
                    <option key={track} value={track}>
                      {track.replace(".mp3", "")}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Søk
                <input
                  value={segmentQuery}
                  onChange={(event) => setSegmentQuery(event.target.value)}
                  placeholder="Søk i tekst eller spor"
                />
              </label>
            </div>
            <div className="segmentList">
              {filteredLibrarySegments.slice(0, 60).map((segment) => (
                <button
                  className={segment.id === selectedAudioSegment.id ? "librarySegment active" : "librarySegment"}
                  key={segment.id}
                  onClick={() => setSelectedAudioSegmentId(segment.id)}
                >
                  <span>{segment.source.replace(".mp3", "")} · {segment.duration.toFixed(1)}s</span>
                  <strong>{truncateSentence(segment.text)}</strong>
                </button>
              ))}
            </div>
          </div>
        )}
        </aside>

        <section className="workspace">
          <div className="analysisColumn">
            {stage.id === "reference" ? (
              <>
              <AudioStudyPanel
                currentTime={selectedSentenceTime}
                duration={selectedSentenceDuration}
                activeSentence={selectedSegment.sentence}
                timelineTokens={selectedAudioSegment.tokens ?? []}
                transcript={transcript}
                sentenceIndex={selectedSentence}
                nativeAnalysis={nativeAnalysis}
                analysisStart={selectedSegment.start}
                analysisEnd={selectedSegment.end}
                analysisEngine={analysisEngine}
                isAnalyzingAudio={isAnalyzingAudio}
                studentPitch={studentPitch}
                isStudentListening={isStudentListening}
                isPlaying={isAudioPlaying}
                onPause={pauseReferenceAudio}
                onScrub={scrubReference}
                onPlayToggle={playSelectedSentence}
                onToggleStudent={() => void toggleStudentPitch()}
              />
              <div className="sentencePractice listenSentencePractice">
                <h3>{activeReferenceSegments.length > 1 ? "Øv setning for setning" : "Øv valgt segment"}</h3>
                {activeReferenceSegments.map((segment, index) => (
                  <button
                    className={index === selectedSentence ? "sentence active" : "sentence"}
                    key={segment.sentence}
                    onClick={() => {
                      stopAudio();
                      stopStudentPitch();
                      setSelectedSentence(index);
                      setReferenceTime(segment.start);
                      setStudentPitch([]);
                      void playReferenceAudio(selectedAudioSegment.audio, segment.start, true);
                    }}
                  >
                    <span>{index + 1}</span>
                    {truncateSentence(segment.sentence)}
                  </button>
                ))}
              </div>
                          </>
            ) : (
              <div className="promptBox">
                <p className="microLabel">Coach sier</p>
                <h2>{prompt}</h2>
                {stage.id !== "feedback" && (
                  <div className="practiceInput inlinePractice">
                    <div className="practiceActions">
                      <button className={isListening ? "recording primary" : "primary"} onClick={toggleListening} disabled={isTranscribing}>
                        {isListening ? "Stopp opptak" : isTranscribing ? "Transkriberer..." : "Start tale"}
                      </button>
                      <button className="ghostButton" onClick={analyze} disabled={isLoading || isTranscribing}>
                        {isLoading ? "Analyserer..." : "Analyser"}
                      </button>
                      <button className="ghostButton" onClick={playUserRecording} disabled={!userRecordingUrl}>
                        {isUserPlaybackPlaying ? "Pause mitt opptak" : "Spill mitt opptak"}
                      </button>
                    </div>
                    <textarea
                      aria-label="Transkripsjon"
                      value={transcript}
                      onChange={(event) => setTranscript(event.target.value)}
                      placeholder="Google-transkripsjonen vises her etter opptak. Du kan rette tekst manuelt før analyse."
                      rows={4}
                    />
                    {analysisMessage && <p className="analysisMessage">{analysisMessage}</p>}
                  </div>
                )}
              </div>
            )}
          </div>

          <aside className="referenceColumn">
            <div className="playControls">
              {stage.id === "reference" ? (
                <span className="libraryCount">{filteredLibrarySegments.length} segmenter</span>
              ) : (
                <label>
                  Norsk stemme
                  <select value={selectedVoice} onChange={(event) => setSelectedVoice(event.target.value)}>
                    {voices.map((voice) => (
                      <option key={voice.name} value={voice.name}>
                        {voice.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {stage.id !== "reference" && (
                <button className="playButton" onClick={speak} disabled={isSpeechLoading}>
                  {isSpeechLoading ? "Henter lyd..." : isAudioPlaying ? "Pause" : "Spill av"}
                </button>
              )}
            </div>

            {stage.id === "reference" ? (
              <>
                <div className="segmentLibrary">
                  <div className="libraryFilters">
                    <label>
                      Spor
                      <select value={trackFilter} onChange={(event) => setTrackFilter(event.target.value)}>
                        <option value="all">Alle spor</option>
                        {trackOptions.map((track) => (
                          <option key={track} value={track}>
                            {track.replace(".mp3", "")}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Søk
                      <input
                        value={segmentQuery}
                        onChange={(event) => setSegmentQuery(event.target.value)}
                        placeholder="Søk i tekst eller spor"
                      />
                    </label>
                  </div>
                  <div className="segmentList">
                    {filteredLibrarySegments.slice(0, 60).map((segment) => (
                      <button
                        className={segment.id === selectedAudioSegment.id ? "librarySegment active" : "librarySegment"}
                        key={segment.id}
                        onClick={() => setSelectedAudioSegmentId(segment.id)}
                      >
                        <span>{segment.source.replace(".mp3", "")} · {segment.duration.toFixed(1)}s</span>
                        <strong>{truncateSentence(segment.text)}</strong>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="referenceText">
                  <div className="referenceTextHeader">
                    <p className="microLabel">
                      Referansetekst · {selectedAudioSegment.id}
                      {selectedAudioSegment.hasTextCorrection ? " · korrigert" : ""}
                    </p>
                    <div className="transcriptActions">
                      {isEditingReferenceText ? (
                        <>
                          <button className="tinyButton primaryTiny" onClick={saveReferenceText} disabled={isSavingReferenceText || isDraftSuspiciouslyShort}>
                            {isSavingReferenceText ? "Lagrer..." : "Lagre"}
                          </button>
                          <button
                            className="tinyButton"
                            onClick={() => {
                              setReferenceTextDraft(selectedAudioSegment.text);
                              setIsEditingReferenceText(false);
                            }}
                            disabled={isSavingReferenceText}
                          >
                            Avbryt
                          </button>
                        </>
                      ) : (
                        <>
                          <button className="tinyButton" onClick={() => setIsEditingReferenceText(true)}>
                            Rediger
                          </button>
                          <button className="tinyButton" onClick={resetReferenceText} disabled={!selectedAudioSegment.hasTextCorrection || isSavingReferenceText}>
                            Nullstill
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {isEditingReferenceText ? (
                    <>
                      <textarea
                        className="transcriptEditor"
                        value={referenceTextDraft}
                        onChange={(event) => setReferenceTextDraft(event.target.value)}
                        rows={7}
                      />
                      <p className="editorHint">
                        Endre tekst og tegnsetting. Store ordendringer kan gjøre tidsmarkering mindre presis til vi kjører ny justering.
                      </p>
                      {isDraftSuspiciouslyShort && (
                        <p className="timingWarning">
                          Utkastet har bare {draftReferenceWordCount} av ca. {originalReferenceWordCount} ord. Lagre er blokkert for Ã¥ unngÃ¥ Ã¥ erstatte hele teksten med et utdrag.
                        </p>
                      )}
                      {referenceTextError && <p className="timingWarning">{referenceTextError}</p>}
                    </>
                  ) : (
                    <p>
                      {activeReferenceSegments.map((segment, index) => (
                        <span className={index === selectedSentence ? "highlightSentence" : ""} key={segment.sentence}>
                          {segment.sentence}{" "}
                        </span>
                      ))}
                    </p>
                  )}
                  {hasTimingRisk && (
                    <p className="timingWarning">
                      Teksten har {transcriptWordCount} ord, men tidslinjen har {timedWordCount}. Hopp over scoring på dette klippet eller kjør ny justering.
                    </p>
                  )}
                </div>
                <div className="practiceInput">
                  <div className="practiceActions">
                    <button className={isListening ? "recording primary" : "primary"} onClick={toggleListening} disabled={isTranscribing}>
                      {isListening ? "Stopp opptak" : isTranscribing ? "Transkriberer..." : "Start tale"}
                    </button>
                    <button className="ghostButton" onClick={analyze} disabled={isLoading || isTranscribing}>
                      {isLoading ? "Analyserer..." : "Analyser"}
                    </button>
                    <button className="ghostButton" onClick={playUserRecording} disabled={!userRecordingUrl}>
                      {isUserPlaybackPlaying ? "Pause mitt opptak" : "Spill mitt opptak"}
                    </button>
                  </div>
                  <textarea
                    aria-label="Transkripsjon"
                    value={transcript}
                    onChange={(event) => setTranscript(event.target.value)}
                    placeholder="Google-transkripsjonen vises her etter opptak. Du kan rette tekst manuelt før analyse."
                    rows={4}
                  />
                  {analysisMessage && <p className="analysisMessage">{analysisMessage}</p>}
                </div>
                <ExerciseAnalysisPanel
                  activeSentence={selectedSegment.sentence}
                  transcript={transcript}
                  feedback={feedback}
                  studentPitch={studentPitch}
                />
                <div className="sentencePractice">
                  <h3>{activeReferenceSegments.length > 1 ? "Øv setning for setning" : "Øv valgt segment"}</h3>
                  {activeReferenceSegments.map((segment, index) => (
                    <button
                      className={index === selectedSentence ? "sentence active" : "sentence"}
                      key={segment.sentence}
                      onClick={() => {
                        stopAudio();
                        stopStudentPitch();
                      setSelectedSentence(index);
                      setReferenceTime(segment.start);
                      setStudentPitch([]);
                      void playReferenceAudio(selectedAudioSegment.audio, segment.start, true);
                    }}
                  >
                      <span>{index + 1}</span>
                      {truncateSentence(segment.sentence)}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="referenceText">
                <p className="microLabel">Øvelse</p>
                <p>{stage.id === "feedback" ? "Dagens oppsummering er klar. Lagre økten, og kom tilbake i morgen med ett tydelig fokus." : prompt}</p>
              </div>
            )}
          </aside>
        </section>
        </section>

        <section className="coachSummaryBar">
          <button className="ghostButton" onClick={() => setShowCoachSummary((current) => !current)}>
            {showCoachSummary ? "Skjul coach-oppsummering" : "Vis coach-oppsummering"}
          </button>
          <span>Langsiktig profil, mønstre og bredere veiledning.</span>
        </section>

        {showCoachSummary && (
          <>
            <section className="coachScoreGrid">
              <ScoreCard label="Uttale" value={activeScores.pronunciation} />
              <ScoreCard label="Rytme" value={activeScores.rhythm} />
              <ScoreCard label="Flyt" value={activeScores.fluency} />
            </section>
            <section className="profileGrid">
          <div>
            <h3>Styrker</h3>
            {strengths.slice(0, 3).map((item) => (
              <p className="checkLine" key={item}>✓ {item}</p>
            ))}
          </div>
          <div>
            <h3>Mønstre</h3>
            {patterns.slice(0, 3).map((item) => (
              <p className="warnLine" key={item}>• {item}</p>
            ))}
          </div>
          <div>
            <h3>Øv på</h3>
            <span className="issueChip">{issues[0]}</span>
          </div>
        </section>

        {feedback && (
          <section className="feedbackGrid">
            <div>
              <h3>Styrker fra analysen</h3>
              {feedback.strengths.map((item) => (
                <p key={item}>{item}</p>
              ))}
            </div>
            <div>
              <h3>Forbedre</h3>
              {feedback.improvements.map((item) => (
                <p key={item}>{item}</p>
              ))}
            </div>
          </section>
        )}
        <section className="coachVowelSummary">
          <div className="vowelChart good">
            <div>
              <p className="microLabel">Eksperimentell formantguide · F1/F2</p>
              <h3>Vokalplassering</h3>
              <p>Dette er bred veiledningskontekst til vi henter ekte formanter fra opptaket ditt.</p>
            </div>
            <div className="vowelGrid" aria-label="Forenklet vokalkart">
              {["i", "y", "u", "e", "Ã¸", "o", "Ã¦", "a", "Ã¥"].map((vowel, index) => (
                <span className="vowelTarget" key={vowel} style={{ left: `${18 + (index % 3) * 32}%`, top: `${18 + Math.floor(index / 3) * 30}%` }}>
                  {vowel}
                </span>
              ))}
              <span className="vowelDot" style={{ left: "55%", top: "60%" }} />
            </div>
          </div>
        </section>
          </>
        )}

        <footer className="bottomBar">
          <span className="bottomHint">
            {stage.id === "feedback"
              ? "Dagens oppsummering er klar."
              : "Opptak og STT ligger rett under teksten du øver på."}
          </span>
          {stageIndex < stages.length - 1 ? (
            <button className="nextButton" onClick={nextStage}>
              Neste øvelse →
            </button>
          ) : (
            <button className="nextButton" onClick={finishSession}>
              Lagre dagens økt
            </button>
          )}
        </footer>
      </div>
    </main>
  );
}
