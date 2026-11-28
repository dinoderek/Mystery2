FROM node:24-bookworm AS build
WORKDIR /app
COPY . .
RUN npm ci && npm -w web run build && npm prune --omit=dev --ignore-scripts

FROM node:24-bookworm-slim
WORKDIR /app/web
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=50000 \
    MYSTERY_CONFIG_ROOT=/data \
    MYSTERY_ALLOWED_HOSTS=localhost \
    MYSTERY_DATABASE=prod
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/blueprints /app/blueprints
COPY --from=build /app/blueprint-scenes /app/blueprint-scenes
COPY --from=build /app/web/build ./build
USER node
EXPOSE 50000
CMD ["node", "build/index.js"]
