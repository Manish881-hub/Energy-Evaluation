"""Download the Elexon wind snapshot used by Windline.

Usage:
    python backend/scripts/ingest.py
    python backend/scripts/ingest.py --start 2026-01-01 --end 2026-01-31

Outputs (committed to the repo so deployments are deterministic):
    backend/data/actuals.csv    start_time,generation_mw
    backend/data/forecasts.csv  start_time,publish_time,generation_mw
    backend/data/meta.json      provenance and counts

No API key is required. Only the standard library is used.
"""

from __future__ import annotations

import argparse
import csv
import json
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

BASE = "https://data.elexon.co.uk/bmrs/api/v1/datasets"
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data"
UTC = timezone.utc


def get_json(url: str, retries: int = 4):
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=60) as response:
                body = json.load(response)
            return body["data"] if isinstance(body, dict) and "data" in body else body
        except Exception as exc:  # noqa: BLE001
            if attempt == retries - 1:
                raise
            print(f"  retry after {exc}")
            time.sleep(2 * (attempt + 1))


def parse_ts(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)


def iso(value: datetime) -> str:
    return value.strftime("%Y-%m-%dT%H:%M:%SZ")


def chunks(start: datetime, end: datetime, days: int):
    current = start
    while current < end:
        following = min(current + timedelta(days=days), end)
        yield current, following
        current = following


def fetch_actuals(start: date, end: date) -> dict[datetime, float]:
    latest: dict[datetime, tuple[datetime, float]] = {}
    window_start = datetime.combine(start, datetime.min.time(), tzinfo=UTC)
    window_end = datetime.combine(end + timedelta(days=1), datetime.min.time(), tzinfo=UTC)
    for chunk_start, chunk_end in chunks(window_start, window_end, 7):
        query = urllib.parse.urlencode(
            {
                "settlementDateFrom": chunk_start.date().isoformat(),
                "settlementDateTo": (chunk_end - timedelta(days=1)).date().isoformat(),
                "fuelType": "WIND",
                "format": "json",
            }
        )
        rows = get_json(f"{BASE}/FUELHH/stream?{query}")
        print(f"FUELHH {chunk_start.date()}..{chunk_end.date()}: {len(rows)} rows")
        for row in rows:
            if row.get("fuelType") != "WIND":
                continue
            target = parse_ts(row["startTime"])
            published = parse_ts(row["publishTime"])
            if target not in latest or published > latest[target][0]:
                latest[target] = (published, float(row["generation"]))
    return {
        target: value
        for target, (_, value) in latest.items()
        if window_start <= target < window_end
    }


def fetch_forecasts(start: date, end: date, max_horizon_h: int = 48):
    window_start = datetime.combine(start, datetime.min.time(), tzinfo=UTC)
    window_end = datetime.combine(end + timedelta(days=1), datetime.min.time(), tzinfo=UTC)
    forecasts: dict[tuple[datetime, datetime], float] = {}
    fetch_from = window_start - timedelta(hours=max_horizon_h)
    for chunk_start, chunk_end in chunks(fetch_from, window_end, 2):
        query = urllib.parse.urlencode(
            {
                "publishDateTimeFrom": iso(chunk_start),
                "publishDateTimeTo": iso(chunk_end),
                "format": "json",
            }
        )
        rows = get_json(f"{BASE}/WINDFOR/stream?{query}")
        print(f"WINDFOR {chunk_start.date()}..{chunk_end.date()}: {len(rows)} rows")
        for row in rows:
            if row.get("generation") is None:
                continue
            target = parse_ts(row["startTime"])
            published = parse_ts(row["publishTime"])
            horizon = (target - published).total_seconds() / 3600
            if window_start <= target < window_end and 0 <= horizon <= max_horizon_h:
                forecasts[(target, published)] = float(row["generation"])
    return forecasts


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", default="2026-01-01")
    parser.add_argument("--end", default="2026-01-31")
    parser.add_argument("--max-horizon-hours", type=int, default=48)
    parser.add_argument("--out", type=Path, default=OUT)
    args = parser.parse_args()
    start = date.fromisoformat(args.start)
    end = date.fromisoformat(args.end)
    if end < start:
        raise SystemExit("--end must be on or after --start")
    args.out.mkdir(parents=True, exist_ok=True)

    actuals = fetch_actuals(start, end)
    with (args.out / "actuals.csv").open("w", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(["start_time", "generation_mw"])
        for target in sorted(actuals):
            writer.writerow([iso(target), actuals[target]])

    forecasts = fetch_forecasts(start, end, args.max_horizon_hours)
    with (args.out / "forecasts.csv").open("w", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(["start_time", "publish_time", "generation_mw"])
        for target, published in sorted(forecasts):
            writer.writerow([iso(target), iso(published), forecasts[(target, published)]])

    publish_times = sorted({published for _, published in forecasts})
    meta = {
        "fetched_at": iso(datetime.now(UTC)),
        "window": {
            "start": start.isoformat(),
            "end": end.isoformat(),
            "label": "January 2026 delivery",
        },
        "counts": {
            "actual_half_hours": len(actuals),
            "forecast_hours": len({target for target, _ in forecasts}),
            "forecast_rows": len(forecasts),
            "publish_vintages": len(publish_times),
        },
        "sources": {
            "actuals": {
                "dataset": "FUELHH",
                "filter": "fuelType=WIND",
                "url": "https://bmrs.elexon.co.uk/api-documentation/endpoint/datasets/FUELHH/stream",
            },
            "forecasts": {
                "dataset": "WINDFOR",
                "url": "https://bmrs.elexon.co.uk/api-documentation/endpoint/datasets/WINDFOR/stream",
                "max_horizon_hours": args.max_horizon_hours,
            },
        },
        "notes": [
            "Actuals keep the latest FUELHH revision per settlement period.",
            "Forecasts keep every WINDFOR vintage for reproducibility.",
            "WINDFOR is hourly; the analysis applies each hour to both settlement periods.",
        ],
    }
    (args.out / "meta.json").write_text(json.dumps(meta, indent=2) + "\n")
    print(f"Wrote {len(actuals)} actuals, {len(forecasts)} forecasts to {args.out}")


if __name__ == "__main__":
    main()
