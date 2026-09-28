#!/usr/bin/env bash
# One-command Botanical start: Docker Compose, secrets, optional coding CLIs.
# Linux / macOS. Re-running keeps existing .env values.
#
#   ./start.sh
#   ./start.sh --yes          # accept defaults (no prompts)
#   ./start.sh --yes --no-cli # defaults, without docker-compose.cli.yml
set -euo pipefail

ROOT=$(cd "$(dirname "$0")" && pwd)
cd "$ROOT"
ENV_FILE="$ROOT/.env"
EXAMPLE_FILE="$ROOT/.env.example"

YES=0
NO_CLI=0
SKIP_UP=0

usage() {
  cat <<'EOF'
Start Botanical with Docker Compose.

  ./start.sh
  ./start.sh --yes
  ./start.sh --yes --no-cli

  --yes, -y, -Yes   Accept defaults (port 3000, include coding CLIs, skip API key)
  --no-cli, -NoCli  Do not use docker-compose.cli.yml
EOF
}

for arg in "$@"; do
  case "$arg" in
    --yes|-y|-Yes) YES=1 ;;
    --no-cli|-NoCli) NO_CLI=1 ;;
    --skip-up) SKIP_UP=1 ;;
    -h|--help) usage; exit 0 ;;
    *)
      echo "start.sh: unknown argument: $arg" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ -n "${BOTANICAL_START_SKIP_UP:-}" ]; then
  SKIP_UP=1
fi

# Shell values win over .env for this run (and are written back).
SHELL_PROJECT="${COMPOSE_PROJECT_NAME-}"
SHELL_WEB_PORT="${WEB_PORT-}"
SHELL_SERVER_PORT="${SERVER_PORT-}"
SHELL_POSTGRES_PORT="${POSTGRES_PORT-}"
SHELL_PUBLIC_ORIGIN="${BOTANICAL_PUBLIC_ORIGIN-}"

die() {
  echo "start.sh: $*" >&2
  exit 1
}

require_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    die "Docker is not installed. Install Docker and retry."
  fi
  if ! docker info >/dev/null 2>&1; then
    die "Docker is installed but the daemon is not running. Start Docker and retry."
  fi
  if ! docker compose version >/dev/null 2>&1; then
    die "docker compose (v2) is not available. Install the Compose v2 plugin and retry."
  fi
}

rand_b64_32() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 32 | tr -d '\n'
  else
    dd if=/dev/urandom bs=32 count=1 2>/dev/null | base64 | tr -d '\n'
  fi
}

rand_hex_24() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 24 | tr -d '\n'
  else
    dd if=/dev/urandom bs=24 count=1 2>/dev/null | od -An -tx1 | tr -d ' \n'
  fi
}

is_placeholder() {
  case "${1:-}" in
    ''|change-me|change-me-*|*"change-me"*) return 0 ;;
    *) return 1 ;;
  esac
}

# Last uncommented KEY=value in .env (value may contain '=').
env_get() {
  local key="$1"
  local line value=""
  [ -f "$ENV_FILE" ] || { printf '%s' ""; return 0; }
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      "$key"=*) value="${line#*=}" ;;
    esac
  done < "$ENV_FILE"
  case "$value" in
    \"*\") value="${value#\"}"; value="${value%\"}" ;;
    \'*\') value="${value#\'}"; value="${value%\'}" ;;
  esac
  printf '%s' "$value"
}

env_set() {
  local key="$1"
  local value="$2"
  local tmp found=0 line
  tmp=$(mktemp)
  if [ -f "$ENV_FILE" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
      case "$line" in
        "$key"=*)
          printf '%s=%s\n' "$key" "$value" >> "$tmp"
          found=1
          ;;
        *)
          printf '%s\n' "$line" >> "$tmp"
          ;;
      esac
    done < "$ENV_FILE"
  fi
  if [ "$found" -eq 0 ]; then
    printf '%s=%s\n' "$key" "$value" >> "$tmp"
  fi
  mv "$tmp" "$ENV_FILE"
}

