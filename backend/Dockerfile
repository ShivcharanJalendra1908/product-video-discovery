FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY src ./src
ENV PORT=7860 MODEL_CACHE=/app/models NODE_ENV=production
# Pre-download CLIP model at build time so runtime has zero download overhead
RUN node --input-type=module <<'EOF'
import { pipeline, env } from '@xenova/transformers';
env.cacheDir = '/app/models';
console.log('Downloading CLIP model...');
await pipeline('image-feature-extraction', 'Xenova/clip-vit-base-patch32');
console.log('Done.');
EOF
EXPOSE 7860
CMD ["node", "src/server.js"]
