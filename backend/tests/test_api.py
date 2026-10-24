import csv
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import analysis as an  # noqa: E402

UTC = timezone.utc


def write_fixture(root: Path, days: int = 2) -> None:
    root.mkdir(parents=True, exist_ok=True)
    start = datetime(2026, 1, 1, tzinfo=UTC)
    actuals = []
    for i in range(days * 48):
        actuals.append({
            "start_time": (start + timedelta(minutes=30 * i)).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "generation_mw": 1000 + (i % 24) * 10,
        })
    forecasts = []
    for h in range(days * 24):
        target = start + timedelta(hours=h)
        for lead in (48, 36, 24, 12, 6, 2):
            forecasts.append({
                "start_time": target.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "publish_time": (target - timedelta(hours=lead)).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "generation_mw": 1000 + (h % 24) * 10 + lead * 5,
            })
    with (root / "actuals.csv").open("w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=["start_time", "generation_mw"])
        writer.writeheader()
        writer.writerows(actuals)
    with (root / "forecasts.csv").open("w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=["start_time", "publish_time", "generation_mw"])
        writer.writeheader()
        writer.writerows(forecasts)
    (root / "meta.json").write_text('{"fetched_at": "2026-10-24T00:00:00Z", "source": "test"}')


@pytest.fixture()
def client(tmp_path, monkeypatch):
    write_fixture(tmp_path, days=2)
    monkeypatch.setattr(an, "DATA_DIR", tmp_path)
    an.load_dataset.cache_clear()
    from app.main import app

    with TestClient(app) as test_client:
        yield test_client
    an.load_dataset.cache_clear()


def test_health(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_meta(client):
    response = client.get("/api/meta")
    assert response.status_code == 200
    body = response.json()
    assert body["counts"]["actual_half_hours"] == 96
    assert body["cutoff_default"] == "09:00"
    assert body["window"]["start"] == "2026-01-01"
    assert body["meta"]["source"] == "test"


def test_day_view(client):
    response = client.get("/api/day", params={"day": "2026-01-01", "cutoff": "09:00"})
    assert response.status_code == 200
    body = response.json()
    assert body["date"] == "2026-01-01"
    assert len(body["points"]) == 48
    assert body["kpis"]["forecast_mwh"] > 0
    assert body["latest_publish"] is not None


def test_day_outside_window_is_rejected(client):
    response = client.get("/api/day", params={"day": "2025-12-31"})
    assert response.status_code == 422


def test_invalid_cutoff_is_rejected(client):
    response = client.get("/api/accuracy", params={"cutoff": "9am"})
    assert response.status_code == 422


def test_accuracy(client):
    response = client.get("/api/accuracy", params={"cutoff": "09:00"})
    assert response.status_code == 200
    body = response.json()
    assert body["summary"]["n"] == 96
    assert len(body["by_hour"]) == 24
    assert len(body["by_day"]) == 2
    assert body["summary"]["bias_mw"] > 0
    assert body["insights"]["p90_shortfall_mw"] > 0


def test_accuracy_start_after_end_is_rejected(client):
    response = client.get("/api/accuracy", params={"start": "2026-01-02", "end": "2026-01-01"})
    assert response.status_code == 422


def test_horizon(client):
    response = client.get("/api/horizon")
    assert response.status_code == 200
    body = response.json()
    assert len(body) > 0
    assert body[0]["n"] > 0


def test_evolution(client):
    response = client.get("/api/evolution", params={"day": "2026-01-01", "cutoff": "09:00"})
    assert response.status_code == 200
    body = response.json()
    assert body["selected_publish"] is not None
    assert len(body["snapshots"]) >= 2
    assert len(body["actual"]) == 24


def test_export_csv(client):
    response = client.get("/api/export.csv", params={"cutoff": "09:00"})
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert "target_time_utc" in response.text
    assert len(response.text.strip().splitlines()) == 97