ensure_env_file() {
  if [ ! -f "$EXAMPLE_FILE" ]; then
    die "missing $EXAMPLE_FILE"
  fi
  if [ ! -f "$ENV_FILE" ]; then
    cp "$EXAMPLE_FILE" "$ENV_FILE"
    echo "Created .env from .env.example"
  fi
}

fill_generated_secrets() {
  local key pw url user hostpart prefix userpass pass db

  key=$(env_get BOTANICAL_ENCRYPTION_KEY)
  if is_placeholder "$key"; then
    key=$(rand_b64_32)
    env_set BOTANICAL_ENCRYPTION_KEY "$key"
    echo "Generated BOTANICAL_ENCRYPTION_KEY"
  fi

  key=$(env_get BOTANICAL_SESSION_SECRET)
  if is_placeholder "$key"; then
    key=$(rand_b64_32)
    env_set BOTANICAL_SESSION_SECRET "$key"
    echo "Generated BOTANICAL_SESSION_SECRET"
  fi

  pw=$(env_get POSTGRES_PASSWORD)
  if is_placeholder "$pw"; then
    pw=$(rand_hex_24)
    env_set POSTGRES_PASSWORD "$pw"
    echo "Generated POSTGRES_PASSWORD"
  fi

  url=$(env_get DATABASE_URL)
  user=$(env_get POSTGRES_USER)
  [ -n "$user" ] || user=botanical
  db=$(env_get POSTGRES_DB)
  [ -n "$db" ] || db=botanical
  if [ -z "$url" ] || is_placeholder "$url"; then
    env_set DATABASE_URL "postgresql://${user}:${pw}@postgres:5432/${db}"
    echo "Updated DATABASE_URL to match POSTGRES_PASSWORD"
    return 0
  fi
  case "$url" in
    *://*@postgres[:/]*)
      prefix="${url%%://*}://"
      hostpart="${url#*://}"
      userpass="${hostpart%%@*}"
      hostpart="${hostpart#*@}"
      pass="${userpass#*:}"
      user="${userpass%%:*}"
      if [ "$pass" != "$pw" ]; then
        env_set DATABASE_URL "${prefix}${user}:${pw}@${hostpart}"
        echo "Updated DATABASE_URL to match POSTGRES_PASSWORD"
      fi
      ;;
  esac
}

prompt_line() {
  local prompt="$1"
  local default="$2"
  local reply
  if [ "$YES" -eq 1 ]; then
    printf '%s' "$default"
    return 0
  fi
  printf '%s' "$prompt" >&2
  IFS= read -r reply || reply=""
  if [ -z "$reply" ]; then
    printf '%s' "$default"
  else
    printf '%s' "$reply"
  fi
}

prompt_secret() {
  local prompt="$1"
  local reply
  if [ "$YES" -eq 1 ]; then
    printf '%s' ""
    return 0
  fi
  printf '%s' "$prompt" >&2
  IFS= read -r -s reply || reply=""
  printf '\n' >&2
  printf '%s' "$reply"
}

