import { analyzeSpeech, type CoachRequest } from "@/lib/coach";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const payload = (await request.json()) as CoachRequest;
  return NextResponse.json(analyzeSpeech(payload));
}
