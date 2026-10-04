FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build
ENV RESOURCE_SERVER_URL=http://resource-server:8080
EXPOSE 5173
CMD ["npm", "run", "dev"]
