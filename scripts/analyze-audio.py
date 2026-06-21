from __future__ import annotations

import argparse
import json
import math
import statistics
from pathlib import Path
from typing import Any

import numpy as np
import parselmouth


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = ROOT / "data" / "audio-segments.json"
DEFAULT_OUTPUT_DIR = ROOT / "public" / "analysis" / "norsk-segments"


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def percentile(values: list[float], ratio: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = int(round((len(ordered) - 1) * ratio))
    return ordered[clamp(index, 0, len(ordered) - 1)]  # type: ignore[index]


def public_to_file_path(public_path: str) -> Path:
    clean = public_path.lstrip("/").replace("/", "\\")
    if clean.startswith("audio\\"):
        return ROOT / "public" / clean
    return ROOT / clean


def analysis_public_path(segment_id: str) -> str:
    return f"/analysis/norsk-segments/{segment_id}.json"


def sample_sound(sound: parselmouth.Sound, columns: int) -> list[float]:
    values = sound.values
    mono = values.mean(axis=0)
    if mono.size == 0:
        return []

    result: list[float] = []
    for column in range(columns):
        start = int((column / columns) * mono.size)
        end = max(start + 1, int(((column + 1) / columns) * mono.size))
        result.append(float(np.max(np.abs(mono[start:end]))))

    peak = max(max(result), 0.001)
    return [round(12 + (value / peak) * 72, 3) for value in result]


def smooth_pitch(values: list[float | None], max_gap: int = 6, window: int = 5) -> list[float | None]:
    filled: list[float | None] = values[:]
    index = 0
    while index < len(filled):
        if filled[index] is not None:
            index += 1
            continue
        start = index
        while index < len(filled) and filled[index] is None:
            index += 1
        end = index
        if start == 0 or end >= len(filled) or end - start > max_gap:
            continue
        left = filled[start - 1]
        right = filled[end]
        if left is None or right is None:
            continue
        for gap_index in range(start, end):
            progress = (gap_index - start + 1) / (end - start + 1)
            filled[gap_index] = left + (right - left) * progress

    smoothed: list[float | None] = []
    radius = max(1, window // 2)
    for point_index, value in enumerate(filled):
        if value is None:
            smoothed.append(None)
            continue
        local = [
            candidate
            for candidate in filled[max(0, point_index - radius) : min(len(filled), point_index + radius + 1)]
            if candidate is not None
        ]
        smoothed.append(round(statistics.median(local), 3) if local else None)
    return smoothed


def normalize_pitch(values: list[float | None]) -> list[float | None]:
    voiced = [value for value in values if value is not None]
    if not voiced:
        return [None for _ in values]
    low = max(60.0, percentile(voiced, 0.08))
    high = min(460.0, max(low + 12.0, percentile(voiced, 0.92)))
    low_log = math.log2(low)
    pitch_range = max(0.08, math.log2(high) - low_log)

    normalized: list[float | None] = []
    for value in values:
        if value is None:
            normalized.append(None)
            continue
        ratio = (math.log2(clamp(value, low, high)) - low_log) / pitch_range
        normalized.append(round(clamp(82 - ratio * 64, 18, 82), 3))
    return normalized


def sample_spectrogram(sound: parselmouth.Sound, columns: int) -> list[list[float]]:
    spectrogram = sound.to_spectrogram(window_length=0.025, maximum_frequency=3200)
    bands = [2800, 2100, 1600, 1200, 900, 650, 450, 300, 160]
    duration = sound.duration
    raw: list[list[float]] = []

    for column in range(columns):
        time = ((column + 0.5) / columns) * duration
        raw.append([
            max(0.0, float(spectrogram.get_power_at(time, frequency)))
            for frequency in bands
        ])

    peak = max([value for column in raw for value in column] or [0.001])
    return [[round(clamp(math.log1p(value) / math.log1p(peak), 0, 1), 4) for value in column] for column in raw]


def analyze_segment(segment: dict[str, Any], output_dir: Path, force: bool) -> dict[str, Any]:
    segment_id = segment["id"]
    output_path = output_dir / f"{segment_id}.json"
    public_path = analysis_public_path(segment_id)
    segment["analysis"] = public_path

    if output_path.exists() and not force:
        return segment

    audio_path = public_to_file_path(segment["audio"])
    if not audio_path.exists():
        raise FileNotFoundError(f"Missing audio for {segment_id}: {audio_path}")

    sound = parselmouth.Sound(str(audio_path))
    pitch = sound.to_pitch_ac(time_step=0.01, pitch_floor=60, pitch_ceiling=460, very_accurate=True)
    intensity = sound.to_intensity(time_step=0.01, minimum_pitch=60)
    formant = sound.to_formant_burg(time_step=0.01, max_number_of_formants=5, maximum_formant=5500)

    frame_count = max(2, int(math.ceil(sound.duration / 0.02)))
    times = [((index + 0.5) / frame_count) * sound.duration for index in range(frame_count)]

    pitch_hz: list[float | None] = []
    intensity_db: list[float | None] = []
    formants: list[dict[str, float | None]] = []

    for time in times:
        hz = pitch.get_value_at_time(time)
        db = intensity.get_value(time)
        f1 = formant.get_value_at_time(1, time)
        f2 = formant.get_value_at_time(2, time)
        pitch_hz.append(round(float(hz), 3) if hz and not math.isnan(hz) else None)
        intensity_db.append(round(float(db), 3) if db and not math.isnan(db) else None)
        formants.append({
            "f1": round(float(f1), 3) if f1 and not math.isnan(f1) else None,
            "f2": round(float(f2), 3) if f2 and not math.isnan(f2) else None,
        })

    melody_hz = smooth_pitch(pitch_hz)
    output = {
        "version": 1,
        "engine": "praat-parselmouth",
        "segmentId": segment_id,
        "duration": round(float(sound.duration), 3),
        "sampleInterval": 0.02,
        "waveform": sample_sound(sound, 180),
        "spectrogram": sample_spectrogram(sound, 140),
        "pitchHz": pitch_hz,
        "melodyHz": melody_hz,
        "pitch": normalize_pitch(melody_hz),
        "intensityDb": intensity_db,
        "formants": formants,
        "pitchRangeHz": {
            "low": round(percentile([value for value in melody_hz if value is not None], 0.08), 2),
            "high": round(percentile([value for value in melody_hz if value is not None], 0.92), 2),
        },
    }

    output_dir.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    return segment


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate local speech analysis JSON for Norsk Coach segments.")
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--limit", type=int, default=0, help="Analyze only the first N segments.")
    parser.add_argument("--force", action="store_true", help="Re-analyze segments even when output JSON exists.")
    args = parser.parse_args()

    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    segments = manifest[: args.limit] if args.limit else manifest

    updated: list[dict[str, Any]] = []
    for index, segment in enumerate(manifest, start=1):
        if segment in segments:
            print(f"[{index}/{len(manifest)}] {segment['id']}")
            updated.append(analyze_segment(segment, args.output_dir, args.force))
        else:
            segment["analysis"] = analysis_public_path(segment["id"])
            updated.append(segment)

    args.manifest.write_text(json.dumps(updated, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Updated {args.manifest}")
    print(f"Wrote analysis files to {args.output_dir}")


if __name__ == "__main__":
    main()
