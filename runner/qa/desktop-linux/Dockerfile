# Isolated test infrastructure only; never used to alter a customer Sprite.
FROM node:22-bookworm-slim
RUN apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    chromium xvfb openbox dbus x11vnc tint2 xterm xauth x11-utils xdotool python3 libxtst6 ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN install -d -o node -g node /home/sprite/aisar/runner
ENV DISPLAY=:99 PLAYWRIGHT_ENTRY=/workspace/app/node_modules/playwright/index.mjs DESKTOP_SMOKE_CHROMIUM=/usr/bin/chromium
WORKDIR /workspace
USER node
CMD ["bash", "runner/qa/desktop-linux/start.sh"]
