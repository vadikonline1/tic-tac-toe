# TIC-TAK-TOK — productie pe un singur port (default 8000)
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . ./
# date runtime NU se coc in imagine (se monteaza ca volume, vezi compose)
RUN rm -rf node_modules/.cache outbox && mkdir -p outbox
EXPOSE 8000
ENV PORT=8000
CMD ["node", "server.js"]
