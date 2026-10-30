import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from contextlib import asynccontextmanager

import asyncio
import logging

import aiosqlite

from .database import init_db, DATABASE_PATH
from .routers import auth_router, users_router, games_router, payments_router, notifications_router, preferences_router, locations_router, discussion_router, allotments_router, gateway_router, receivers_router

# Optional: path to a pre-built frontend dist folder to serve as static files.
# When set, the backend serves the SPA on all non-/api routes (same-origin, no CORS issues).
STATIC_DIR = os.environ.get("STATIC_DIR", "")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    task = asyncio.create_task(_reminder_loop())
    yield
    task.cancel()


async def _reminder_loop():
    while True:
        try:
            async with aiosqlite.connect(DATABASE_PATH) as db:
                db.row_factory = aiosqlite.Row
                await games_router.send_tentative_reminders(db)
                await games_router.send_low_turnout_alerts(db)
        except Exception:
            logging.exception("tentative reminder loop failed")
        await asyncio.sleep(300)


app = FastAPI(title="Elite Turf Booking", lifespan=lifespan)

# Disable CORS. Do not remove this for full-stack development.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods
    allow_headers=["*"],  # Allows all headers
)

app.include_router(auth_router.router)
app.include_router(users_router.router)
app.include_router(games_router.router)
app.include_router(payments_router.router)
app.include_router(notifications_router.router)
app.include_router(preferences_router.router)
app.include_router(locations_router.router)
app.include_router(discussion_router.router)
app.include_router(allotments_router.router)
app.include_router(gateway_router.router)
app.include_router(receivers_router.router)


@app.get("/healthz")
async def healthz():
    return {"status": "ok"}


# --- Serve frontend static files when STATIC_DIR is set ---
if STATIC_DIR and Path(STATIC_DIR).is_dir():
    _static = Path(STATIC_DIR)
    _index = _static / "index.html"

    # Serve /assets (Vite build output) as static files
    _assets = _static / "assets"
    if _assets.is_dir():
        app.mount("/assets", StaticFiles(directory=str(_assets)), name="static-assets")

    # Catch-all: serve index.html for any non-API route (SPA routing)
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        # Try to serve the exact file first (e.g. favicon.ico, manifest.json)
        if full_path and not full_path.startswith("api"):
            file_path = (_static / full_path).resolve()
            # Guard against path traversal (e.g. ../../../etc/passwd)
            if file_path.is_relative_to(_static.resolve()) and file_path.is_file():
                return FileResponse(str(file_path))
        # Fall back to index.html for SPA routing
        return FileResponse(str(_index))
