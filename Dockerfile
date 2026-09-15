FROM node:22

ARG BUILD_SHA
ARG BUILD_TIME
ARG ENVIRONMENT=formal

WORKDIR /app

# Install full deps (vinext/wrangler are devDependencies required by `vinext start`)
COPY package*.json ./
RUN npm ci

# Copy project and build
COPY . .
ENV BUILD_SHA=$BUILD_SHA
ENV BUILD_TIME=$BUILD_TIME
ENV ENVIRONMENT=$ENVIRONMENT
RUN npm run build

ENV NODE_ENV=production
ENV WRANGLER_LOG_PATH=.wrangler/wrangler.log
EXPOSE 3000

# The built Vinext server imports Cloudflare bindings (for D1/R2).  Run the
# compiled Worker through Wrangler instead of the Vite development server or
# Node's plain ESM loader, and persist the local bindings under the mounted
# .wrangler data directory.
CMD ["npx", "wrangler", "dev", "--config", "dist/server/wrangler.json", "--ip", "0.0.0.0", "--port", "3000", "--persist-to", ".wrangler"]
