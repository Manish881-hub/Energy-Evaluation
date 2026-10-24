"""Windline analysis core.

A deep, deterministic module: it knows how to load the Elexon snapshot, pick the
forecast a trader could actually have seen at the D-1 cutoff, align the hourly
WINDFOR vintage with half-hourly FUELHH actuals, and quantify the resulting
error. The API layer only validates input and serialises these results.

Sign convention: error = forecast - actual. A positive error means wind was
over-forecast, so the desk is short relative to plan.
"""

from __future__ import annotations

import csv
import json
import math
from bisect import bisect_right
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from statistics import correlation as _correlation
from statistics import mean
from zoneinfo import ZoneInfo

LONDON = ZoneInfo("Europe/London")
UTC = timezone.utc
DATA_DIR = Path(__file__).resolve().parents[1] / "data"

WINDOW_START = date(2026, 1, 1)
WINDOW_END = date(2026, 1, 31)
DEFAULT_CUTOFF = "09:00"
DEFAULT_DAY = date(2026, 1, 15)

SOURCE_NOTE = (
    "WINDFOR is an hourly wind forecast for wind farms visible to the ESO. "
    "FUELHH is metered transmission-connected generation. The gap therefore "
    "contains forecast error plus scope and curtailment effects; this pilot "
    "quantifies the combined gap because curtailment data is out of scope."
)
RESOLUTION_NOTE = (
    "WINDFOR forecasts are hourly. Each hourly value is applied to both "
    "settlement periods beginning in that hour, so accuracy is measured at the "
    "half-hourly resolution used for day-ahead purchasing."
)

LEVEL_EDGES = [0, 3000, 6000, 9000, 12000, 15000, 18000, 21000, math.inf]


class DataNotLoaded(Exception):
    pass


@dataclass(frozen=True)
class Dataset:
    actuals: dict[datetime, float]
    forecasts: dict[datetime, tuple[tuple[datetime, float], ...]]
    meta: dict = field(default_factory=dict)


def parse_ts(value: str) -> datetime:
    text = value.strip().replace("Z", "+00:00")
    parsed = datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def iso(value: datetime) -> str:
    return value.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_cutoff(value: str) -> time:
    try:
        parsed = datetime.strptime(value.strip(), "%H:%M").time()
    except (TypeError, ValueError) as exc:
        raise ValueError("cutoff must be a 24-hour HH:MM time") from exc
    return parsed


@lru_cache(maxsize=8)
def load_dataset(data_dir: str | None = None) -> Dataset:
    directory = Path(data_dir) if data_dir else DATA_DIR
    actuals_path = directory / "actuals.csv"
    forecasts_path = directory / "forecasts.csv"
    if not actuals_path.exists() or not forecasts_path.exists():
        raise DataNotLoaded(
            "Data snapshot missing. Run `python backend/scripts/ingest.py` first."
        )

    actuals: dict[datetime, tuple[datetime, float]] = {}
    with actuals_path.open(newline="") as fh:
        for row in csv.DictReader(fh):
            target = parse_ts(row["start_time"])
            published = parse_ts(row["publish_time"]) if row.get("publish_time") else datetime.min.replace(tzinfo=UTC)
            generation = float(row["generation_mw"])
            previous = actuals.get(target)
            if previous is None or published >= previous[0]:
                actuals[target] = (published, generation)

    forecasts: dict[datetime, dict[datetime, float]] = defaultdict(dict)
    with forecasts_path.open(newline="") as fh:
        for row in csv.DictReader(fh):
            if row.get("generation_mw") in (None, ""):
                continue
            target = parse_ts(row["start_time"])
            published = parse_ts(row["publish_time"])
            forecasts[target][published] = float(row["generation_mw"])

    meta = {}
    meta_path = directory / "meta.json"
    if meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text())
        except json.JSONDecodeError:
            meta = {}

    return Dataset(
        actuals={target: value for target, (_, value) in actuals.items()},
        forecasts={
            target: tuple(sorted(publishes.items()))
            for target, publishes in forecasts.items()
        },
        meta=meta,
    )


