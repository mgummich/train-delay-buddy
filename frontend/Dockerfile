# syntax=docker/dockerfile:1

# ─── dev stage ─────────────────────────────────────────────────────────────────
FROM node:22-alpine AS dev
WORKDIR /app
RUN chown -R node:node /app
USER node
COPY --chown=node:node package*.json ./
RUN npm ci
COPY --chown=node:node . .
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

# ─── builder stage ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
RUN chown -R node:node /app
USER node
COPY --chown=node:node package*.json ./
RUN npm ci
COPY --chown=node:node . .
RUN npm run build

# ─── prod stage ────────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS prod
LABEL org.opencontainers.image.title="verspaetungs-begleiter-frontend" \
      org.opencontainers.image.source="https://github.com/mgummich/train-delay-buddy" \
      org.opencontainers.image.licenses="MIT"
COPY --from=builder /app/dist /usr/share/nginx/html
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -qO- http://localhost/ >/dev/null || exit 1
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
