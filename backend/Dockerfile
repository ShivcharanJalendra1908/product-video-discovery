FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY src ./src
ENV PORT=3001 MODEL_CACHE=/models
EXPOSE 3001
CMD ["node", "src/server.js"]