def decision_time(delivery_day: date, cutoff: str) -> datetime:
    local_time = parse_cutoff(cutoff)
    previous_day = delivery_day - timedelta(days=1)
    local = datetime.combine(previous_day, local_time, tzinfo=LONDON)
    return local.astimezone(UTC)


def latest_forecast(
    series: tuple[tuple[datetime, float], ...] | list[tuple[datetime, float]],
    decision: datetime,
) -> tuple[datetime, float] | None:
    if not series:
        return None
    publishes = [published for published, _ in series]
    index = bisect_right(publishes, decision)
    if index == 0:
        return None
    return series[index - 1]


def build_points(
    ds: Dataset,
    cutoff: str,
    start: date | None = None,
    end: date | None = None,
) -> list[dict]:
    points = []
    for hour, series in sorted(ds.forecasts.items()):
        if hour.minute != 0 or hour.second != 0:
            continue
        local_day = hour.astimezone(LONDON).date()
        if (start and local_day < start) or (end and local_day > end):
            continue
        selected = latest_forecast(series, decision_time(local_day, cutoff))
        if selected is None:
            continue
        published, forecast = selected
        for target in (hour, hour + timedelta(minutes=30)):
            actual = ds.actuals.get(target)
            points.append(
                {
                    "target": target,
                    "publish_time": published,
                    "forecast_mw": forecast,
                    "actual_mw": actual,
                    "error_mw": None if actual is None else forecast - actual,
                    "horizon_h": (target - published).total_seconds() / 3600,
                }
            )
    return points


def quantile(values: list[float], q: float) -> float | None:
    if not values:
        return None
    if not 0 <= q <= 1:
        raise ValueError("q must be between 0 and 1")
    ordered = sorted(values)
    position = (len(ordered) - 1) * q
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    weight = position - lower
    return ordered[lower] + (ordered[upper] - ordered[lower]) * weight


def summarise(rows: list[dict]) -> dict:
    valid = [row for row in rows if row.get("error_mw") is not None and row.get("actual_mw") is not None]
    n = len(valid)
    if n == 0:
        return {
            "n": 0,
            "mean_actual_mw": None,
            "mean_forecast_mw": None,
            "mae_mw": None,
            "rmse_mw": None,
            "bias_mw": None,
            "wape_pct": None,
            "p50_abs_mw": None,
            "p90_abs_mw": None,
            "p95_abs_mw": None,
            "max_abs_mw": None,
            "min_error_mw": None,
            "max_error_mw": None,
            "over_forecast_pct": None,
            "bias_pct_of_actual": None,
            "correlation": None,
        }

    errors = [row["error_mw"] for row in valid]
    abs_errors = sorted(abs(error) for error in errors)
    total_actual = sum(row["actual_mw"] for row in valid)
    mean_actual = total_actual / n
    bias = sum(errors) / n
    forecasts = [row["forecast_mw"] for row in valid]
    actuals = [row["actual_mw"] for row in valid]
    corr = None
    if n > 1 and len(set(forecasts)) > 1 and len(set(actuals)) > 1:
        corr = _correlation(forecasts, actuals)
    return {
        "n": n,
        "mean_actual_mw": mean_actual,
        "mean_forecast_mw": sum(forecasts) / n,
        "mae_mw": sum(abs_errors) / n,
        "rmse_mw": math.sqrt(sum(error * error for error in errors) / n),
        "bias_mw": bias,
        "wape_pct": 100 * sum(abs_errors) / total_actual if total_actual > 0 else None,
        "p50_abs_mw": quantile(abs_errors, 0.5),
        "p90_abs_mw": quantile(abs_errors, 0.9),
        "p95_abs_mw": quantile(abs_errors, 0.95),
        "max_abs_mw": abs_errors[-1],
        "min_error_mw": min(errors),
        "max_error_mw": max(errors),
        "over_forecast_pct": 100 * sum(error > 0 for error in errors) / n,
        "bias_pct_of_actual": 100 * bias / mean_actual if mean_actual else None,
        "correlation": corr,
    }


