# ============================================
# Helios Leaderboard — Production Dockerfile
# Lightweight, no build step (vanilla JS + Express)
# ============================================
FROM node:22-slim

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

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD node -e "fetch('http://localhost:5000/api/leaderboard?resetHour=6').then(r=>{if(!r.ok)throw new Error();process.exit(0)}).catch(()=>process.exit(1))"

# Start server
CMD ["node", "server.js"]