ask_user_settings() {
  local port include reply provider key origin current_port

  current_port=$(env_get WEB_PORT)
  [ -n "$current_port" ] || current_port=3000
  if [ -n "$SHELL_WEB_PORT" ]; then
    port="$SHELL_WEB_PORT"
  else
    port=$(prompt_line "Web port [$current_port]: " "$current_port")
  fi
  case "$port" in
    ''|*[!0-9]*) die "web port must be a number, got: $port" ;;
  esac
  env_set WEB_PORT "$port"

  origin=$(env_get BOTANICAL_PUBLIC_ORIGIN)
  if [ -n "$SHELL_PUBLIC_ORIGIN" ]; then
    env_set BOTANICAL_PUBLIC_ORIGIN "$SHELL_PUBLIC_ORIGIN"
  else
    case "$origin" in
      ''|http://localhost:*|http://127.0.0.1:*)
        env_set BOTANICAL_PUBLIC_ORIGIN "http://localhost:${port}"
        ;;
    esac
  fi

  if [ -n "$SHELL_SERVER_PORT" ]; then
    env_set SERVER_PORT "$SHELL_SERVER_PORT"
  fi
  if [ -n "$SHELL_POSTGRES_PORT" ]; then
    env_set POSTGRES_PORT "$SHELL_POSTGRES_PORT"
  fi

  if [ "$NO_CLI" -eq 1 ]; then
    include=0
  elif [ "$YES" -eq 1 ]; then
    include=1
  else
    reply=$(prompt_line "Include coding CLIs (Grok Build / Claude Code / Codex)? [Y/n]: " "Y")
    case "$reply" in
      n|N|no|NO) include=0 ;;
      *) include=1 ;;
    esac
  fi

  if [ "$YES" -eq 0 ]; then
    printf '%s\n' "Optional provider API key. Press Enter to skip; you can add keys later in Settings." >&2
    provider=$(prompt_line "Provider [deepseek]: " "deepseek")
    key=$(prompt_secret "API key (hidden, Enter to skip): ")
    if [ -n "$key" ]; then
      case "$(printf '%s' "$provider" | tr '[:upper:]' '[:lower:]')" in
        openai) env_set OPENAI_API_KEY "$key" ;;
        anthropic|claude) env_set ANTHROPIC_API_KEY "$key" ;;
        xai|grok) env_set XAI_API_KEY "$key" ;;
        openrouter) env_set OPENROUTER_API_KEY "$key" ;;
        compat|openai-compat|openai_compat)
          env_set OPENAI_COMPAT_API_KEY "$key"
          ;;
        *) env_set DEEPSEEK_API_KEY "$key" ;;
      esac
      echo "Saved provider API key"
    fi
  fi

  INCLUDE_CLI=$include
}

wait_for_web() {
  local port="$1"
  local url="http://127.0.0.1:${port}/login"
  local i code
  command -v curl >/dev/null 2>&1 || die "curl is required to wait for the web app"
  echo "Waiting for the web app at $url ..."
  i=0
  while [ "$i" -lt 180 ]; do
    code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 3 "$url" 2>/dev/null || printf '000')
    case "$code" in
      200|301|302|303|307|308)
        echo "Web app is up."
        return 0
        ;;
    esac
    i=$((i + 1))
    sleep 5
  done
  die "timed out waiting for $url. Check: docker compose -p ${COMPOSE_PROJECT_NAME} logs"
}

open_browser() {
  local url="$1"
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url" >/dev/null 2>&1 || true
  elif command -v open >/dev/null 2>&1; then
    open "$url" >/dev/null 2>&1 || true
  fi
}

require_docker
ensure_env_file
fill_generated_secrets

if [ -n "$SHELL_PROJECT" ]; then
  project="$SHELL_PROJECT"
else
  project=$(env_get COMPOSE_PROJECT_NAME)
  [ -n "$project" ] || project=botanical-mvp
fi
export COMPOSE_PROJECT_NAME="$project"
if [ -z "$(env_get COMPOSE_PROJECT_NAME)" ]; then
  env_set COMPOSE_PROJECT_NAME "$project"
fi

INCLUDE_CLI=0
ask_user_settings
WEB_PORT=$(env_get WEB_PORT)
[ -n "$WEB_PORT" ] || WEB_PORT=3000

if [ "$SKIP_UP" -eq 1 ]; then
  echo "Skipping docker compose (--skip-up)."
  exit 0
fi

compose_files=(-f docker-compose.yml)
if [ "$INCLUDE_CLI" -eq 1 ]; then
  compose_files+=(-f docker-compose.cli.yml)
fi

echo "Starting Compose project '$project' (web port $WEB_PORT)..."
docker compose -p "$project" "${compose_files[@]}" up --build -d

wait_for_web "$WEB_PORT"

url="http://localhost:${WEB_PORT}"
echo
echo "Botanical is running at $url"
echo "The first account to sign up becomes the admin."
if [ "$INCLUDE_CLI" -eq 1 ]; then
  echo "Stop with: docker compose -p $project -f docker-compose.yml -f docker-compose.cli.yml down"
else
  echo "Stop with: docker compose -p $project down"
fi
open_browser "$url"
