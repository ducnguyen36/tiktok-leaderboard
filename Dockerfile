# Build stage
FROM node:18-slim AS builder
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies for build
RUN npm config set update-notifier false
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# Production stage - now much smaller without Chromium!
FROM node:18-slim
WORKDIR /app

# Copy built app and necessary files
COPY --from=builder /app/build ./build
COPY --from=builder /app/server.js ./
COPY --from=builder /app/package*.json ./

# Copy public folder for avatars
COPY --from=builder /app/public ./public

# Install production deps only
RUN npm ci --omit=dev

# Expose ports
EXPOSE 3000 5000

# Start server
CMD ["node", "server.js"]
