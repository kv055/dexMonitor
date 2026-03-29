# Stage 1: Build React frontend
FROM node:20-alpine AS frontend

WORKDIR /build
COPY react-frontend/package*.json ./
RUN npm ci
COPY react-frontend/ ./
RUN npm run build

# Stage 2: Build Go binary
FROM golang:1.25-alpine AS builder

WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/server/ ./cmd/server/
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o server ./cmd/server

# Stage 3: Minimal runtime
FROM alpine:3.21

RUN apk add --no-cache curl

WORKDIR /app

COPY --from=builder /build/server ./
COPY --from=frontend /build/dist ./react-frontend/dist

RUN adduser -D appuser && chown -R appuser:appuser /app

USER appuser

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:5000/health || exit 1

CMD ["./server"]
