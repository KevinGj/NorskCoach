import textToSpeech from "@google-cloud/text-to-speech";

export const runtime = "nodejs";

type SpeechRequest = {
  text?: string;
  voice?: string;
  speakingRate?: number;
};

function makeClient() {
  const rawCredentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!rawCredentials) {
    return new textToSpeech.TextToSpeechClient();
  }

  const credentials = JSON.parse(rawCredentials) as {
    client_email: string;
    private_key: string;
  };

  return new textToSpeech.TextToSpeechClient({
    credentials: {
      client_email: credentials.client_email,
      private_key: credentials.private_key
    }
  });
}

export async function POST(request: Request) {
  const { text, voice = "nb-NO-Chirp3-HD-Aoede", speakingRate = 0.94 } = (await request.json()) as SpeechRequest;

  if (!text?.trim()) {
    return Response.json({ error: "Missing text" }, { status: 400 });
  }

  const client = makeClient();
  const [response] = await client.synthesizeSpeech({
    input: { text },
    voice: {
      languageCode: "nb-NO",
      name: voice
    },
    audioConfig: {
      audioEncoding: "MP3",
      speakingRate,
      pitch: 0
    }
  });

  if (!response.audioContent) {
    return Response.json({ error: "Ingen lyd ble returnert" }, { status: 502 });
  }

  return new Response(response.audioContent as BodyInit, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store"
    }
  });
}
