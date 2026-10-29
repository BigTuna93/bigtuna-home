#!/usr/bin/env python3
"""Asks the test build on the TV a question (a piece of JavaScript) and prints the answer. Needs report-server.py running.

    python3 tools/ask.py "1 + 1"
    python3 tools/ask.py "tizen.systeminfo.getPropertyValue('MEMORY', function (m) { done(m.availableCapacity); })"

The code may return a value, or call done(value) later. Test builds only.
"""
import json
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPORTS = os.path.join(ROOT, 'build', 'tv-reports')


def ask(code, wait=20):
    latest = os.path.join(REPORTS, 'latest.json')
    before = os.path.getmtime(latest) if os.path.exists(latest) else 0
    with open(os.path.join(REPORTS, 'command.txt'), 'w', encoding='utf-8') as f:
        f.write('eval ' + code.replace('\n', ' '))
    end = time.time() + wait
    while time.time() < end:
        if os.path.exists(latest) and os.path.getmtime(latest) > before:
            try:
                with open(latest, encoding='utf-8') as f:
                    r = json.load(f)
            except ValueError:
                time.sleep(0.2)
                continue
            if r.get('reason') == 'answer':
                return r.get('answer')
            before = os.path.getmtime(latest)
        time.sleep(0.2)
    return 'no answer (is the test build on the TV and report-server.py running?)'


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    print(json.dumps(ask(sys.argv[1]), indent=1, ensure_ascii=False))
