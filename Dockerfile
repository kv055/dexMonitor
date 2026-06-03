# Stage 1: Build React frontend
FROM node:24-alpine AS frontend

WORKDIR /build
COPY dexMonitor/react-frontend/package*.json ./
RUN npm ci
COPY dexMonitor/react-frontend/ ./
# Commit metadata for the frontend's "deployed commit" header. The build runs
# without a .git dir, so CI passes these in; vite.config falls back to git/unknown.
ARG COMMIT_HASH=unknown
ARG COMMIT_DATE=
ENV COMMIT_HASH=${COMMIT_HASH}
ENV COMMIT_DATE=${COMMIT_DATE}
RUN npm run build

# Stage 2: Build Go binary
FROM golang:1.25-alpine AS builder
ARG GOPROXY=https://goproxy.io,https://proxy.golang.org,direct
ENV GOPROXY=${GOPROXY}

WORKDIR /build/dexMonitor
COPY commons/ ../commons/
COPY dexMonitor/go.mod dexMonitor/go.sum ./
RUN go mod download
COPY dexMonitor/cmd/server/ ./cmd/server/
COPY dexMonitor/internal/ ./internal/
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o server ./cmd/server

# Stage 3: Minimal runtime
FROM alpine:3.21

RUN apk add --no-cache curl

WORKDIR /app

COPY --from=builder /build/dexMonitor/server ./
COPY --from=frontend /build/dist ./react-frontend/dist

RUN adduser -D appuser && chown -R appuser:appuser /app

USER appuser

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:5000/health || exit 1

CMD ["./server"]
