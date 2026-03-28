FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies (no Tor, no Java — those are in separate containers)
RUN apt-get update && apt-get install -y \
    curl \
    python3 \
    python3-pip \
    python3-venv \
    sqlite3 \
    procps \
    cron \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 20 (apt ships Node 18 which is too old for Vite 8)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Bisq CLI is still needed by snapshot.py to query the Bisq container's gRPC
ENV BISQ_VERSION=1.9.22
RUN apt-get update && apt-get install -y wget unzip openjdk-11-jre-headless \
    && mkdir -p /opt/bisq \
    && wget -q "https://github.com/bisq-network/bisq/releases/download/v${BISQ_VERSION}/bisq-cli-${BISQ_VERSION}.zip" -O /tmp/bisq-cli.zip \
    && unzip -q /tmp/bisq-cli.zip -d /opt/bisq/ \
    && chmod -R o+rX /opt/bisq/ \
    && rm /tmp/bisq-cli.zip \
    && apt-get purge -y wget unzip && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy application files
COPY dexMonitor/ ./
RUN chmod +x /app/start.sh

# Build React frontend
RUN cd /app/react-frontend && npm install && npm run build

# Copy nokyc tool
COPY nokyc/ /app/nokyc/

# Set up Python virtual environment
RUN python3 -m venv venv && \
    venv/bin/pip install --upgrade pip && \
    venv/bin/pip install -r requirements.txt && \
    venv/bin/pip install -r /app/nokyc/requirements.txt

RUN mkdir -p /app/data
RUN mkdir -p /var/run && chmod 755 /var/run

RUN useradd -m -s /bin/bash appuser && \
    chown -R appuser:appuser /app

USER appuser
WORKDIR /app/data

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:5000/health || exit 1

CMD ["/app/start.sh"]