def error_quantiles(rows: list[dict]) -> dict:
    errors = sorted(row["error_mw"] for row in rows if row.get("error_mw") is not None)
    return {
        f"p{int(q * 100):02d}": quantile(errors, q)
        for q in (0.05, 0.10, 0.25, 0.50, 0.75, 0.90, 0.95)
    }


def band_from_quantiles(quantiles: dict) -> dict:
    p10 = quantiles.get("p10")
    p90 = quantiles.get("p90")
    return {
        "confidence_pct": 80,
        "p10_error_mw": p10,
        "p90_error_mw": p90,
        "low_offset_mw": p90,
        "high_offset_mw": p10,
        "in_sample": True,
    }


def _group(rows: list[dict], key):
    grouped = defaultdict(list)
    for row in rows:
        grouped[key(row)].append(row)
    return grouped


def _mini(rows: list[dict]) -> dict:
    summary = summarise(rows)
    return {
        "n": summary["n"],
        "mae_mw": summary["mae_mw"],
        "bias_mw": summary["bias_mw"],
        "rmse_mw": summary["rmse_mw"],
        "p90_abs_mw": summary["p90_abs_mw"],
    }


def _valid(rows: list[dict]) -> list[dict]:
    return [row for row in rows if row.get("error_mw") is not None]


def histogram(rows: list[dict]) -> list[dict]:
    errors = [row["error_mw"] for row in rows if row.get("error_mw") is not None]
    if not errors:
        return []
    width = 500
    while True:
        low = math.floor(min(errors) / width) * width
        high = math.ceil(max(errors) / width) * width
        if high == low:
            high = low + width
        if (high - low) / width <= 36:
            break
        width *= 2
    bins = []
    for start in range(int(low), int(high), int(width)):
        end = start + width
        count = sum(1 for error in errors if start <= error < end)
        bins.append(
            {
                "from_mw": start,
                "to_mw": end,
                "count": count,
                "mid_mw": (start + end) / 2,
            }
        )
    return bins


def _by_day(rows: list[dict]) -> list[dict]:
    grouped = _group(rows, lambda row: row["target"].astimezone(LONDON).date())
    result = []
    for day, group in sorted(grouped.items()):
        mini = _mini(group)
        valid = _valid(group)
        result.append(
            {
                "date": day.isoformat(),
                **mini,
                "mean_actual_mw": mean([row["actual_mw"] for row in valid]) if valid else None,
                "mean_forecast_mw": mean([row["forecast_mw"] for row in valid]) if valid else None,
                "energy_actual_gwh": sum(row["actual_mw"] for row in valid) * 0.5 / 1000 if valid else None,
                "energy_forecast_gwh": sum(row["forecast_mw"] for row in valid) * 0.5 / 1000 if valid else None,
                "over_forecast_pct": summarise(group)["over_forecast_pct"],
            }
        )
    return result


def _by_hour(rows: list[dict]) -> list[dict]:
    grouped = _group(rows, lambda row: row["target"].astimezone(LONDON).hour)
    return [
        {"hour": hour, **_mini(grouped.get(hour, []))}
        for hour in range(24)
    ]


def _level_label(low: float, high: float) -> str:
    if math.isinf(high):
        return f"{low / 1000:.0f}+ GW"
    return f"{low / 1000:.0f}-{high / 1000:.0f} GW"


def _by_level(rows: list[dict]) -> list[dict]:
    def level(row):
        for low, high in zip(LEVEL_EDGES, LEVEL_EDGES[1:]):
            if low <= row["forecast_mw"] < high:
                return low
        return LEVEL_EDGES[-2]

    grouped = _group(rows, level)
    result = []
    for low, high in zip(LEVEL_EDGES, LEVEL_EDGES[1:]):
        group = grouped.get(low, [])
        result.append(
            {
                "lo_mw": low,
                "hi_mw": None if math.isinf(high) else high,
                "label": _level_label(low, high),
                **_mini(group),
            }
        )
    return result


