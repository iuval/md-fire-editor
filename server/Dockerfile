FROM node:24-alpine AS base
WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src

USER node
EXPOSE 8080
CMD ["node", "src/index.mjs"]
