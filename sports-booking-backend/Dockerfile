FROM python:3.12-slim

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends gcc && rm -rf /var/lib/apt/lists/*

# Copy project metadata and source
COPY pyproject.toml README.md ./
COPY main.py ./
COPY app ./app

# Install dependencies and the package itself
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir .

# Create data directory for SQLite persistence (Fly volume can be mounted here)
RUN mkdir -p /data

ENV DATABASE_PATH=/data/app.db
ENV SEED_MODE=production

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
