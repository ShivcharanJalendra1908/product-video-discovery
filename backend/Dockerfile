FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY scripts ./scripts
COPY src ./src
ENV MODEL_CACHE=/app/models PORT=7860 NODE_ENV=production
# v3 - pre-download CLIP model; update version to bust Docker cache
RUN MODEL_CACHE=/app/models node scripts/preload-model.mjs
EXPOSE 7860
CMD ["node", "--max-old-space-size=350", "src/server.js"]
