#!/usr/bin/env bash
# PreToolUse hook: bloqueia qualquer comando git. Exit 2 = block.
input="$(cat)"
cmd="$(printf '%s' "$input" | grep -oE '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1)"
if printf '%s' "$cmd" | grep -qiE '(^|[^[:alnum:]])git([^[:alnum:]]|$)'; then
  echo "BLOCKED: git é controlado por ti (timeline do pré-registo + segurança do .env)." >&2
  exit 2
fi
exit 0
