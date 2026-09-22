// Isolated experiment only; never called by provisioning or release scripts.
// Targets must be freshly created private experiment Sprites, never customers.
import { spawn } from 'node:child_process';

const mode = process.argv[2];
if (!['serial', 'parallel', 'default', 'minimal'].includes(mode)) {
  throw new Error('Usage: node scripts/experiments/chrome-setup-benchmark.mjs serial|parallel|default|minimal');
}
const sprite = `aisar-exp-chrome-${mode}-20260918-${['default', 'minimal'].includes(mode) ? '02' : '01'}`;
const script = String.raw`
set -euo pipefail
export LC_ALL=C
test "$(uname -m)" = x86_64
test ! -d /home/sprite/.hermes
test ! -d /home/sprite/aisar
test ! -d /tmp/chrome-setup-benchmark
mkdir -m 700 /tmp/chrome-setup-benchmark
cd /tmp/chrome-setup-benchmark
now() { date +%s%N; }
elapsed() { echo "$1_ms=$(( ($(now)-$2)/1000000 ))"; }
prep=$(now)
timeout 120 npm install -g agent-browser@0.38.1 --no-fund --no-audit >npm.log 2>&1
export PATH="$(npm prefix -g)/bin:$PATH"
agent-browser --version
elapsed browser_cli_install "$prep"
deps() (
  start=$(now)
  timeout 120 sudo apt-get update >apt-update.log 2>&1
  elapsed apt_update "$start"
  resolve=$(now)
  dpkg-query -W -f='__OPEN__binary:Package}\n' | sort >packages-before.txt
  apt_flags=()
  if [ 'MODE' = minimal ]; then apt_flags+=(--no-install-recommends); fi
  packages=()
  for base in libxcb-shm0 libx11-xcb1 libx11-6 libxcb1 libxext6 libxrandr2 libxcomposite1 libxcursor1 libxdamage1 libxfixes3 libxi6 libgtk-3-0 libpangocairo-1.0-0 libpango-1.0-0 libatk1.0-0 libcairo-gobject2 libcairo2 libgdk-pixbuf-2.0-0 libxrender1 libasound2 libfreetype6 libfontconfig1 libdbus-1-3 libnss3 libnss3-tools libnspr4 libatk-bridge2.0-0 libdrm2 libxkbcommon0 libatspi2.0-0 libcups2 libxshmfence1 libgbm1 fonts-noto-color-emoji fonts-noto-cjk fonts-freefont-ttf; do
    case "$base" in
      libgtk-3-0|libpangocairo-1.0-0|libpango-1.0-0|libatk1.0-0|libcairo-gobject2|libcairo2|libgdk-pixbuf-2.0-0|libasound2|libdbus-1-3|libatk-bridge2.0-0|libatspi2.0-0|libcups2)
        if apt-cache show "__OPEN__base}t64" >/dev/null 2>&1; then base="__OPEN__base}t64"; fi ;;
    esac
    packages+=("$base")
  done
  timeout 30 sudo apt-get install --simulate "__OPEN__apt_flags[@]}" "__OPEN__packages[@]}" >apt-simulation.log 2>&1
  if grep '^Remv ' apt-simulation.log >/dev/null; then echo 'Package removal refused' >&2; exit 1; fi
  elapsed apt_resolve_and_simulate "$resolve"
  install=$(now)
  timeout 180 sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y "__OPEN__apt_flags[@]}" "__OPEN__packages[@]}" >apt-install.log 2>&1
  elapsed apt_install "$install"
  elapsed dependencies_total "$start"
  dpkg-query -W -f='__OPEN__binary:Package}\n' | sort >packages-after.txt
  comm -13 packages-before.txt packages-after.txt >packages-added.txt
  echo "packages_added=$(wc -l <packages-added.txt)"
  echo "installed_size_kb=$(dpkg-query -W -f='__OPEN__Installed-Size}\n' | awk '{n+=$1} END {print n}')"
)
chrome() (
  start=$(now)
  timeout 120 curl -fsSL https://storage.googleapis.com/chrome-for-testing-public/153.0.8010.47/linux64/chrome-linux64.zip -o chrome.zip
  elapsed chrome_download "$start"
  verify=$(now)
  echo '89778cbf7a852726b6f51649b2586b894c00737e81f8031733721560d21bbea7  chrome.zip' | sha256sum -c -
  elapsed chrome_verify "$verify"
  extract=$(now)
  node --input-type=module -e 'import {execFileSync} from "node:child_process"; execFileSync("unzip", ["-q", "chrome.zip", "-d", "browser"]);'
  test -x browser/chrome-linux64/chrome
  elapsed chrome_extract "$extract"
  elapsed chrome_total "$start"
)
start=$(now)
if [ "MODE" = parallel ]; then
  deps >deps-timings.log 2>&1 & deps_pid=$!
  chrome >chrome-timings.log 2>&1 & chrome_pid=$!
  failed=0
  wait "$deps_pid" || failed=1
  wait "$chrome_pid" || failed=1
  cat deps-timings.log chrome-timings.log
  test "$failed" = 0
else
  deps
  chrome
fi
elapsed combined_install "$start"
export AGENT_BROWSER_ENGINE=chrome
export AGENT_BROWSER_EXECUTABLE_PATH=/tmp/chrome-setup-benchmark/browser/chrome-linux64/chrome
smoke=$(now)
timeout 30 agent-browser open https://example.com
test "$(timeout 15 agent-browser get title)" = 'Example Domain'
timeout 15 agent-browser snapshot
test "$(timeout 15 agent-browser eval 'document.body.innerHTML = "<h1>Jentera rendering test</h1><p>Bahasa Melayu — 中文 — العربية — 😀</p><input id=field value=hello><canvas id=c width=100 height=100></canvas>"; let ctx=document.getElementById("c").getContext("2d"); ctx.fillStyle="red"; ctx.fillRect(0,0,100,100); document.getElementById("field").value === "hello" && ctx.getImageData(0,0,1,1).data[0] === 255')" = true
timeout 15 agent-browser screenshot /tmp/chrome-setup-benchmark/smoke.png
timeout 15 agent-browser pdf /tmp/chrome-setup-benchmark/smoke.pdf
node --input-type=module -e 'import {readFileSync} from "node:fs"; let p=readFileSync("smoke.pdf"); let s=readFileSync("smoke.png"); if(p.length<1000 || p.subarray(0,5).toString()!=="%PDF-" || s.length<1000 || s.subarray(1,4).toString()!=="PNG") process.exit(1);'
timeout 15 agent-browser close
timeout 30 agent-browser --profile /tmp/chrome-setup-benchmark/profile open https://example.com
timeout 15 agent-browser eval 'localStorage.setItem("jentera-bench", "persisted"); true'
timeout 15 agent-browser close
timeout 30 agent-browser --profile /tmp/chrome-setup-benchmark/profile open https://example.com
test "$(timeout 15 agent-browser eval 'localStorage.getItem("jentera-bench") === "persisted"')" = true
timeout 15 agent-browser close
echo 'persistent_profile_smoke=passed'
if command -v fc-match >/dev/null; then
  fc-match sans-serif
  fc-match ':lang=zh'
  fc-match ':lang=ar'
  fc-match emoji
else
  echo 'fc-match utility absent; verify fonts in screenshot instead'
fi
elapsed smoke "$smoke"
elapsed install_and_smoke "$start"
echo "mode=MODE"
`.replaceAll('MODE', mode).replaceAll('__OPEN__', '${');

