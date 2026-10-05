FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY src ./src
COPY test ./test
RUN npm test
USER node
EXPOSE 8080
CMD ["node", "src/server.mjs"]
