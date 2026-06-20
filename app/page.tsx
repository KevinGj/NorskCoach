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

declare global {
  interface Window {
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
    SpeechRecognition?: SpeechRecognitionConstructor;
  }
}

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
  isPlaying,
  onScrub,
  onPlayToggle
}: {
  currentTime: number;
  duration: number;
  activeSentence: string;
  isPlaying: boolean;
  onScrub: (time: number) => void;
  onPlayToggle: () => void;
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
  const pitchPoints = Array.from({ length: 32 }, (_, index) => {
    const x = (index / 31) * 100;
    const y = 54 - Math.sin(index * 0.72) * 18 - Math.sin(index * 0.21) * 9;
    return `${x},${Math.max(18, Math.min(78, y))}`;
  }).join(" ");

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
          <h3>Referansevisualisering</h3>
        </div>
        <button className="secondary" onClick={onPlayToggle}>
          {isPlaying ? "Pause" : "Spill av"}
        </button>
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
        <div className="waveform" aria-label="Waveform">
          {columns.map((height, index) => (
            <span key={index} style={{ height: `${height}%` }} />
          ))}
        </div>
        <div className="spectrogram" aria-label="Spectrogram">
          {spectralColumns.map((column, index) => (
            <div className="spectralColumn" key={index}>
              {column.map((active, freqIndex) => (
                <span className={active ? "hot" : ""} key={freqIndex} />
              ))}
            </div>
          ))}
          <svg className="pitchTrack" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <polyline points={pitchPoints} />
          </svg>
        </div>
      </div>

      <div className="timeReadout">
        <span>{currentTime.toFixed(1)}s</span>
        <span>{duration.toFixed(1)}s</span>
      </div>
      <p className="activeSentence">{activeSentence}</p>
    </div>
  );
}

export default function Home() {
  const [stageIndex, setStageIndex] = useState(0);
  const [selectedSentence, setSelectedSentence] = useState(0);
  const [referenceTime, setReferenceTime] = useState(0);
  const [isReferencePlaying, setIsReferencePlaying] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [feedback, setFeedback] = useState<CoachFeedback | null>(null);
  const [profile, setProfile] = useState<LearnerProfile>(emptyProfile);
  const [entries, setEntries] = useState<SessionEntry[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const playbackStartRef = useRef(0);
  const playbackOffsetRef = useRef(0);

  const stage = stages[stageIndex];
  const activeReferenceSegment = segmentAtTime(referenceTime);
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
    if (savedProfile) setProfile(JSON.parse(savedProfile) as LearnerProfile);
    if (savedEntries) setEntries(JSON.parse(savedEntries) as SessionEntry[]);
  }, []);

  useEffect(() => {
    localStorage.setItem("norsk-coach-profile", JSON.stringify(profile));
  }, [profile]);

  useEffect(() => {
    localStorage.setItem("norsk-coach-entries", JSON.stringify(entries));
  }, [entries]);

  useEffect(() => {
    if (!isReferencePlaying) return;
    const interval = window.setInterval(() => {
      const elapsed = (performance.now() - playbackStartRef.current) / 1000;
      const nextTime = playbackOffsetRef.current + elapsed;
      if (nextTime >= referenceDuration) {
        setReferenceTime(referenceDuration);
        setIsReferencePlaying(false);
        window.speechSynthesis?.cancel();
      } else {
        setReferenceTime(nextTime);
      }
    }, 50);
    return () => window.clearInterval(interval);
  }, [isReferencePlaying]);

  const speakText = (text: string, rate = 0.92, offset = 0) => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "nb-NO";
    utterance.rate = rate;
    utterance.onend = () => setIsReferencePlaying(false);
    window.speechSynthesis.speak(utterance);
    playbackOffsetRef.current = offset;
    playbackStartRef.current = performance.now();
  };

  const playReference = () => {
    if (isReferencePlaying) {
      window.speechSynthesis?.cancel();
      setIsReferencePlaying(false);
      playbackOffsetRef.current = referenceTime;
      return;
    }
    const segment = segmentAtTime(referenceTime);
    const startIndex = referenceSegments.indexOf(segment);
    const text = referenceSegments.slice(Math.max(0, startIndex)).map((item) => item.sentence).join(" ");
    setIsReferencePlaying(true);
    speakText(text, 0.9, segment.start);
  };

  const scrubReference = (time: number) => {
    setReferenceTime(time);
    playbackOffsetRef.current = time;
    const segment = segmentAtTime(time);
    setSelectedSentence(Math.max(0, referenceSegments.indexOf(segment)));
    if (isReferencePlaying) {
      speakText(referenceSegments.slice(referenceSegments.indexOf(segment)).map((item) => item.sentence).join(" "), 0.9, segment.start);
    }
  };

  const speak = () => {
    if (stage.id === "reference") {
      playReference();
      return;
    }
    speakText(prompt, stage.id === "shadowing" ? 0.88 : 0.95);
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
    window.speechSynthesis?.cancel();
    setIsReferencePlaying(false);
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
            <button className="secondary" onClick={speak}>
              {stage.id === "reference" && isReferencePlaying ? "Pause" : "Spill av"}
            </button>
          </div>

          {stage.id === "reference" ? (
            <>
              <div className="referenceText">
                <span>Referansetekst</span>
                <p>{referenceParagraph}</p>
              </div>
              <AudioStudyPanel
                currentTime={referenceTime}
                duration={referenceDuration}
                activeSentence={activeReferenceSegment.sentence}
                isPlaying={isReferencePlaying}
                onScrub={scrubReference}
                onPlayToggle={playReference}
              />
              <div className="sentencePractice">
                <h3>Øv setning for setning</h3>
                {referenceSegments.map((segment, index) => (
                  <button
                    className={index === selectedSentence ? "sentence active" : "sentence"}
                    key={segment.sentence}
                    onClick={() => {
                      setSelectedSentence(index);
                      setReferenceTime(segment.start);
                      speakText(segment.sentence, 0.88, segment.start);
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
