"""Vercel serverless entrypoint for the Windline FastAPI app.

Vercel's Python runtime routes the rewrite destination path (/api/index) to this
function, so the original endpoint is carried in the __windline_path query
parameter. This tiny ASGI wrapper restores the path before FastAPI routes it.
"""
import sys
from pathlib import Path
from urllib.parse import parse_qsl, urlencode

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.main import app as fastapi_app  # noqa: E402


class VercelPathRewrite:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            pairs = parse_qsl(
                scope.get("query_string", b"").decode("latin-1"),
                keep_blank_values=True,
            )
            endpoint = None
            kept = []
            for key, value in pairs:
                if key == "__windline_path" and endpoint is None:
                    endpoint = value
                else:
                    kept.append((key, value))
            if endpoint:
                scope = dict(scope)
                path = "/api/" + endpoint.lstrip("/")
                scope["path"] = path
                scope["raw_path"] = path.encode("latin-1")
                scope["query_string"] = urlencode(kept, doseq=True).encode("latin-1")
        await self.app(scope, receive, send)


app = VercelPathRewrite(fastapi_app)
