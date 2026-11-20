# Stage 1: Build React frontend
FROM node:26-alpine AS frontend

WORKDIR /build
COPY dexMonitor/react-frontend/package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --prefer-offline
COPY dexMonitor/react-frontend/ ./
# Commit metadata for the frontend's "deployed commit" header. The build runs
# without a .git dir, so CI passes these in; vite.config falls back to git/unknown.
ARG COMMIT_HASH=unknown
ARG COMMIT_DATE=
ENV COMMIT_HASH=${COMMIT_HASH}
ENV COMMIT_DATE=${COMMIT_DATE}
RUN npm run build

# Stage 2: Build Go binary
FROM golang:1.27-alpine AS builder
# Fall through on any proxy error: proxy.golang.org may be unreachable on some
# hosts, while goproxy.io can intermittently return 5xx responses.
ARG GOPROXY=https://proxy.golang.org|https://goproxy.io|direct
ENV GOPROXY=${GOPROXY}
RUN apk add --no-cache git

WORKDIR /build/dexMonitor
COPY commons/ ../commons/
COPY dexMonitor/go.mod dexMonitor/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    sh -ec 'for attempt in 1 2 3 4 5; do go mod download && exit 0; echo "go mod download attempt $attempt failed, retrying..."; sleep $((attempt * 10)); done; exit 1'
COPY dexMonitor/cmd/server/ ./cmd/server/
COPY dexMonitor/internal/ ./internal/
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    sh -ec 'for attempt in 1 2 3; do CGO_ENABLED=0 go build -ldflags="-s -w" -o server ./cmd/server && exit 0; echo "go build attempt $attempt failed, retrying..."; sleep $((attempt * 10)); done; exit 1'

# Stage 3: Minimal runtime
FROM alpine:3.24

RUN apk add --no-cache curl tzdata

WORKDIR /app

COPY --from=builder /build/dexMonitor/server ./
COPY --from=frontend /build/dist ./react-frontend/dist

RUN adduser -D appuser && chown -R appuser:appuser /app

USER appuser

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:5000/health || exit 1

CMD ["./server"]
