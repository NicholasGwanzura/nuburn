FROM node:22-alpine

ENV NODE_ENV=production \
    DATA_DIR=/app/data

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --chown=node:node server ./server
COPY --chown=node:node public ./public

RUN mkdir -p /app/data/uploads \
    && chown -R node:node /app

USER node

EXPOSE 3000

CMD ["npm", "start"]
