#!/usr/bin/env bash
set -euo pipefail

# The real upstream CLI, pinned independently of Hermes. Public bytes only;
# never configure Google OAuth or copy a Google credential onto a Sprite.
gws_dir="${1:-/home/sprite/.local/lib/jentera-gws}"
case "$(uname -m)" in
  x86_64)
    gws_arch=x86_64
    archive_sha=de78ecdbd2f1a84cca0063a7ecbc440240fc14b6ebccbb17f4646b792a8c5c1f
    binary_sha=ab59c4bab4e7848740ba8cc3ef186152dab90121c45835b49bd1bf2a5c259b86
    ;;
  aarch64|arm64)
    gws_arch=aarch64
    archive_sha=94490295d9580e1e88574e715a0a162991747d12d62f8c7b8dcc8268b6c1cea0
    binary_sha=b68337faf1436fb2b3a287207cd57fef784a20fb4ab4f2429e51c4e0cfa0b50b
    ;;
  *) echo 'Unsupported gws runtime architecture' >&2; exit 1 ;;
esac
if [[ -x "$gws_dir/gws" ]]; then
  installed_sha="$(sha256sum "$gws_dir/gws")"
  if [[ "${installed_sha%% *}" == "$binary_sha" ]]; then exit 0; fi
fi
gws_tmp="$(mktemp -d /tmp/jentera-gws-install.XXXXXX)"
trap 'keep=$?; rm -f "$gws_tmp/archive.tar.gz" "$gws_tmp/gws"; rmdir "$gws_tmp"; exit $keep' EXIT
curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
  --tlsv1.2 --connect-timeout 10 --max-time 90 --retry 2 \
  "https://github.com/googleworkspace/cli/releases/download/v0.22.5/google-workspace-cli-${gws_arch}-unknown-linux-gnu.tar.gz" \
  --output "$gws_tmp/archive.tar.gz"
printf '%s  %s\n' "$archive_sha" "$gws_tmp/archive.tar.gz" | sha256sum --check --status
tar -xzf "$gws_tmp/archive.tar.gz" -C "$gws_tmp" ./gws
printf '%s  %s\n' "$binary_sha" "$gws_tmp/gws" | sha256sum --check --status
install -d -m 755 "$gws_dir"
install -m 755 "$gws_tmp/gws" "$gws_dir/gws"
[[ "$("$gws_dir/gws" --version | head -n 1)" == 'gws 0.22.5' ]]
