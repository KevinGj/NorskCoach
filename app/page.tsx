"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

type SpeechRecognitionConstructor = new () => SpeechRecognition;

type SpeechRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionEvent = {
  results: {
    length: number;
    [index: number]: {
      [index: number]: {
        transcript: string;
      };
    };
  };
};

type Segment = {
  sentence: string;
  start: number;
  end: number;
};

type AudioSegment = {
  id: string;
  source: string;
  audio: string;
  start: number;
  end: number;
  duration: number;
  utteranceCount: number;
  text: string;
};

type VoiceOption = {
  name: string;
  label: string;
};

type PitchPoint = number | null;

declare global {
  interface Window {
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
    SpeechRecognition?: SpeechRecognitionConstructor;
  }
}

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
  { id: "shadowing", title: "Shadowing", minutes: 5 },
  { id: "conversation", title: "Samtale", minutes: 5 },
  { id: "storytelling", title: "Fortelling", minutes: 3 },
  { id: "feedback", title: "Coaching", minutes: 2 }
];

const referenceParagraph =
  "Når jeg går ned mot havna tidlig om morgenen, merker jeg ofte hvordan byen våkner før menneskene gjør det. Det ligger et svakt lys over vannet, og lyden av en buss som bremser ved torget blander seg med måkeskrik og lave stemmer fra folk som skal på jobb. Jeg prøver å gå litt saktere akkurat der, fordi rytmen i stedet gjør noe med tankene mine. Først kommer de korte stegene over brosteinen, så en pause ved krysset, og deretter den lange, rolige bevegelsen langs kaia. Hvis været skifter, slik det ofte gjør her, må man nesten smile av hvor fort samtalen forandrer seg. Noen sier at regnet er tungt, andre sier at det bare renser lufta. For meg er det nettopp denne blandingen av praktisk hverdag og stille oppmerksomhet som gjør norsk språk så levende.";

