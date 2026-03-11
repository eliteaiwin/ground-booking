from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from .database import init_db
from .routers import auth_router, users_router, games_router, payments_router, notifications_router, preferences_router, locations_router


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
