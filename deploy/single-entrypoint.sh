#!/bin/sh
set -eu

mkdir -p /data/postgres /data/redis /data/uploads /run/nginx
chown postgres:postgres /data /data/postgres
chown redis:redis /data/redis
chown app:app /data/uploads
chown -R postgres:postgres /run/postgresql

if [ ! -s "$PGDATA/PG_VERSION" ]; then
    password_file=$(mktemp)
    printf '%s\n' "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}" > "$password_file"
    chown postgres:postgres "$password_file"
    su-exec postgres initdb \
        -D "$PGDATA" \
        -U "${POSTGRES_USER:-szyca}" \
        --pwfile="$password_file" \
        --auth-local=trust \
        --auth-host=scram-sha-256
    rm -f "$password_file"
fi

su-exec postgres pg_ctl -D "$PGDATA" -w -o "-c listen_addresses='' -c port=5432" start
if ! su-exec postgres psql -h /run/postgresql -U "${POSTGRES_USER:-szyca}" -d postgres -Atc \
    "SELECT 1 FROM pg_database WHERE datname = '${POSTGRES_DB:-szyca}'" | grep -q 1; then
    su-exec postgres createdb -h /run/postgresql -U "${POSTGRES_USER:-szyca}" "${POSTGRES_DB:-szyca}"
fi
su-exec postgres pg_ctl -D "$PGDATA" -w -m fast stop

exec /usr/bin/supervisord -c /etc/supervisord.conf
