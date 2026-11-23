#!/usr/bin/env bash
# One existing OpenRouter chat-completions call, as a CLI binding.
set -euo pipefail
exec node "$(dirname "${BASH_SOURCE[0]}")/openrouter-runtime.ts" "$@"
