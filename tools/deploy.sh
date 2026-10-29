#!/bin/bash
# Builds, signs and installs BigTuna Home on the TV in one go. Optional: the TV's IP (default: TV_IP in config/tv.txt).
set -e
cd "$(dirname "$0")/.."
python3 tools/build.py
python3 tools/install.py "$@"
