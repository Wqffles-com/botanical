#!/bin/sh
# First-boot only. Application schema belongs to packages/db, not this image.
set -eu

case "$POSTGRES_DB" in
  *[!A-Za-z0-9_]*)
    echo "botanical: skip timezone; POSTGRES_DB is not a plain identifier" >&2
    exit 0
    ;;
esac

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -c "ALTER DATABASE \"${POSTGRES_DB}\" SET timezone TO 'UTC';"
