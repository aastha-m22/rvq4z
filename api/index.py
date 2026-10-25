"""Vercel serverless entry point: exposes the FastAPI app under /api/*.

Vercel serves the built React app as static files and routes /api/* here
(see vercel.json). The bundled data snapshot ships with the function.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app.main import app  # noqa: E402,F401
