import math
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import analysis as an  # noqa: E402

UTC = timezone.utc
DAY = date(2026, 1, 15)


def mk(actuals=None, forecasts=None, meta=None):
    return an.Dataset(
        actuals=actuals or {},
        forecasts={t: tuple(sorted(v)) for t, v in (forecasts or {}).items()},
        meta=meta or {},
    )


def published(day, hour, minute=0):
    return datetime(2026, 1, day, hour, minute, tzinfo=UTC)


def full_day_forecast(mw=1000.0, publish=None):
    publish = publish or published(14, 8)
    return {
        datetime(2026, 1, 15, h, tzinfo=UTC): [(publish, mw)]
        for h in range(24)
    }


def full_day_actuals(mw=1000.0):
    return {
        datetime(2026, 1, 15, 0, 0, tzinfo=UTC) + timedelta(minutes=30 * i): mw
        for i in range(48)
    }


def test_decision_time_is_previous_day_at_cutoff_in_london():
    assert an.decision_time(DAY, "09:00") == datetime(2026, 1, 14, 9, 0, tzinfo=UTC)


def test_decision_time_respects_british_summer_time():
    assert an.decision_time(date(2026, 7, 15), "09:00") == datetime(2026, 7, 14, 8, 0, tzinfo=UTC)


def test_invalid_cutoff_is_rejected():
    with pytest.raises(ValueError):
        an.parse_cutoff("9am")


def test_latest_forecast_is_the_latest_publish_at_or_before_cutoff():
    series = ((published(14, 8), 1000.0), (published(14, 10), 5000.0))
    assert an.latest_forecast(series, datetime(2026, 1, 14, 9, tzinfo=UTC)) == (published(14, 8), 1000.0)


def test_forecast_published_exactly_at_cutoff_is_usable():
    series = ((published(14, 9), 1000.0),)
    assert an.latest_forecast(series, datetime(2026, 1, 14, 9, tzinfo=UTC)) == (published(14, 9), 1000.0)


def test_no_forecast_before_cutoff_returns_none():
    series = ((published(14, 10), 1000.0),)
    assert an.latest_forecast(series, datetime(2026, 1, 14, 9, tzinfo=UTC)) is None


def test_hourly_forecast_is_applied_to_both_half_hours():
    target = datetime(2026, 1, 15, 12, tzinfo=UTC)
    ds = mk(
        actuals={target: 900.0, target + timedelta(minutes=30): 900.0},
        forecasts={target: [(published(14, 8), 1000.0)]},
    )
    rows = an.build_points(ds, "09:00", DAY, DAY)
    assert [r["target"] for r in rows] == [target, target + timedelta(minutes=30)]
    assert [r["forecast_mw"] for r in rows] == [1000.0, 1000.0]
    assert [r["error_mw"] for r in rows] == [100.0, 100.0]
    assert rows[0]["publish_time"] == published(14, 8)


def test_forecast_after_cutoff_is_ignored():
    target = datetime(2026, 1, 15, 12, tzinfo=UTC)
    ds = mk(
        actuals={target: 900.0, target + timedelta(minutes=30): 900.0},
        forecasts={target: [(published(14, 8), 1000.0), (published(14, 10), 5000.0)]},
    )
    assert [r["forecast_mw"] for r in an.build_points(ds, "09:00", DAY, DAY)] == [1000.0, 1000.0]


def test_no_forecast_means_no_row():
    target = datetime(2026, 1, 15, 12, tzinfo=UTC)
    ds = mk(
        actuals={target: 900.0},
        forecasts={target: [(published(14, 10), 5000.0)]},
    )
    assert an.build_points(ds, "09:00", DAY, DAY) == []


def test_build_points_filters_by_local_delivery_day():
    ds = mk(
        actuals=full_day_actuals(),
        forecasts=full_day_forecast(),
    )
    rows = an.build_points(ds, "09:00", DAY, DAY)
    assert len(rows) == 48
    assert {r["target"].astimezone(an.LONDON).date() for r in rows} == {DAY}


def test_summary_metrics_are_independently_calculable():
    rows = [
        {"error_mw": 10.0, "actual_mw": 100.0, "forecast_mw": 110.0},
        {"error_mw": -10.0, "actual_mw": 100.0, "forecast_mw": 90.0},
        {"error_mw": 20.0, "actual_mw": 100.0, "forecast_mw": 120.0},
        {"error_mw": -20.0, "actual_mw": 100.0, "forecast_mw": 80.0},
    ]
    s = an.summarise(rows)
    assert s["n"] == 4
    assert s["mae_mw"] == 15.0
    assert s["bias_mw"] == 0.0
    assert s["rmse_mw"] == pytest.approx(math.sqrt(250))
    assert s["wape_pct"] == pytest.approx(15.0)
    assert s["over_forecast_pct"] == 50.0
    assert s["p50_abs_mw"] == 15.0
    assert s["p90_abs_mw"] == 20.0
    assert s["max_abs_mw"] == 20.0


def test_summary_ignores_rows_without_actuals():
    rows = [
        {"error_mw": None, "actual_mw": None, "forecast_mw": 10.0},
        {"error_mw": 5.0, "actual_mw": 100.0, "forecast_mw": 105.0},
    ]
    assert an.summarise(rows)["n"] == 1


def test_quantile_interpolates():
    assert an.quantile([1, 2, 3, 4, 5], 0.5) == 3
    assert an.quantile([0, 10], 0.9) == 9
    assert an.quantile([0, 10], 0.0) == 0
    assert an.quantile([0, 10], 1.0) == 10


