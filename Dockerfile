# Build stage
FROM node:18-slim AS builder
WORKDIR /app

# Copy package files
COPY package*.json ./

# Disable update notifier and skip chromium download
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
RUN npm config set update-notifier false
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# Production stage
FROM node:18-slim
WORKDIR /app

# Install Chromium and required fonts/libs for Puppeteer (Debian/Ubuntu style)
# This is much more stable than Alpine
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    wget \
    xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to use installed Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Copy built app
COPY --from=builder /app/build ./build
COPY --from=builder /app/server.js ./
COPY --from=builder /app/package*.json ./

# Install production deps
RUN npm ci --omit=dev

# Expose ports
EXPOSE 3000 5000

# Start server
CMD ["node", "server.js"]