def _worst_days(by_day: list[dict], limit: int = 5) -> list[dict]:
    ranked = [day for day in by_day if day["n"] > 0 and day["mae_mw"] is not None]
    ranked.sort(key=lambda day: day["mae_mw"], reverse=True)
    return [
        {
            "date": day["date"],
            "mae_mw": day["mae_mw"],
            "bias_mw": day["bias_mw"],
            "n": day["n"],
            "mean_actual_mw": day["mean_actual_mw"],
            "mean_forecast_mw": day["mean_forecast_mw"],
        }
        for day in ranked[:limit]
    ]


def horizon_report(ds: Dataset, start: date | None = None, end: date | None = None) -> list[dict]:
    grouped = defaultdict(list)
    for hour, series in ds.forecasts.items():
        local_day = hour.astimezone(LONDON).date()
        if (start and local_day < start) or (end and local_day > end):
            continue
        halves = [ds.actuals.get(hour), ds.actuals.get(hour + timedelta(minutes=30))]
        available = [value for value in halves if value is not None]
        if not available:
            continue
        actual = sum(available) / len(available)
        for published, forecast in series:
            horizon = (hour - published).total_seconds() / 3600
            if 0 <= horizon < 49:
                grouped[int(horizon)].append(
                    {
                        "error_mw": forecast - actual,
                        "actual_mw": actual,
                        "forecast_mw": forecast,
                    }
                )
    result = []
    for horizon in sorted(grouped):
        group = grouped[horizon]
        summary = summarise(group)
        result.append(
            {
                "horizon_h": horizon,
                "n": summary["n"],
                "mae_mw": summary["mae_mw"],
                "bias_mw": summary["bias_mw"],
                "rmse_mw": summary["rmse_mw"],
            }
        )
    return result


def insights(rows: list[dict], by_day: list[dict], quantiles: dict) -> dict:
    valid = _valid(rows)
    high = [row for row in valid if row["forecast_mw"] >= 15000]
    low = [row for row in valid if row["forecast_mw"] < 9000]
    high_summary = summarise(high)
    low_summary = summarise(low)
    worst = _worst_days(by_day, 1)
    return {
        "p90_shortfall_mw": max(0.0, quantiles.get("p90") or 0.0),
        "p10_surplus_mw": max(0.0, -(quantiles.get("p10") or 0.0)),
        "high_wind_bias_mw": high_summary["bias_mw"],
        "high_wind_mae_mw": high_summary["mae_mw"],
        "high_wind_n": high_summary["n"],
        "high_wind_share_pct": 100 * high_summary["n"] / len(valid) if valid else None,
        "low_wind_bias_mw": low_summary["bias_mw"],
        "low_wind_mae_mw": low_summary["mae_mw"],
        "low_wind_n": low_summary["n"],
        "worst_day": worst[0] if worst else None,
    }


def accuracy_report(
    ds: Dataset,
    cutoff: str = DEFAULT_CUTOFF,
    start: date | None = None,
    end: date | None = None,
) -> dict:
    rows = build_points(ds, cutoff, start, end)
    valid = _valid(rows)
    quantiles = error_quantiles(valid)
    summary = summarise(valid)
    by_day = _by_day(rows)
    horizons = [row["horizon_h"] for row in valid]
    return {
        "params": {
            "cutoff": cutoff,
            "start": start.isoformat() if start else None,
            "end": end.isoformat() if end else None,
        },
        "summary": summary,
        "error_quantiles": quantiles,
        "band": band_from_quantiles(quantiles),
        "histogram": histogram(valid),
        "by_day": by_day,
        "by_hour": _by_hour(rows),
        "by_level": _by_level(rows),
        "by_horizon": horizon_report(ds, start, end),
        "worst_days": _worst_days(by_day),
        "insights": insights(rows, by_day, quantiles),
        "series": [
            {
                "t": iso(row["target"]),
                "forecast_mw": row["forecast_mw"],
                "actual_mw": row["actual_mw"],
                "error_mw": row["error_mw"],
            }
            for row in rows
        ],
        "horizon_min_h": min(horizons) if horizons else None,
        "horizon_max_h": max(horizons) if horizons else None,
        "resolution_note": RESOLUTION_NOTE,
        "scope_note": SOURCE_NOTE,
    }


