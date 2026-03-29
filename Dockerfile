# Stage 1: Build React frontend
FROM node:20-alpine AS frontend

WORKDIR /build
COPY dexMonitor/react-frontend/package*.json ./
RUN npm ci
COPY dexMonitor/react-frontend/ ./
RUN npm run build

# Stage 2: Python runtime
FROM python:3.12-alpine

RUN apk add --no-cache curl procps

WORKDIR /app

COPY dexMonitor/server.py ./
COPY --from=frontend /build/dist ./react-frontend/dist

RUN pip install --no-cache-dir flask flask-cors flasgger requests[socks]

RUN adduser -D appuser && chown -R appuser:appuser /app

USER appuser

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:5000/health || exit 1

CMD ["python", "/app/server.py"]
