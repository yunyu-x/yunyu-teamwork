# 云驭协同（Yunyu Teamwork）零依赖生产镜像
# 无 npm install：运行时仅使用 Node.js >= 22 内置模块
FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY bin ./bin
COPY src ./src
COPY web ./web
COPY plugins ./plugins
COPY examples ./examples

RUN mkdir -p /app/.yunyu && chown -R node:node /app

USER node

ENV NODE_ENV=production \
    YUNYU_DATA_DIR=/app/.yunyu

EXPOSE 4310

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4310/api/health || exit 1

CMD ["node", "bin/yunyu.mjs", "serve", "--host", "0.0.0.0", "--port", "4310"]