const fallbackAudioSegment: AudioSegment = {
  id: "sample-reference",
  source: "Sample reference",
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

function makeSegmentsForAudio(segment: AudioSegment): Segment[] {
  const sentenceTexts = segment.text.match(/[^.!?]+[.!?]/g)?.map((sentence) => sentence.trim()) ?? [];
  if (sentenceTexts.length < 2) {
    return [{ sentence: segment.text, start: 0, end: segment.duration }];
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

function pointsToPolyline(points: PitchPoint[]) {
  return points
    .map((point, index) => {
      if (point === null) return "";
      return `${(index / Math.max(1, points.length - 1)) * 100},${point}`;
    })
    .filter(Boolean)
    .join(" ");
}

function detectPitch(buffer: Float32Array, sampleRate: number) {
  const rms = Math.sqrt(buffer.reduce((sum, sample) => sum + sample * sample, 0) / buffer.length);
  if (rms < 0.018) return null;

  let bestOffset = -1;
  let bestCorrelation = 0;
  const minOffset = Math.floor(sampleRate / 420);
  const maxOffset = Math.floor(sampleRate / 75);

  for (let offset = minOffset; offset <= maxOffset; offset += 1) {
    let correlation = 0;
    for (let index = 0; index < buffer.length - offset; index += 1) {
      correlation += buffer[index] * buffer[index + offset];
    }
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestOffset = offset;
    }
  }

  if (bestOffset < 0 || bestCorrelation < 0.01) return null;
  return sampleRate / bestOffset;
}

function normalizePitchToLane(pitch: number | null, samples: number[]) {
  if (!pitch) return null;
  const voiced = samples.length ? samples : [110, 220];
  const min = Math.min(...voiced);
  const max = Math.max(...voiced);
  const range = Math.max(1, max - min);
  return Math.max(18, Math.min(82, 82 - ((pitch - min) / range) * 64));
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

function AudioStudyPanel({
  currentTime,
  duration,
  activeSentence,
  sentenceIndex,
  studentPitch,
  isStudentListening,
  isPlaying,
  onScrub,
  onPlayToggle,
  onToggleStudent
}: {
  currentTime: number;
  duration: number;
  activeSentence: string;
  sentenceIndex: number;
  studentPitch: PitchPoint[];
  isStudentListening: boolean;
  isPlaying: boolean;
  onScrub: (time: number) => void;
  onPlayToggle: () => void;
  onToggleStudent: () => void;
}) {
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const playheadPercent = Math.min(100, Math.max(0, (currentTime / duration) * 100));
  const columns = Array.from({ length: 108 }, (_, index) => {
    const progress = index / 107;
    const phrasePulse = Math.sin(progress * Math.PI * 9) * 0.5 + 0.5;
    const wordPulse = Math.sin(progress * Math.PI * 42) * 0.5 + 0.5;
    return 18 + phrasePulse * 34 + wordPulse * 24 + (index % 15 === 0 ? 15 : 0);
  });
  const spectralColumns = Array.from({ length: 82 }, (_, timeIndex) =>
    Array.from({ length: 9 }, (_, freqIndex) => {
      const time = timeIndex / 81;
      const freq = freqIndex / 8;
      const slope = 0.2 + time * 0.38 + Math.sin(time * Math.PI * 3) * 0.08;
      const formant = Math.abs(freq - slope) < 0.12 || Math.abs(freq - (slope + 0.22)) < 0.08;
      return formant && Math.sin(time * Math.PI * 18) > -0.75;
    })
  );
  const nativePolyline = pointsToPolyline(makeNativePitch(sentenceIndex));
  const studentPolyline = pointsToPolyline(studentPitch);
  const voicedStudent = studentPitch.filter((point): point is number => point !== null);
  const latestStudent = voicedStudent.at(-1);
  const vowelX = latestStudent ? Math.max(15, Math.min(85, 100 - latestStudent)) : 55;
  const vowelY = latestStudent ? Math.max(18, Math.min(82, 36 + Math.sin(latestStudent / 11) * 24)) : 60;

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
        </div>
        <div className="analysisActions">
          <button className="ghostButton" onClick={onPlayToggle}>
            {isPlaying ? "Pause" : "▶ Spill setning"}
          </button>
          <button className={isStudentListening ? "recording ghostButton" : "ghostButton activeGhost"} onClick={onToggleStudent}>
            ● {isStudentListening ? "Stopp pitch" : "Mål min pitch"}
          </button>
        </div>
      </div>

      <div
        ref={timelineRef}
        className="analysisPanel"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          scrubFromPointer(event.clientX);
        }}
        onPointerMove={(event) => {
          if (event.buttons === 1) scrubFromPointer(event.clientX);
        }}
      >
        <div className="playhead" style={{ left: `${playheadPercent}%` }} />
        <div className="waveform" aria-label="Waveform for valgt setning">
          {columns.map((height, index) => (
            <span key={index} style={{ height: `${height}%` }} />
          ))}
        </div>
        <div className="pitchOverlay" aria-label="Pitch overlay">
          <span className="laneLabel">Native</span>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <polyline className="nativeLine" points={nativePolyline} />
            {studentPolyline && <polyline className="studentLine" points={studentPolyline} />}
          </svg>
          <span className="studentHint">Student · {studentPolyline ? "aktiv kontur" : "venter på opptak"}</span>
        </div>
        <div className="spectrogram" aria-label="Learner-friendly spectrogram">
          {spectralColumns.map((column, index) => (
            <div className="spectralColumn" key={index}>
              {column.map((active, freqIndex) => (
                <span className={active ? "hot" : ""} key={freqIndex} />
              ))}
            </div>
          ))}
        </div>
        <div className="timeReadout">
          <span>{currentTime.toFixed(1)}s</span>
          <span>{duration.toFixed(1)}s</span>
        </div>
      </div>

      <div className="activeSentence">
        <span>{sentenceIndex + 1}</span>
        <div>
          <p>Aktiv setning · {currentTime.toFixed(1)}-{duration.toFixed(1)}s</p>
          <strong>{activeSentence}</strong>
        </div>
      </div>

      <div className="vowelChart">
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
  const [selectedVoice, setSelectedVoice] = useState(voices[0].name);
  const [referenceTime, setReferenceTime] = useState(0);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [isSpeechLoading, setIsSpeechLoading] = useState(false);
  const [studentPitch, setStudentPitch] = useState<PitchPoint[]>([]);
  const [isStudentListening, setIsStudentListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [feedback, setFeedback] = useState<CoachFeedback | null>(null);
  const [profile, setProfile] = useState<LearnerProfile>(emptyProfile);
  const [entries, setEntries] = useState<SessionEntry[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const micContextRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micIntervalRef = useRef<number | null>(null);
  const playbackOffsetRef = useRef(0);

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
  const activeReferenceSegments = makeSegmentsForAudio(selectedAudioSegment);
  const activeReferenceDuration = selectedAudioSegment.duration;
  const selectedSegment = activeReferenceSegments[selectedSentence] ?? activeReferenceSegments[0];
  const selectedSentenceDuration = selectedSegment.end - selectedSegment.start;
  const selectedSentenceTime = Math.min(selectedSentenceDuration, Math.max(0, referenceTime - selectedSegment.start));
  const segmentAtReferenceTime = (time: number) =>
    activeReferenceSegments.find((segment) => time >= segment.start && time <= segment.end) ?? activeReferenceSegments[0];
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
    fetch("/api/segments")
      .then((response) => response.json())
      .then((segments: AudioSegment[]) => {
        if (!segments.length) return;
        setAudioSegments(segments);
        setSelectedAudioSegmentId((current) =>
          current === fallbackAudioSegment.id || !segments.some((segment) => segment.id === current)
            ? segments[0].id
            : current
        );
      })
      .catch(() => setAudioSegments([]));
  }, []);

  useEffect(() => {
    localStorage.setItem("norsk-coach-profile", JSON.stringify(profile));
  }, [profile]);

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
    setSelectedSentence(0);
    setReferenceTime(0);
    setStudentPitch([]);
    stopAudio();
    stopStudentPitch();
  }, [selectedAudioSegmentId]);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      micStreamRef.current?.getTracks().forEach((track) => track.stop());
      if (micIntervalRef.current) window.clearInterval(micIntervalRef.current);
      void micContextRef.current?.close();
    };
  }, []);

  const stopAudio = () => {
    audioRef.current?.pause();
    window.speechSynthesis?.cancel();
    setIsAudioPlaying(false);
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

  const playReferenceAudio = async (url: string, offset = 0, trackReference = true) => {
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
      audio.currentTime = offset;
      audio.onplay = () => setIsAudioPlaying(true);
      audio.onpause = () => setIsAudioPlaying(false);
      audio.onended = () => setIsAudioPlaying(false);
      audio.ontimeupdate = () => {
        if (trackReference) {
          const nextTime = Math.min(activeReferenceDuration, audio.currentTime);
          setReferenceTime(nextTime);
          const segment = segmentAtReferenceTime(nextTime);
          setSelectedSentence(Math.max(0, activeReferenceSegments.indexOf(segment)));
        }
      };
      await audio.play();
    } finally {
      setIsSpeechLoading(false);
    }
  };

  const playFullReference = () => {
    if (isAudioPlaying) {
      stopAudio();
      return;
    }
    setSelectedSentence(0);
    setReferenceTime(0);
    void playReferenceAudio(selectedAudioSegment.audio, 0, true);
  };

  const playSelectedSentence = () => {
    if (isAudioPlaying) {
      stopAudio();
      return;
    }
    setReferenceTime(selectedSegment.start);
    setStudentPitch([]);
    void playReferenceAudio(selectedAudioSegment.audio, selectedSegment.start, true);
  };

  const scrubReference = (time: number) => {
    const globalTime = selectedSegment.start + Math.min(selectedSentenceDuration, Math.max(0, time));
    setReferenceTime(globalTime);
    playbackOffsetRef.current = globalTime;
    if (isAudioPlaying) {
      void playReferenceAudio(selectedAudioSegment.audio, globalTime, true);
    }
  };

  const speak = () => {
    if (stage.id === "reference") {
      playFullReference();
      return;
    }
    void playGoogleSpeech(prompt, stage.id === "shadowing" ? 0.9 : 0.96);
  };

  const toggleListening = () => {
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) {
      setTranscript((current) => current || "Nettleseren din støtter ikke talegjenkjenning. Skriv svaret ditt her.");
      return;
    }

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const recognition = new Recognition();
    recognition.lang = "nb-NO";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let text = "";
      for (let index = 0; index < event.results.length; index += 1) {
        text += event.results[index][0].transcript;
      }
      setTranscript(text.trim());
    };
    recognition.onend = () => setIsListening(false);
    recognitionRef.current = recognition;
    setIsListening(true);
    recognition.start();
  };

  const analyze = async () => {
    if (stage.id === "feedback") return;
    setIsLoading(true);
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
    const result = (await response.json()) as CoachFeedback;
    setFeedback(result);
    setProfile(result.profile);
    setIsLoading(false);
  };

  const nextStage = () => {
    if (stageIndex === stages.length - 1) return;
    setStageIndex((current) => current + 1);
    setTranscript("");
    setFeedback(null);
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
  };

  const strengths = profile.strengths.length ? profile.strengths : ["God vilje til å holde samtalen på norsk", "Du svarer tydelig og konsist", "Tydelig artikulasjon"];
  const patterns = profile.common_patterns.length ? profile.common_patterns : ["litt hakkete rytme"];
  const issues = profile.pronunciation_issues.length ? profile.pronunciation_issues : ["norske vokaler og konsonantgrupper"];

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
          <ScoreCard label="Uttale" value={activeScores.pronunciation} />
          <ScoreCard label="Rytme" value={activeScores.rhythm} />
          <ScoreCard label="Flyt" value={activeScores.fluency} />
        </section>

        <section className="workspace">
          <div className="analysisColumn">
            {stage.id === "reference" ? (
              <AudioStudyPanel
                currentTime={selectedSentenceTime}
                duration={selectedSentenceDuration}
                activeSentence={selectedSegment.sentence}
                sentenceIndex={selectedSentence}
                studentPitch={studentPitch}
                isStudentListening={isStudentListening}
                isPlaying={isAudioPlaying}
                onScrub={scrubReference}
                onPlayToggle={playSelectedSentence}
                onToggleStudent={() => void toggleStudentPitch()}
              />
            ) : (
              <div className="promptBox">
                <p className="microLabel">Coach sier</p>
                <h2>{prompt}</h2>
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
              <button className="playButton" onClick={speak} disabled={isSpeechLoading}>
                {isSpeechLoading ? "Henter lyd..." : isAudioPlaying ? "Pause" : "▶ Spill av"}
              </button>
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
                  <p className="microLabel">Referansetekst · {selectedAudioSegment.id}</p>
                  <p>
                    {activeReferenceSegments.map((segment, index) => (
                      <span className={index === selectedSentence ? "highlightSentence" : ""} key={segment.sentence}>
                        {segment.sentence}{" "}
                      </span>
                    ))}
                  </p>
                </div>
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

        <footer className="bottomBar">
          {stage.id !== "feedback" ? (
            <>
              <button className={isListening ? "recording primary" : "primary"} onClick={toggleListening}>
                ● {isListening ? "Stopp opptak" : "Start tale"}
              </button>
              <button className="ghostButton" onClick={analyze} disabled={isLoading}>
                {isLoading ? "Analyserer..." : "Analyser"}
              </button>
              <input
                aria-label="Transkripsjon"
                value={transcript}
                onChange={(event) => setTranscript(event.target.value)}
                placeholder={
                  stage.id === "reference"
                    ? "Etter lytting: les hele referanseteksten med egen stemme. Transkripsjonen vises her."
                    : "Transkripsjonen vises her. Du kan også skrive manuelt under testing."
                }
              />
            </>
          ) : (
            <span className="bottomHint">Dagens oppsummering er klar.</span>
          )}
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
