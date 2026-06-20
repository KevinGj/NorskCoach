"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CoachFeedback, ExerciseType, LearnerProfile, Scores } from "@/lib/coach";

type StageId = ExerciseType | "reference" | "feedback";

type SessionStage = {
  id: StageId;
  title: string;
  minutes: number;
  goal: string;
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
  {
    id: "reference",
    title: "Referanse",
    minutes: 5,
    goal: "Lytt til en lengre naturlig tekst, studer rytmen, og øv setning for setning."
  },
  {
    id: "shadowing",
    title: "Shadowing",
    minutes: 5,
    goal: "Imiter uttale, rytme og setningsmelodi."
  },
  {
    id: "conversation",
    title: "Samtale",
    minutes: 5,
    goal: "Svar spontant, kun på norsk."
  },
  {
    id: "storytelling",
    title: "Fortelling",
    minutes: 3,
    goal: "Snakk sammenhengende i ett til tre minutter."
  },
  {
    id: "feedback",
    title: "Coaching",
    minutes: 2,
    goal: "Få ett konkret fokusområde for i morgen."
  }
];

const referenceParagraph =
  "Når jeg går ned mot havna tidlig om morgenen, merker jeg ofte hvordan byen våkner før menneskene gjør det. Det ligger et svakt lys over vannet, og lyden av en buss som bremser ved torget blander seg med måkeskrik og lave stemmer fra folk som skal på jobb. Jeg prøver å gå litt saktere akkurat der, fordi rytmen i stedet gjør noe med tankene mine. Først kommer de korte stegene over brosteinen, så en pause ved krysset, og deretter den lange, rolige bevegelsen langs kaia. Hvis været skifter, slik det ofte gjør her, må man nesten smile av hvor fort samtalen forandrer seg. Noen sier at regnet er tungt, andre sier at det bare renser lufta. For meg er det nettopp denne blandingen av praktisk hverdag og stille oppmerksomhet som gjør norsk språk så levende.";

const referenceSentences = referenceParagraph.match(/[^.!?]+[.!?]/g) ?? [referenceParagraph];

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

const referenceSegments = makeSegments(referenceSentences);
const referenceDuration = Math.max(...referenceSegments.map((segment) => segment.end));