def test_error_quantiles_use_linear_interpolation():
    rows = [{"error_mw": e} for e in (-20.0, -10.0, 10.0, 20.0)]
    q = an.error_quantiles(rows)
    assert q["p10"] == pytest.approx(-17.0)
    assert q["p50"] == pytest.approx(0.0)
    assert q["p90"] == pytest.approx(17.0)


def test_day_view_kpis_and_band_from_supplied_quantiles():
    ds = mk(actuals=full_day_actuals(), forecasts=full_day_forecast())
    view = an.day_view(ds, DAY, "09:00", {"p10": -100.0, "p90": 200.0})
    assert len(view["points"]) == 48
    assert view["kpis"]["forecast_mwh"] == pytest.approx(24000.0)
    assert view["kpis"]["low_mwh"] == pytest.approx(19200.0)
    assert view["kpis"]["high_mwh"] == pytest.approx(26400.0)
    assert view["kpis"]["peak_forecast_mw"] == 1000.0
    assert view["kpis"]["p90_shortfall_mw"] == 200.0
    assert view["points"][0]["low_mw"] == 800.0
    assert view["points"][0]["high_mw"] == 1100.0


def test_day_view_band_is_never_negative():
    ds = mk(actuals=full_day_actuals(50.0), forecasts=full_day_forecast(100.0))
    view = an.day_view(ds, DAY, "09:00", {"p10": -500.0, "p90": 500.0})
    assert view["points"][0]["low_mw"] == 0.0
    assert view["points"][0]["high_mw"] == 600.0


def test_accuracy_report_has_expected_slices():
    ds = mk(actuals=full_day_actuals(900.0), forecasts=full_day_forecast(1000.0))
    report = an.accuracy_report(ds, "09:00", DAY, DAY)
    assert report["summary"]["n"] == 48
    assert report["summary"]["mae_mw"] == 100.0
    assert report["summary"]["bias_mw"] == 100.0
    assert len(report["series"]) == 48
    assert len(report["by_day"]) == 1
    assert len(report["by_hour"]) == 24
    assert len(report["by_level"]) >= 1
    assert report["by_day"][0]["date"] == "2026-01-15"
    assert report["by_day"][0]["mae_mw"] == 100.0


def test_histogram_counts_all_errors():
    ds = mk(actuals=full_day_actuals(900.0), forecasts=full_day_forecast(1000.0))
    report = an.accuracy_report(ds, "09:00", DAY, DAY)
    assert sum(b["count"] for b in report["histogram"]) == 48


def test_horizon_report_grows_with_lead_time():
    target = datetime(2026, 1, 15, 12, tzinfo=UTC)
    actual = {target: 1000.0, target + timedelta(minutes=30): 1000.0}
    series = [
        (published(15, 12), 1100.0),
        (published(15, 6), 1200.0),
        (published(14, 12), 1300.0),
    ]
    ds = mk(actuals=actual, forecasts={target: series})
    report = an.horizon_report(ds, DAY, DAY)
    by_h = {r["horizon_h"]: r for r in report}
    assert by_h[0]["mae_mw"] == pytest.approx(100.0)
    assert by_h[6]["mae_mw"] == pytest.approx(200.0)
    assert by_h[24]["mae_mw"] == pytest.approx(300.0)


def test_evolution_includes_only_vintages_before_cutoff():
    target = datetime(2026, 1, 15, 12, tzinfo=UTC)
    ds = mk(
        actuals={target: 1000.0, target + timedelta(minutes=30): 1000.0},
        forecasts={
            target: [
                (published(13, 9), 800.0),
                (published(14, 4), 900.0),
                (published(14, 8), 1000.0),
                (published(14, 10), 5000.0),
            ]
        },
    )
    evo = an.evolution(ds, DAY, "09:00")
    assert evo["selected_publish"] == an.iso(published(14, 8))
    assert all(s["publish_time"] <= an.iso(datetime(2026, 1, 14, 9, tzinfo=UTC)) for s in evo["snapshots"])
    assert evo["snapshots"][-1]["publish_time"] == an.iso(published(14, 8))


def test_loader_reads_csv_snapshot_and_dedupes_forecasts(tmp_path):
    (tmp_path / "actuals.csv").write_text(
        "start_time,generation_mw\n2026-01-01T00:00:00Z,100\n2026-01-01T00:30:00Z,110\n"
    )
    (tmp_path / "forecasts.csv").write_text(
        "start_time,publish_time,generation_mw\n"
        "2026-01-01T00:00:00Z,2025-12-31T07:30:00Z,120\n"
        "2026-01-01T00:00:00Z,2025-12-31T07:30:00Z,125\n"
        "2026-01-01T01:00:00Z,2025-12-31T07:30:00Z,130\n"
    )
    (tmp_path / "meta.json").write_text('{"fetched_at": "2026-10-24T00:00:00Z"}')
    ds = an.load_dataset(str(tmp_path))
    assert len(ds.actuals) == 2
    assert len(ds.forecasts) == 2
    assert ds.forecasts[datetime(2026, 1, 1, 0, tzinfo=UTC)] == (
        (datetime(2025, 12, 31, 7, 30, tzinfo=UTC), 125.0),
    )
    assert ds.meta["fetched_at"] == "2026-10-24T00:00:00Z"


def test_meta_reports_window_and_counts():
    ds = mk(actuals=full_day_actuals(), forecasts=full_day_forecast())
    m = an.meta(ds)
    assert m["window"]["start"] == "2026-01-01"
    assert m["window"]["end"] == "2026-01-31"
    assert m["counts"]["actual_half_hours"] == 48
    assert m["counts"]["forecast_hours"] == 24
    assert m["default_day"] == "2026-01-15"
    assert m["cutoff_default"] == "09:00"
