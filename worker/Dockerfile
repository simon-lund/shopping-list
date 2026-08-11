FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY baileys.mjs ./
# The WhatsApp session lives here; mount a volume or you re-pair on every deploy.
VOLUME /data
CMD ["node", "baileys.mjs"]
