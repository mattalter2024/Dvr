# Stage 1: Build Comskip from source for automatic OTA commercial detection
FROM debian:bookworm-slim AS comskip-builder
RUN apt-get update && apt-get install -y --no-install-recommends \
    git build-essential autoconf automake libtool pkg-config ca-certificates \
    libargtable2-dev libavformat-dev libavcodec-dev libavutil-dev libswscale-dev \
    && rm -rf /var/lib/apt/lists/*

RUN git clone --depth 1 https://github.com/erikkaashoek/Comskip.git /tmp/comskip \
    && cd /tmp/comskip \
    && ./autogen.sh \
    && ./configure \
    && make -j"$(nproc)" \
    && make install

# Stage 2: Build AirVault DVR Backend + 10-Foot Smart TV Web UI
FROM node:22-bookworm-slim AS app-builder
WORKDIR /app
COPY package.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN npm install
COPY server ./server
COPY web ./web
RUN npm run build

# Stage 3: Production Whole-House OTA DVR Runtime (Node 22 + FFmpeg + Comskip)
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg libargtable2-0 libavformat59 libavcodec59 libavutil57 libswscale6 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=comskip-builder /usr/local/bin/comskip /usr/local/bin/comskip

WORKDIR /app
COPY --from=app-builder /app/package.json ./
COPY --from=app-builder /app/node_modules ./node_modules
COPY --from=app-builder /app/server/package.json ./server/
COPY --from=app-builder /app/server/comskip.ini ./server/
COPY --from=app-builder /app/server/dist ./server/dist
COPY --from=app-builder /app/web/dist ./web/dist

ENV NODE_ENV=production
ENV PORT=8096
ENV DATA_DIR=/data
ENV RECORDINGS_DIR=/recordings
ENV COMSKIP_PATH=/usr/local/bin/comskip
ENV COMSKIP_INI_PATH=/app/server/comskip.ini

VOLUME ["/data", "/recordings"]
EXPOSE 8096/tcp 41234/udp

CMD ["node", "server/dist/index.js"]
