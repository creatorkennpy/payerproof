FROM node:24-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY src ./src
COPY public ./public

ENV NODE_ENV=production
ENV PORT=3000
# Volume persistente: o SQLite nao pode viver no disco efemero do container.
ENV DB_PATH=/data/x402rep.db

EXPOSE 3000

CMD ["npm", "start"]
