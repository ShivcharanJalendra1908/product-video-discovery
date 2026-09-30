FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY src ./src
COPY scripts ./scripts
ENV MODEL_CACHE=/app/models PORT=7860 NODE_ENV=production
# Pre-download CLIP model at build time — eliminates runtime download OOM
RUN node scripts/preload-model.mjs
EXPOSE 7860
CMD ["node", "src/server.js"]
