#!/bin/bash
# Opens BigTuna Home in your browser with real movie data. Control-C to stop.
cd "$(dirname "$0")/.."
python3 tools/build.py --preview
