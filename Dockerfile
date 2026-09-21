# Fly.io deployment: builds the frontend and serves it from the FastAPI backend.
FROM node:22-slim AS frontend
WORKDIR /frontend
COPY sports-booking-frontend/package.json sports-booking-frontend/package-lock.json* ./
RUN npm install
COPY sports-booking-frontend ./
ARG GOOGLE_CLIENT_ID=
ENV VITE_API_URL= VITE_GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends gcc && rm -rf /var/lib/apt/lists/*
COPY sports-booking-backend/pyproject.toml sports-booking-backend/README.md ./
COPY sports-booking-backend/main.py ./
COPY sports-booking-backend/app ./app
RUN pip install --no-cache-dir --upgrade pip && pip install --no-cache-dir .
COPY --from=frontend /frontend/dist /app/static
RUN mkdir -p /data

ENV DATABASE_PATH=/data/app.db
ENV UPLOAD_DIR=/data/uploads
ENV STATIC_DIR=/app/static
ENV SEED_MODE=production
EXPOSE 8080
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
