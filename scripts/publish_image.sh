#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
COMPOSE="docker compose -f $ROOT/deploy/docker-compose.yml -f $ROOT/deploy/docker-compose.build.yml"

cd "$ROOT"
IMAGE=$($COMPOSE config --images | head -n 1)

if [ -z "$IMAGE" ]; then
    echo "无法从 Compose 解析应用镜像名" >&2
    exit 1
fi

echo "构建镜像：$IMAGE"
$COMPOSE build quiz

if [ "${1:-}" = "--push" ]; then
    echo "推送镜像：$IMAGE"
    docker push "$IMAGE"
fi
