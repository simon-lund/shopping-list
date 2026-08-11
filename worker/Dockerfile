FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY baileys.mjs ./
# The WhatsApp session lives here — it is a full account credential, so the
# process that holds it runs unprivileged. Mount a volume or you re-pair on
# every deploy.
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME /data
CMD ["node", "baileys.mjs"]
