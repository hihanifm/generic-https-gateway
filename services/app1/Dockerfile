FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY server.js ./

ARG PORT=33101
EXPOSE ${PORT}

CMD ["npm", "start"]
