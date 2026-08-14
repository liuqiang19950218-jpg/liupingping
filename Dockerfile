FROM node:22

WORKDIR /app

# Install full deps (vinext/wrangler are devDependencies required by `vinext start`)
COPY package*.json ./
RUN npm ci

# Copy project and build
COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV WRANGLER_LOG_PATH=.wrangler/wrangler.log
EXPOSE 3000

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "3000"]
