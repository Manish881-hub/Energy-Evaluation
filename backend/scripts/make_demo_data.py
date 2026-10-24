"""Synthetic snapshot in the real CSV shape, for offline UI work and demos.

This is NOT real data. Run backend/scripts/ingest.py for the Elexon snapshot.
"""

from __future__ import annotations

import csv
import json
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

UTC = timezone.utc


def iso(value: datetime) -> str:
    return value.strftime("%Y-%m-%dT%H:%M:%SZ")


def make(out: Path, start: str = "2026-01-01", days: int = 31, seed: int = 7) -> None:
    rng = random.Random(seed)
    out.mkdir(parents=True, exist_ok=True)
    start_dt = datetime.fromisoformat(start).replace(tzinfo=UTC)
    level = 7000.0
    actuals = {}
    for index in range(days * 48):
        level = min(17000, max(500, level + rng.gauss(0, 180)))
        actuals[start_dt + timedelta(minutes=30 * index)] = round(level, 1)

    with (out / "actuals.csv").open("w", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(["start_time", "generation_mw"])
        for target, value in sorted(actuals.items()):
            writer.writerow([iso(target), value])

    rows = []
    for hour_index in range(days * 24):
        target = start_dt + timedelta(hours=hour_index)
        actual = (actuals[target] + actuals[target + timedelta(minutes=30)]) / 2
        for lead in range(2, 50, 3):
            published = target - timedelta(hours=lead) + timedelta(minutes=30)
            noise = rng.gauss(250, 80 + 45 * lead)
            rows.append((target, published, max(0, actual + noise)))

    with (out / "forecasts.csv").open("w", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(["start_time", "publish_time", "generation_mw"])
        for target, published, value in sorted(rows):
            writer.writerow([iso(target), iso(published), round(value, 1)])

    meta = {
        "fetched_at": iso(datetime.now(UTC)),
        "demo": True,
        "window": {"start": start, "end": (start_dt + timedelta(days=days - 1)).date().isoformat()},
        "counts": {
            "actual_half_hours": len(actuals),
            "forecast_hours": days * 24,
            "forecast_rows": len(rows),
            "publish_vintages": len({published for _, published, _ in rows}),
        },
        "notes": ["Synthetic data for offline development only. Not Elexon data."],
    }
    (out / "meta.json").write_text(json.dumps(meta, indent=2) + "\n")
    print(f"Wrote demo data to {out}")


if __name__ == "__main__":
    destination = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / "data"
    make(destination)
