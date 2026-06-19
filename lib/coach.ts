export type ExerciseType = "shadowing" | "conversation" | "storytelling";

export type Scores = {
  pronunciation: number;
  rhythm: number;
  fluency: number;
};

export type CoachRequest = {
  type: ExerciseType;
  transcript: string;
  prompt: string;
  profile?: LearnerProfile;
};

export type LearnerProfile = {
  pronunciation_issues: string[];
  strengths: string[];
  common_patterns: string[];
};

export type CoachFeedback = {
  scores: Scores;
  strengths: string[];
  improvements: string[];
  focus: string;
  profile: LearnerProfile;
};

const norwegianMarkers = ["jeg", "du", "det", "ikke", "og", "på", "å", "er", "har", "skal", "kan"];
const helperVerbs = ["skal", "har", "kan", "vil", "må", "bør"];
const targetSounds = ["y", "u", "ø", "å", "kj", "skj", "rs"];

const clamp = (value: number) => Math.max(45, Math.min(98, Math.round(value)));

function unique(values: string[]) {
  return [...new Set(values)].slice(0, 5);
}

export function analyzeSpeech(request: CoachRequest): CoachFeedback {
  const transcript = request.transcript.trim();
  const lower = transcript.toLowerCase();
  const words = lower.split(/\s+/).filter(Boolean);
  const norwegianCount = norwegianMarkers.filter((marker) => lower.includes(marker)).length;
  const hasTargetSounds = targetSounds.filter((sound) => lower.includes(sound));
  const averageWordLength = words.length
    ? words.reduce((sum, word) => sum + word.length, 0) / words.length
    : 0;
  const helperVerbCount = helperVerbs.filter((verb) => words.includes(verb)).length;
  const punctuationPauses = (transcript.match(/[,.!?]/g) ?? []).length;

  const base = transcript ? 70 : 50;
  const pronunciation = clamp(base + hasTargetSounds.length * 3 + norwegianCount * 2 - Math.max(0, helperVerbCount - 1) * 2);
  const rhythm = clamp(base + punctuationPauses * 3 + (words.length > 8 ? 5 : -3) - (averageWordLength > 8 ? 4 : 0));
  const fluency = clamp(base + Math.min(words.length, 35) * 0.8 + norwegianCount * 2 - (words.length < 5 ? 8 : 0));

  const strengths = unique([
    norwegianCount >= 4 ? "Naturlig norsk setningsstruktur" : "God vilje til å holde samtalen på norsk",
    words.length >= 12 ? "Du bygger lengre ytringer" : "Du svarer tydelig og konsist",
    hasTargetSounds.length >= 2 ? "Flere norske lyder er med i talen" : "Tydelig artikulasjon"
  ]);

  const improvements = unique([
    helperVerbCount > 1 ? "La hjelpeverb som skal, har og kan få mindre trykk." : "Arbeid med mykere overgang mellom ordene.",
    punctuationPauses < 1 && words.length > 10 ? "Legg inn naturlige pauser etter meningsgrupper." : "Hold tempoet rolig nok til at melodien kommer frem.",
    hasTargetSounds.length < 2 ? "Øv spesielt på y, u, ø, å, kj, skj og rs-kombinasjoner." : "Fortsett å lytte etter norsk setningsmelodi."
  ]);

  const prior = request.profile ?? {
    pronunciation_issues: [],
    strengths: [],
    common_patterns: []
  };

  const profile: LearnerProfile = {
    pronunciation_issues: unique([
      ...prior.pronunciation_issues,
      ...(hasTargetSounds.length < 2 ? ["norske vokaler og konsonantgrupper"] : []),
      ...(helperVerbCount > 1 ? ["trykk på hjelpeverb"] : [])
    ]),
    strengths: unique([...prior.strengths, ...strengths]),
    common_patterns: unique([
      ...prior.common_patterns,
      ...(rhythm < 74 ? ["litt hakkete rytme"] : []),
      ...(fluency > 82 ? ["god flyt i lengre svar"] : [])
    ])
  };

  return {
    scores: { pronunciation, rhythm, fluency },
    strengths,
    improvements,
    focus:
      helperVerbCount > 1
        ? "I morgen: reduser trykket på hjelpeverb som skal, har og kan."
        : "I morgen: fokuser på jevn flyt og norsk setningsmelodi.",
    profile
  };
}
