FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/package.json
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci
COPY shared shared
COPY backend backend
RUN npm run build --workspace=@wayfinder/protocol && npm run build --workspace=@wayfinder/backend
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/shared ./shared
COPY --from=build /app/backend/package.json ./backend/package.json
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/backend/migrations ./backend/migrations
EXPOSE 3001
USER node
CMD ["node","backend/dist/server.js"]
