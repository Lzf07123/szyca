# 构建参数仅影响开发构建时的基础镜像与下载源；生产机直接拉取已完成镜像。
ARG BASE_IMAGE_REGISTRY=
ARG SOURCE_MIRROR=

FROM ${BASE_IMAGE_REGISTRY}node:20-alpine AS frontend
ARG SOURCE_MIRROR
WORKDIR /frontend
RUN if [ "$SOURCE_MIRROR" = "cn" ]; then \
        npm config set registry https://registry.npmmirror.com/; \
    fi
COPY frontend/package.json ./
RUN npm install --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM ${BASE_IMAGE_REGISTRY}golang:1.22-alpine AS backend
ARG SOURCE_MIRROR
WORKDIR /backend
RUN if [ "$SOURCE_MIRROR" = "cn" ]; then \
        go env -w GOPROXY=https://goproxy.cn,direct; \
    fi
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server

# 单容器运行时：Nginx + Go + PostgreSQL + Redis + Supervisor。
# 使用纯 Alpine 可避免官方 postgres 镜像继承的匿名数据卷。
FROM ${BASE_IMAGE_REGISTRY}alpine:3.20
ARG SOURCE_MIRROR

RUN if [ "$SOURCE_MIRROR" = "cn" ]; then \
        sed -i "s@dl-cdn.alpinelinux.org@mirrors.aliyun.com@g" /etc/apk/repositories; \
    fi \
    && apk add --no-cache ca-certificates nginx postgresql16 postgresql16-client redis supervisor su-exec tzdata \
    && adduser -D -H -s /sbin/nologin app \
    && mkdir -p /app/web /data/postgres /data/redis /data/uploads /run/nginx /run/postgresql \
    && rm -f /etc/nginx/http.d/default.conf

COPY --from=backend /out/server /app/server
COPY --from=frontend /frontend/dist /app/web
COPY deploy/nginx/nginx.conf /etc/nginx/http.d/default.conf
COPY deploy/supervisord.conf /etc/supervisord.conf
COPY deploy/single-entrypoint.sh /usr/local/bin/single-entrypoint.sh
RUN chmod +x /usr/local/bin/single-entrypoint.sh

ENV TZ=Asia/Shanghai \
    PGDATA=/data/postgres

EXPOSE 8080
STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/local/bin/single-entrypoint.sh"]
