from fastapi import FastAPI
from app.main import app as fastapi_app

# Re-export the FastAPI application for deployment entrypoints
app: FastAPI = fastapi_app
