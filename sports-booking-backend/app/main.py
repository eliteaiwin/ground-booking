import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from contextlib import asynccontextmanager

from .database import init_db
from .routers import auth_router, users_router, games_router, payments_router, notifications_router, preferences_router, locations_router

# Optional: path to a pre-built frontend dist folder to serve as static files.
# When set, the backend serves the SPA on all non-/api routes (same-origin, no CORS issues).
STATIC_DIR = os.environ.get("STATIC_DIR", "")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(title="Ground Booking App", lifespan=lifespan)

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
        file_path = _static / full_path
        if full_path and file_path.is_file() and not full_path.startswith("api"):
            return FileResponse(str(file_path))
        # Fall back to index.html for SPA routing
        return FileResponse(str(_index))