const finishOnly = process.argv[3] === '--finish-after-deps';
const program = finishOnly ? String.raw`
set -euo pipefail
export LC_ALL=C
cd /tmp/chrome-setup-benchmark
export PATH="$(npm prefix -g)/bin:$PATH"
sort -o packages-before.txt packages-before.txt
sort -o packages-after.txt packages-after.txt
comm -13 packages-before.txt packages-after.txt >packages-added.txt
echo "packages_added=$(wc -l <packages-added.txt)"
echo "installed_size_kb=$(dpkg-query -W -f='__OPEN__Installed-Size}\n' | awk '{n+=$1} END {print n}')"
now() { date +%s%N; }
elapsed() { echo "$1_ms=$(( ($(now)-$2)/1000000 ))"; }
`.replaceAll('__OPEN__', '${') + script.slice(script.indexOf('chrome() ('), script.indexOf('\nstart=$(now)\nif')) + '\nstart=$(now)\nchrome\n' + script.slice(script.indexOf('export AGENT_BROWSER_ENGINE=chrome')) : script;

if (process.argv[3] === '--print') {
  process.stdout.write(program);
  process.exit(0);
}

const child = spawn('sprite', ['exec', '-o', 'aisar', '-s', sprite, '--', 'bash', '-s'], {
  stdio: ['pipe', 'inherit', 'inherit'],
});
child.stdin.end(program);
child.on('error', () => { process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
