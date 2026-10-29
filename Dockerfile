# syntax=docker/dockerfile:1
# The whole tool in one image: the web app, ffmpeg (from the ffmpeg-static package) and a Korean font for captions.
# Models (speech recognition, subject detection) are downloaded on first use into /app/.data, which should be a volume.
#
#   docker build -t cliplab .
#   docker run --rm -p 3000:3000 -v cliplab-data:/app/.data cliplab
#   (add  -e ANTHROPIC_API_KEY=...  for the AI features)
#
# The public demo is the same image built with --build-arg NEXT_PUBLIC_DEMO=1 (no video processing, no AI, no sign-in).

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG NEXT_PUBLIC_DEMO=
ENV NEXT_PUBLIC_DEMO=$NEXT_PUBLIC_DEMO
RUN npm run build

FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends fonts-nanum ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
# The app finds ffmpeg and its data under the working directory, so those stay in place; dev dependencies stay too because
# next.config.ts needs TypeScript when the server starts.
COPY --from=build /app/package.json /app/next.config.ts /app/tsconfig.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
RUN mkdir -p .data && chown -R node:node /app/.data
USER node
VOLUME ["/app/.data"]
EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
