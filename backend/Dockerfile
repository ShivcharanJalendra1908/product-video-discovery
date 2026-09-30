FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY src ./src
ENV PORT=7860 MODEL_CACHE=/models
EXPOSE 7860
CMD ["node", "src/server.js"]
