#!/bin/sh
# Start the Next.js standalone server. SERVER_JS is written by the image build.
set -eu
cd /app
rel=$(cat ./SERVER_JS)
exec node "$rel"
