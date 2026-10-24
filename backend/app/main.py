from __future__ import annotations

import csv
import io
from datetime import date
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import analysis as an

app = FastAPI(
    title="Windline API",
    version="1.0.0",
    description="Day-ahead wind decision intelligence for GB.",
)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"])
app.add_middleware(GZipMiddleware, minimum_size=1024)

CACHE = "public, max-age=300, stale-while-revalidate=3600"


def _ds() -> an.Dataset:
    try:
        return an.load_dataset()
    except an.DataNotLoaded as exc:
        raise HTTPException(503, str(exc)) from exc


def _cutoff(value: str) -> str:
    try:
        an.parse_cutoff(value)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return value


def _day(value: date) -> date:
    if not an.WINDOW_START <= value <= an.WINDOW_END:
        raise HTTPException(
            422,
            f"day must be within {an.WINDOW_START.isoformat()} and {an.WINDOW_END.isoformat()}",
        )
    return value


def _range(start: date | None, end: date | None) -> tuple[date | None, date | None]:
    if start and start < an.WINDOW_START:
        raise HTTPException(422, "start is before the January 2026 window")
    if end and end > an.WINDOW_END:
        raise HTTPException(422, "end is after the January 2026 window")
    if start and end and start > end:
        raise HTTPException(422, "start must be on or before end")
    return start, end


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/meta")
def meta(response: Response) -> dict:
    response.headers["Cache-Control"] = CACHE
    return an.meta(_ds())


@app.get("/api/day")
def day(
    response: Response,
    delivery_day: Annotated[date, Query(alias="day")],
    cutoff: str = an.DEFAULT_CUTOFF,
) -> dict:
    response.headers["Cache-Control"] = CACHE
    ds = _ds()
    cutoff = _cutoff(cutoff)
    delivery_day = _day(delivery_day)
    quantiles = an.error_quantiles(an.build_points(ds, cutoff))
    view = an.day_view(ds, delivery_day, cutoff, quantiles)
    if not view["points"]:
        raise HTTPException(404, f"No forecast available for {delivery_day.isoformat()}")
    return view


@app.get("/api/accuracy")
def accuracy(
    response: Response,
    cutoff: str = an.DEFAULT_CUTOFF,
    start: date | None = None,
    end: date | None = None,
) -> dict:
    response.headers["Cache-Control"] = CACHE
    cutoff = _cutoff(cutoff)
    start, end = _range(start, end)
    return an.accuracy_report(_ds(), cutoff, start, end)


@app.get("/api/horizon")
def horizon(
    response: Response,
    start: date | None = None,
    end: date | None = None,
) -> list[dict]:
    response.headers["Cache-Control"] = CACHE
    start, end = _range(start, end)
    return an.horizon_report(_ds(), start, end)


@app.get("/api/evolution")
def evolution(
    response: Response,
    delivery_day: Annotated[date, Query(alias="day")],
    cutoff: str = an.DEFAULT_CUTOFF,
) -> dict:
    response.headers["Cache-Control"] = CACHE
    cutoff = _cutoff(cutoff)
    delivery_day = _day(delivery_day)
    return an.evolution(_ds(), delivery_day, cutoff)


@app.get("/api/export.csv")
def export_csv(cutoff: str = an.DEFAULT_CUTOFF) -> Response:
    ds = _ds()
    cutoff = _cutoff(cutoff)
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(
        [
            "target_time_utc",
            "target_time_uk",
            "forecast_mw",
            "actual_mw",
            "error_mw",
            "publish_time_utc",
            "horizon_h",
        ]
    )
    for row in an.build_points(ds, cutoff):
        writer.writerow(
            [
                an.iso(row["target"]),
                row["target"].astimezone(an.LONDON).isoformat(),
                row["forecast_mw"],
                "" if row["actual_mw"] is None else row["actual_mw"],
                "" if row["error_mw"] is None else row["error_mw"],
                an.iso(row["publish_time"]),
                round(row["horizon_h"], 2),
            ]
        )
    return Response(
        content=buffer.getvalue(),
        media_type="text/csv",
        headers={
            "Content-Disposition": f"attachment; filename=windline_asof_{cutoff.replace(':', '')}.csv",
            "Cache-Control": "no-store",
        },
    )


_dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if _dist.exists():
    app.mount("/assets", StaticFiles(directory=_dist / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        if path.startswith("api/"):
            raise HTTPException(404)
        candidate = (_dist / path).resolve()
        if _dist.resolve() in candidate.parents and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(_dist / "index.html")
