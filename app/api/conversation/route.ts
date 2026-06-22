type ConversationTurn = {
  speaker: "coach" | "user";
  text: string;
};

type ConversationRequest = {
  referenceText?: string;
  userText?: string;
  elapsedSeconds?: number;
  turns?: ConversationTurn[];
};

const followUps = [
  "Hva legger du mest merke til i denne delen av teksten?",
  "Kan du si det samme med litt andre ord?",
  "Hvorfor tror du det skjer akkurat slik?",
  "Hva synes du er det viktigste ordet eller bildet i teksten?",
  "Kan du knytte dette til noe du selv har opplevd?",
  "Hva tror du skjer videre?"
];

function cleanSentence(text = "") {
  return text
    .replace(/\s+/g, " ")
    .split(/[.!?]/)
    .map((sentence) => sentence.trim())
    .find((sentence) => sentence.length > 24)
    ?.slice(0, 180);
}

function buildReply({ referenceText = "", userText = "", elapsedSeconds = 0, turns = [] }: ConversationRequest) {
  const referenceHook = cleanSentence(referenceText) ?? "teksten du nettopp jobbet med";
  const turnCount = turns.filter((turn) => turn.speaker === "user").length;
  const remainingSeconds = Math.max(0, 300 - elapsedSeconds);
  const userWords = userText.trim().split(/\s+/).filter(Boolean).length;
  const nextQuestion = followUps[turnCount % followUps.length];
  const shortAnswerSupport =
    userWords < 8
      ? "Prøv gjerne å svare med én eller to hele setninger."
      : "Det var et fint svar, og du holder samtalen i gang.";

  if (remainingSeconds <= 30) {
    return `${shortAnswerSupport} Vi nærmer oss slutten, så la oss runde av: Hva tar du med deg fra denne teksten og denne samtalen?`;
  }

  if (turnCount === 0) {
    return `${shortAnswerSupport} I teksten hører vi blant annet: "${referenceHook}". ${nextQuestion}`;
  }

  return `${shortAnswerSupport} Jeg hører at du prøver å forklare innholdet med egne ord. ${nextQuestion}`;
}

export async function POST(request: Request) {
  const payload = (await request.json()) as ConversationRequest;
  return Response.json({
    reply: buildReply(payload)
  });
}
