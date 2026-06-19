"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CoachFeedback, ExerciseType, LearnerProfile, Scores } from "@/lib/coach";

type SessionStage = {
  id: ExerciseType | "feedback";
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

declare global {
  interface Window {
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
    SpeechRecognition?: SpeechRecognitionConstructor;
  }
}

const stages: SessionStage[] = [
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

export default function Home() {
  const [stageIndex, setStageIndex] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [feedback, setFeedback] = useState<CoachFeedback | null>(null);
  const [profile, setProfile] = useState<LearnerProfile>(emptyProfile);
  const [entries, setEntries] = useState<SessionEntry[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  const stage = stages[stageIndex];
  const prompt = useMemo(() => {
    if (stage.id === "shadowing") return shadowingLines[stageIndex % shadowingLines.length];
    if (stage.id === "conversation") return conversationPrompts[entries.length % conversationPrompts.length];
    if (stage.id === "storytelling") return storytellingPrompts[entries.length % storytellingPrompts.length];
    return feedback?.focus ?? "Fullfør økten for å få coaching.";
  }, [entries.length, feedback?.focus, stage.id, stageIndex]);
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

  const speak = () => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(prompt);
    utterance.lang = "nb-NO";
    utterance.rate = stage.id === "shadowing" ? 0.88 : 0.95;
    window.speechSynthesis.speak(utterance);
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
      body: JSON.stringify({ type: stage.id, transcript, prompt, profile })
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
  };

  const finishSession = () => {
    const finalScores = feedback?.scores ?? activeScores;
    const entry: SessionEntry = {
      date: todayKey(),
      minutes: 15,
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
          <span className="pill">15 min daglig</span>
        </nav>
        <div className="heroGrid">
          <div>
            <p className="eyebrow">Personlig tale trener</p>
            <h1>Snakk norsk med bedre rytme, flyt og trygghet.</h1>
            <p className="lead">
              En rolig økt for viderekomne: shadowing, naturlig samtale, fortelling og konkret coaching.
            </p>
          </div>
          <div className="coachPanel">
            <span>Dagens fokus</span>
            <strong>{profile.pronunciation_issues[0] ?? "Norsk setningsmelodi"}</strong>
            <p>{profile.common_patterns[0] ?? "Bygg flyt gjennom korte, gjentatte taleøkter."}</p>
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
              Spill av
            </button>
          </div>

          <div className="promptBox">
            <span>Coach sier</span>
            <p>{prompt}</p>
          </div>

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
                placeholder="Transkripsjonen vises her. Du kan også skrive manuelt under testing."
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