def _band_for(forecast: float, quantiles: dict | None) -> tuple[float | None, float | None]:
    if not quantiles or quantiles.get("p10") is None or quantiles.get("p90") is None:
        return None, None
    low = max(0.0, forecast - quantiles["p90"])
    high = max(0.0, forecast - quantiles["p10"])
    if low > high:
        low, high = high, low
    return low, high


def day_view(ds: Dataset, delivery_day: date, cutoff: str, quantiles: dict | None = None) -> dict:
    rows = build_points(ds, cutoff, delivery_day, delivery_day)
    points = []
    for row in rows:
        low, high = _band_for(row["forecast_mw"], quantiles)
        points.append(
            {
                "t": iso(row["target"]),
                "forecast_mw": row["forecast_mw"],
                "actual_mw": row["actual_mw"],
                "error_mw": row["error_mw"],
                "low_mw": low,
                "high_mw": high,
                "publish_time": iso(row["publish_time"]),
                "horizon_h": row["horizon_h"],
            }
        )

    half_hours = len(points)
    forecast_mwh = sum(point["forecast_mw"] for point in points) * 0.5 if points else None
    actual_mwh = (
        sum(point["actual_mw"] for point in points if point["actual_mw"] is not None) * 0.5
        if points
        else None
    )
    low_mwh = (
        sum(point["low_mw"] for point in points if point["low_mw"] is not None) * 0.5
        if points and all(point["low_mw"] is not None for point in points)
        else None
    )
    high_mwh = (
        sum(point["high_mw"] for point in points if point["high_mw"] is not None) * 0.5
        if points and all(point["high_mw"] is not None for point in points)
        else None
    )
    publishes = [row["publish_time"] for row in rows]
    horizons = [row["horizon_h"] for row in rows]
    summary = summarise(rows)
    return {
        "date": delivery_day.isoformat(),
        "cutoff": cutoff,
        "decision_time_utc": iso(decision_time(delivery_day, cutoff)),
        "latest_publish": iso(max(publishes)) if publishes else None,
        "earliest_publish": iso(min(publishes)) if publishes else None,
        "points": points,
        "kpis": {
            "n_points": half_hours,
            "n_missing_actual": sum(point["actual_mw"] is None for point in points),
            "forecast_mwh": forecast_mwh,
            "actual_mwh": actual_mwh,
            "low_mwh": low_mwh,
            "high_mwh": high_mwh,
            "peak_forecast_mw": max((point["forecast_mw"] for point in points), default=None),
            "min_forecast_mw": min((point["forecast_mw"] for point in points), default=None),
            "mean_forecast_mw": mean([point["forecast_mw"] for point in points]) if points else None,
            "p90_shortfall_mw": max(0.0, (quantiles or {}).get("p90") or 0.0),
            "p10_surplus_mw": max(0.0, -((quantiles or {}).get("p10") or 0.0)),
            "horizon_min_h": min(horizons) if horizons else None,
            "horizon_max_h": max(horizons) if horizons else None,
            "mae_mw": summary["mae_mw"],
            "bias_mw": summary["bias_mw"],
        },
        "band": band_from_quantiles(quantiles or {}),
        "resolution_note": RESOLUTION_NOTE,
        "scope_note": SOURCE_NOTE,
    }


