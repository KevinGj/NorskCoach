import speech from "@google-cloud/speech";

export const runtime = "nodejs";

type GoogleCredentials = {
  client_email: string;
  private_key: string;
};

function makeClient() {
  const rawCredentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!rawCredentials) {
    return new speech.SpeechClient();
  }

  const credentials = JSON.parse(rawCredentials) as GoogleCredentials;
  return new speech.SpeechClient({
    credentials: {
      client_email: credentials.client_email,
      private_key: credentials.private_key
    }
  });
}

function encodingFromMimeType(mimeType: string) {
  if (mimeType.includes("webm")) return "WEBM_OPUS" as const;
  if (mimeType.includes("ogg")) return "OGG_OPUS" as const;
  if (mimeType.includes("flac")) return "FLAC" as const;
  if (mimeType.includes("wav")) return "LINEAR16" as const;
  return "WEBM_OPUS" as const;
}

function sampleRateFromEncoding(encoding: ReturnType<typeof encodingFromMimeType>) {
  return encoding === "WEBM_OPUS" || encoding === "OGG_OPUS" ? 48000 : undefined;
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const audio = formData.get("audio");

    if (!(audio instanceof Blob) || audio.size === 0) {
      return Response.json({ error: "Mangler lydopptak." }, { status: 400 });
    }

    const buffer = Buffer.from(await audio.arrayBuffer());
    const client = makeClient();
    const encoding = encodingFromMimeType(audio.type);
    const sampleRateHertz = sampleRateFromEncoding(encoding);
    const [response] = await client.recognize({
      audio: {
        content: buffer.toString("base64")
      },
      config: {
        encoding,
        ...(sampleRateHertz ? { sampleRateHertz } : {}),
        languageCode: "no-NO",
        enableAutomaticPunctuation: true,
        model: "latest_long"
      }
    });

    const transcript = response.results
      ?.map((result) => result.alternatives?.[0]?.transcript?.trim() ?? "")
      .filter(Boolean)
      .join(" ")
      .trim();

    if (!transcript) {
      return Response.json({ error: "Google STT fant ingen tydelig tale i opptaket." }, { status: 422 });
    }

    return Response.json({
      transcript,
      confidence: response.results?.[0]?.alternatives?.[0]?.confidence ?? null
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ukjent feil fra Google STT.";
    return Response.json({ error: `Google STT feilet: ${message}` }, { status: 500 });
  }
}
