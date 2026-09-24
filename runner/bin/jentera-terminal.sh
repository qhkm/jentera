#!/usr/bin/env bash
set -euo pipefail

# Keep provider and tenant identifiers out of the owner-facing prompt. This is
# presentation only: the sandbox still runs under its least-privileged OS user.
export USER=jentera
export LOGNAME=jentera
export PS1='jentera@computer:\w\$ '
export PS2='> '
unset PROMPT_COMMAND BASH_ENV

exec /bin/bash --noprofile --norc -i