def evolution(ds: Dataset, delivery_day: date, cutoff: str) -> dict:
    decision = decision_time(delivery_day, cutoff)
    local_start = datetime.combine(delivery_day, time(0), tzinfo=LONDON).astimezone(UTC)
    targets = [local_start + timedelta(hours=hour) for hour in range(24)]
    by_publish: dict[datetime, dict[datetime, float]] = defaultdict(dict)
    for target in targets:
        for published, forecast in ds.forecasts.get(target, ()):
            if published <= decision:
                by_publish[published][target] = forecast

    publishes = sorted(by_publish)
    latest = max(publishes) if publishes else None
    prior = max((p for p in publishes if latest and p < latest), default=None)
    day_before_cut = decision - timedelta(hours=24)
    day_before = max((p for p in publishes if p <= day_before_cut), default=None)
    oldest = min(publishes) if publishes else None
    chosen = []
    for published in (oldest, day_before, prior, latest):
        if published is not None and published not in chosen:
            chosen.append(published)
    chosen.sort()

    if latest is None:
        kind_for = {}
    else:
        kind_for = {
            latest: "latest",
            prior: "previous",
            day_before: "day_before",
            oldest: "oldest",
        }

    snapshots = [
        {
            "publish_time": iso(published),
            "lead_hours": (decision - published).total_seconds() / 3600,
            "kind": kind_for.get(published, "other"),
            "points": [
                {
                    "t": iso(target),
                    "forecast_mw": by_publish[published].get(target),
                }
                for target in targets
            ],
        }
        for published in chosen
    ]

    actual = []
    for target in targets:
        halves = [ds.actuals.get(target), ds.actuals.get(target + timedelta(minutes=30))]
        available = [value for value in halves if value is not None]
        actual.append(
            {
                "t": iso(target),
                "actual_mw": sum(available) / len(available) if available else None,
            }
        )

    return {
        "date": delivery_day.isoformat(),
        "cutoff": cutoff,
        "decision_time_utc": iso(decision),
        "selected_publish": iso(latest) if latest else None,
        "snapshots": snapshots,
        "actual": actual,
    }


def meta(ds: Dataset) -> dict:
    actual_days = sorted({target.astimezone(LONDON).date() for target in ds.actuals})
    target_hours = sorted(ds.forecasts)
    first_day = actual_days[0] if actual_days else WINDOW_START
    last_day = actual_days[-1] if actual_days else WINDOW_END
    default_day = DEFAULT_DAY if first_day <= DEFAULT_DAY <= last_day else first_day
    first_target = min(ds.actuals) if ds.actuals else None
    last_target = max(ds.actuals) if ds.actuals else None
    publish_times = {published for series in ds.forecasts.values() for published, _ in series}
    return {
        "product": "Windline",
        "window": {
            "start": WINDOW_START.isoformat(),
            "end": WINDOW_END.isoformat(),
            "label": "January 2026 delivery",
        },
        "cutoff_default": DEFAULT_CUTOFF,
        "default_day": default_day.isoformat(),
        "first_day": first_day.isoformat(),
        "last_day": last_day.isoformat(),
        "first_target": iso(first_target) if first_target else None,
        "last_target": iso(last_target) if last_target else None,
        "counts": {
            "actual_half_hours": len(ds.actuals),
            "forecast_hours": len(ds.forecasts),
            "forecast_rows": sum(len(series) for series in ds.forecasts.values()),
            "publish_vintages": len(publish_times),
            "target_half_hours": len(target_hours) * 2,
        },
        "sources": [
            {
                "id": "WINDFOR",
                "name": "Wind generation forecast",
                "publisher": "Elexon Insights / NESO",
                "url": "https://bmrs.elexon.co.uk/api-documentation/endpoint/datasets/WINDFOR/stream",
                "use": "Hourly wind forecast vintages",
            },
            {
                "id": "FUELHH",
                "name": "Actual generation by fuel type",
                "publisher": "Elexon Insights",
                "url": "https://bmrs.elexon.co.uk/api-documentation/endpoint/datasets/FUELHH/stream",
                "use": "Half-hourly WIND actuals",
            },
        ],
        "resolution_note": RESOLUTION_NOTE,
        "scope_note": SOURCE_NOTE,
        "meta": ds.meta,
    }
