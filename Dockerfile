FROM ubuntu:24.04

# Set environment variables
ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    wget \
    gnupg \
    # Python
    python3 \
    python3-pip \
    python3-venv \
    # Tor
    tor \
    # SQLite
    sqlite3 \
    # Other utilities
    procps \
    cron \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy application files
COPY . ./

# Set up Python virtual environment
RUN python3 -m venv venv && \
    venv/bin/pip install --upgrade pip && \
    venv/bin/pip install -r requirements.txt

# Create data directory for persistence
RUN mkdir -p /app/data

# Pre-create /var/run for cron
RUN mkdir -p /var/run && chmod 755 /var/run

# Create non-root user
RUN useradd -m -s /bin/bash appuser && \
    chown -R appuser:appuser /app

# Switch to user
USER appuser

# Make data directory writable
WORKDIR /app/data

# Expose ports
# 9050: Tor SOCKS proxy
# 5000: Flask API
EXPOSE 9050 5000

# Health check for Tor
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -s --socks5 127.0.0.1:9050 https://check.torproject.org/api/ip || exit 1

# Start script
CMD ["/app/start.sh"]