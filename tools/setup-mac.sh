#!/bin/bash
# One-time setup for building Samsung TV apps on an Apple Silicon Mac.
# Installs Samsung's signing tool (Tizen CLI) natively, with its own Java, into ~/tizen-studio,
# makes your signing certificate, and checks that the TV is reachable. Safe to run again.
set -euo pipefail
TV_IP="${1:-$(sed -n 's/^TV_IP=//p' "$(dirname "$0")/../config/tv.txt" 2>/dev/null | tr -d '[:space:]')}"
TV_IP="${TV_IP:-192.168.1.50}"   # an example address if none was given (the reachability check below will say so)
TS="$HOME/tizen-studio"; DATA="$HOME/tizen-studio-data"; JDK="$TS/jdk"
BASE="https://download.tizen.org/sdk/tizenstudio/official"
PROFILE="TVHome"
step() { printf '\n== %s\n' "$1"; }

step "1/5 Checking Apple's command line tools (Python)"
if ! xcode-select -p >/dev/null 2>&1 || ! python3 -c 1 2>/dev/null; then
  echo "Not installed yet. Run:  xcode-select --install   then run this script again."; exit 1
fi
echo "OK: $(python3 --version)"

step "2/5 Java 17 for Apple Silicon"
if [ -x "$JDK/Contents/Home/bin/java" ]; then echo "Already installed."; else
  TMP=$(mktemp -d)
  read -r URL SUM < <(curl -fsSL "https://api.adoptium.net/v3/assets/latest/17/hotspot?os=mac&architecture=aarch64&image_type=jdk&vendor=eclipse" \
    | python3 -c 'import json,sys;p=[a for a in json.load(sys.stdin) if a["binary"]["package"]["link"].endswith(".tar.gz")][0]["binary"]["package"];print(p["link"],p["checksum"])')
  curl -fL --progress-bar -o "$TMP/jdk.tar.gz" "$URL"
  echo "$SUM  $TMP/jdk.tar.gz" | shasum -a 256 -c -
  mkdir -p "$JDK"; tar -xzf "$TMP/jdk.tar.gz" -C "$JDK" --strip-components 1; rm -rf "$TMP"
fi
"$JDK/Contents/Home/bin/java" -version 2>&1 | head -1

step "3/5 Samsung's Tizen command line tools"
if [ -x "$TS/tools/ide/bin/tizen" ]; then echo "Already installed."; else
  TMP=$(mktemp -d)
  while read -r ZIP SUM; do
    echo "Downloading $ZIP"
    curl -fL --progress-bar -o "$TMP/$ZIP" "$BASE/binary/$ZIP"
    echo "$SUM  $TMP/$ZIP" | shasum -a 256 -c -
    rm -rf "$TMP/x"; unzip -q -o "$TMP/$ZIP" 'data/*' -d "$TMP/x"
    mkdir -p "$TS"; cp -R "$TMP/x/data/." "$TS/"
  done <<LIST
sdk-utils_0.2.26_macos-64.zip 975c317a400016e270cc6a9e64d0bc58471ee31f899a7d1e437efe4973099b2f
sdk-utils-core_0.2.26_macos-64.zip 526809359ad8eb327362d651c550598276736e641ad88ef74da8a5ddff9534b0
certificate-generator_0.1.4_macos-64.zip ca9e2c04423192e5cf42214c480c439af17999d6ff3331426937c39874e3a357
new-common-cli_2.5.107_macos-64.zip dbc373fa7294ab747623f10660360069caca6f952f269615a8f43494e5868d95
LIST
  rm -rf "$TMP"
fi
printf 'TIZEN_SDK_INSTALLED_PATH=%s\nTIZEN_SDK_DATA_PATH=%s\nJDK_PATH=%s\n' "$TS" "$DATA" "$JDK" > "$TS/sdk.info"
mkdir -p "$DATA"
TIZEN="$TS/tools/ide/bin/tizen"
"$TIZEN" version

step "4/5 Your signing certificate (profile \"$PROFILE\")"
if "$TIZEN" security-profiles list 2>/dev/null | grep -qw "$PROFILE"; then echo "Already made."; else
  echo "Pick a password for your certificate (8+ characters). Keep it somewhere safe:"
  echo "every update to the app must be signed with this same certificate."
  read -r -s -p "Password: " PW; echo
  read -r -s -p "Again:    " PW2; echo
  [ "$PW" = "$PW2" ] || { echo "The passwords didn't match. Run the script again."; exit 1; }
  "$TIZEN" certificate -a "$PROFILE" -p "$PW" -f "$PROFILE"
  P12=$(find "$DATA/keystore" -name "$PROFILE.p12" | head -1)
  "$TIZEN" security-profiles add -n "$PROFILE" -a "$P12" -p "$PW"
  "$TIZEN" cli-config "profiles.path=$DATA/profile/profiles.xml"
  unset PW PW2
fi
"$TIZEN" security-profiles list

step "5/5 Can this Mac reach the TV at $TV_IP?"
if nc -z -G 3 "$TV_IP" 26101 2>/dev/null; then echo "Yes: the TV's Developer Mode is answering."
else echo "Not yet. On the TV: Apps, type 1 2 3 4 5, Developer mode On, Host PC IP = $(ipconfig getifaddr en0 2>/dev/null || echo "this Mac's IP"), then restart the TV."; fi

printf '\nSetup finished.\n'
