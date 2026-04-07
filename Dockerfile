# ============================================
# Helios Leaderboard — Production Dockerfile
# Lightweight, no build step (vanilla JS + Express)
# ============================================
FROM node:22-slim

# Install timezone data (slim image doesn't include it)
RUN apt-get update && apt-get install -y --no-install-recommends tzdata && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install production deps only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application files
COPY server.js ./
COPY public/ ./public/

# Create local avatars cache directory
RUN mkdir -p /app/avatars

# Volume for persistent avatar cache (survives container restarts)
VOLUME /app/avatars

# Expose port (default 5000)
EXPOSE 5000

# Health check is defined in docker-compose.yml (uses /api/health)
# Do NOT define HEALTHCHECK here — it would override compose

# Start server
CMD ["node", "server.js"]