function segmentAtTime(time: number) {
  return referenceSegments.find((segment) => time >= segment.start && time <= segment.end) ?? referenceSegments[0];
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

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="scoreBar">
      <div className="scoreLabel">
        <span>{label}</span>
        <strong>{value || "--"}</strong>
      </div>
      <div className="track">
        <div className="fill" style={{ width: `${value}%` }} />
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
  const columns = Array.from({ length: 96 }, (_, index) => {
    const progress = index / 95;
    const phrasePulse = Math.sin(progress * Math.PI * 12) * 0.5 + 0.5;
    const wordPulse = Math.sin(progress * Math.PI * 42) * 0.5 + 0.5;
    return 24 + phrasePulse * 42 + wordPulse * 24 + (index % 17 === 0 ? 18 : 0);
  });
  const spectralColumns = Array.from({ length: 72 }, (_, timeIndex) =>
    Array.from({ length: 24 }, (_, freqIndex) => {
      const time = timeIndex / 71;
      const freq = freqIndex / 23;
      const pitch = 0.28 + Math.sin(time * Math.PI * 3.2) * 0.08 + Math.sin(time * Math.PI * 9) * 0.025;
      const harmonic = [pitch, pitch * 1.55, pitch * 2.15, pitch * 2.78].some((band) => Math.abs(freq - band) < 0.035);
      const formant = Math.abs(freq - 0.43) < 0.055 || Math.abs(freq - 0.68) < 0.045;
      const syllable = Math.sin(time * Math.PI * 24) > -0.45;
      return harmonic || (formant && syllable);
    })
  );
  const nativePitch = makeNativePitch(sentenceIndex);
  const nativePolyline = pointsToPolyline(nativePitch);
  const studentPolyline = pointsToPolyline(studentPitch);
  const voicedStudent = studentPitch.filter((point): point is number => point !== null);
  const latestStudent = voicedStudent.at(-1);
  const vowelX = latestStudent ? Math.max(12, Math.min(88, 100 - latestStudent)) : 50;
  const vowelY = latestStudent ? Math.max(14, Math.min(84, 28 + Math.sin(latestStudent / 11) * 22)) : 56;

  const scrubFromPointer = (clientX: number) => {
    const rect = timelineRef.current?.getBoundingClientRect();
    if (!rect) return;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    onScrub(ratio * duration);
  };

  return (
    <div className="audioStudy">
      <div className="audioStudyHeader">
        <div>
          <p className="eyebrow">Time, frequency, amplitude</p>
          <h3>Setningsanalyse</h3>
        </div>
        <div className="analysisActions">
          <button className="secondary" onClick={onPlayToggle}>
            {isPlaying ? "Pause" : "Spill setning"}
          </button>
          <button className={isStudentListening ? "recording" : "secondary"} onClick={onToggleStudent}>
            {isStudentListening ? "Stopp pitch" : "Mål min pitch"}
          </button>
        </div>
      </div>

      <div
        ref={timelineRef}
        className="linkedTimeline"
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
        <div className="pitchLane nativeLane" aria-label="Native pitch track">
          <span className="laneLabel">Native</span>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <polyline points={nativePolyline} />
          </svg>
        </div>
        <div className="pitchLane studentLane" aria-label="Student pitch track">
          <span className="laneLabel">Student</span>
          {studentPolyline ? (
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <polyline points={studentPolyline} />
            </svg>
          ) : (
            <p>Start pitch-måling og les setningen for å sammenligne melodien.</p>
          )}
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
      </div>

      <div className="timeReadout">
        <span>{currentTime.toFixed(1)}s</span>
        <span>{duration.toFixed(1)}s</span>
      </div>
      <p className="activeSentence">{activeSentence}</p>
      <div className="vowelChart">
        <div>
          <p className="eyebrow">Formant guide</p>
          <h3>Vokalplassering</h3>
          <p>En forenklet F1/F2-visning hjelper deg å sikte munnen mot norske vokaler.</p>
        </div>
        <div className="vowelGrid" aria-label="Forenklet vokalkart">
          {["i", "y", "u", "e", "ø", "o", "æ", "a", "å"].map((vowel, index) => (
            <span className="vowelTarget" key={vowel} style={{ left: `${18 + (index % 3) * 31}%`, top: `${18 + Math.floor(index / 3) * 30}%` }}>
              {vowel}
            </span>
          ))}
          <span className="vowelDot" style={{ left: `${vowelX}%`, top: `${vowelY}%` }} />
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const [stageIndex, setStageIndex] = useState(0);
  const [selectedSentence, setSelectedSentence] = useState(0);
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
  const selectedSegment = referenceSegments[selectedSentence] ?? referenceSegments[0];
  const selectedSentenceDuration = selectedSegment.end - selectedSegment.start;
  const selectedSentenceTime = Math.min(
    selectedSentenceDuration,
    Math.max(0, referenceTime - selectedSegment.start)
  );
  const prompt = useMemo(() => {
    if (stage.id === "reference") return referenceSegments[selectedSentence]?.sentence ?? referenceParagraph;
    if (stage.id === "shadowing") return shadowingLines[entries.length % shadowingLines.length];
    if (stage.id === "conversation") return conversationPrompts[entries.length % conversationPrompts.length];
    if (stage.id === "storytelling") return storytellingPrompts[entries.length % storytellingPrompts.length];
    return feedback?.focus ?? "Fullfør økten for å få coaching.";
  }, [entries.length, feedback?.focus, selectedSentence, stage.id]);
  const averages = averageScores(entries);
  const totalMinutes = entries.reduce((sum, entry) => sum + entry.minutes, 0);
  const activeScores = feedback?.scores ?? averages;

  useEffect(() => {
    const savedProfile = localStorage.getItem("norsk-coach-profile");
    const savedEntries = localStorage.getItem("norsk-coach-entries");
    const savedVoice = localStorage.getItem("norsk-coach-voice");
    if (savedProfile) setProfile(JSON.parse(savedProfile) as LearnerProfile);
    if (savedEntries) setEntries(JSON.parse(savedEntries) as SessionEntry[]);
    if (savedVoice && voices.some((voice) => voice.name === savedVoice)) setSelectedVoice(savedVoice);
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
      setStudentPitch((current) => {
        const normalized = normalizePitchToLane(pitch, voicedSamples);
        return [...current.slice(-90), normalized];
      });
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
        setReferenceTime(Math.min(referenceDuration, offset + (performance.now() - startedAt) / 1000));
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

      if (!response.ok) {
        throw new Error(await response.text());
      }

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
          const nextTime = Math.min(referenceDuration, playbackOffsetRef.current + audio.currentTime);
          setReferenceTime(nextTime);
          const segment = segmentAtTime(nextTime);
          setSelectedSentence(Math.max(0, referenceSegments.indexOf(segment)));
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

  const playFullReference = () => {
    if (isAudioPlaying) {
      stopAudio();
      return;
    }
    setSelectedSentence(0);
    setReferenceTime(0);
    void playGoogleSpeech(referenceParagraph, 0.92, 0, true);
  };

  const playSelectedSentence = () => {
    if (isAudioPlaying) {
      stopAudio();
      return;
    }
    setReferenceTime(selectedSegment.start);
    setStudentPitch([]);
    void playGoogleSpeech(selectedSegment.sentence, 0.9, selectedSegment.start, true);
  };

  const scrubReference = (time: number) => {
    const globalTime = selectedSegment.start + Math.min(selectedSentenceDuration, Math.max(0, time));
    setReferenceTime(globalTime);
    playbackOffsetRef.current = globalTime;
    if (isAudioPlaying) {
      void playGoogleSpeech(selectedSegment.sentence, 0.9, selectedSegment.start, true);
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
        prompt: stage.id === "reference" ? referenceParagraph : prompt,
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

  return (
    <main>
      <section className="hero">
        <nav>
          <span className="brand">Norsk Coach</span>
          <span className="pill">20 min daglig</span>
        </nav>
        <div className="heroGrid">
          <div>
            <p className="eyebrow">Personlig taletrener</p>
            <h1>Snakk norsk med bedre rytme, flyt og trygghet.</h1>
            <p className="lead">
              Start med en naturlig norsk referansetekst, se melodien i lydkurvene, og øv deg fra helhet til setning til egen tale.
            </p>
          </div>
          <div className="coachPanel">
            <span>Dagens fokus</span>
            <strong>{profile.pronunciation_issues[0] ?? "Norsk setningsmelodi"}</strong>
            <p>{profile.common_patterns[0] ?? "Bygg flyt gjennom lytting, isolert imitasjon og egen gjenfortelling."}</p>
          </div>
        </div>
      </section>

      <section className="appShell">
        <aside className="timeline" aria-label="Øktstruktur">
          {stages.map((item, index) => (
            <button
              className={index === stageIndex ? "step active" : "step"}
              key={item.id}
              onClick={() => setStageIndex(index)}
            >
              <span>{item.minutes} min</span>
              <strong>{item.title}</strong>
            </button>
          ))}
        </aside>

        <section className="practice">
          <div className="practiceHeader">
            <div>
              <p className="eyebrow">{stage.minutes} minutter</p>
              <h2>{stage.title}</h2>
              <p>{stage.goal}</p>
            </div>
            <div className="voiceControls">
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
              <button className="secondary" onClick={speak} disabled={isSpeechLoading}>
                {isSpeechLoading ? "Henter lyd..." : stage.id === "reference" && isAudioPlaying ? "Pause" : "Spill av"}
              </button>
            </div>
          </div>

          {stage.id === "reference" ? (
            <>
              <div className="referenceText">
                <span>Referansetekst</span>
                <p>{referenceParagraph}</p>
              </div>
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
              <div className="sentencePractice">
                <h3>Øv setning for setning</h3>
                {referenceSegments.map((segment, index) => (
                  <button
                    className={index === selectedSentence ? "sentence active" : "sentence"}
                    key={segment.sentence}
                    onClick={() => {
                      stopAudio();
                      stopStudentPitch();
                      setSelectedSentence(index);
                      setReferenceTime(segment.start);
                      setStudentPitch([]);
                      void playGoogleSpeech(segment.sentence, 0.88, segment.start, true);
                    }}
                  >
                    <span>{index + 1}</span>
                    {segment.sentence}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="promptBox">
              <span>Coach sier</span>
              <p>{prompt}</p>
            </div>
          )}

          {stage.id !== "feedback" ? (
            <>
              <div className="recorder">
                <button className={isListening ? "recording" : "primary"} onClick={toggleListening}>
                  {isListening ? "Stopp opptak" : "Start tale"}
                </button>
                <button className="secondary" onClick={analyze} disabled={isLoading}>
                  {isLoading ? "Analyserer..." : "Analyser"}
                </button>
              </div>
              <textarea
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
            <div className="finalPrompt">
              <strong>Dagens oppsummering er klar.</strong>
              <p>Se coachingkortet, lagre økten, og kom tilbake i morgen med ett tydelig fokus.</p>
            </div>
          )}

          {feedback && (
            <div className="feedbackGrid">
              <div>
                <h3>Styrker</h3>
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
            </div>
          )}

          <div className="actions">
            {stageIndex < stages.length - 1 ? (
              <button className="primary" onClick={nextStage}>
                Neste øvelse
              </button>
            ) : (
              <button className="primary" onClick={finishSession}>
                Lagre dagens økt
              </button>
            )}
          </div>
        </section>

        <aside className="dashboard">
          <h2>Fremgang</h2>
          <div className="stats">
            <div>
              <span>Minutter</span>
              <strong>{totalMinutes}</strong>
            </div>
            <div>
              <span>Dager på rad</span>
              <strong>{streak(entries)}</strong>
            </div>
          </div>
          <ScoreBar label="Uttale" value={activeScores.pronunciation} />
          <ScoreBar label="Rytme" value={activeScores.rhythm} />
          <ScoreBar label="Flyt" value={activeScores.fluency} />

          <div className="profile">
            <h3>Læringsprofil</h3>
            <p>
              <strong>Styrker:</strong> {profile.strengths.join(", ") || "samles etter første analyse"}
            </p>
            <p>
              <strong>Mønstre:</strong> {profile.common_patterns.join(", ") || "ingen mønstre ennå"}
            </p>
            <p>
              <strong>Øv på:</strong> {profile.pronunciation_issues.join(", ") || "norsk melodi"}
            </p>
          </div>
        </aside>
      </section>
    </main>
  );
}
