# Norsk Coach

Norsk Coach is a simple web app for advanced Norwegian learners who want to sound more natural when speaking. It focuses on pronunciation, rhythm, intonation, fluency, listening, and confidence rather than vocabulary drills or grammar exercises.

## What It Does

- Guides a daily 15-minute speaking session
- Provides shadowing, guided conversation, storytelling, and feedback stages
- Uses browser speech synthesis for Norwegian prompts
- Uses browser speech recognition when available, with a manual transcript fallback
- Scores pronunciation, rhythm, and fluency with a local heuristic coaching engine
- Stores progress and a learner profile locally in the browser

## Tech Stack

- Next.js
- React
- TypeScript
- CSS modules via global app CSS
- Next.js API route for coaching analysis

## Getting Started

Install dependencies:

```bash
npm install
```

Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Build for production:

```bash
npm run build
```

Start the production build:

```bash
npm run start
```

## Current V1 Scope

This version intentionally keeps the coaching engine local and lightweight. It is ready for UI testing and daily-flow validation, but it does not yet connect to a production speech-analysis model, OpenAI Realtime API, Voice API, PostgreSQL, or user accounts.

The core app shape is in place so those services can be added behind the existing `/api/coach` boundary.

## Project Structure

```text
app/
  api/coach/route.ts   Coaching API route
  globals.css          App styling
  layout.tsx           Root layout and metadata
  page.tsx             Main coaching experience
lib/
  coach.ts             Heuristic speech analysis and learner profile logic
```

## Repository

GitHub: [KevinGj/NorskCoach](https://github.com/KevinGj/NorskCoach.git)
