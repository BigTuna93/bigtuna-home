#!/usr/bin/env python3
"""Receives the reports a test build of BigTuna Home sends from the TV (apps, logos, timings, errors).

    python3 tools/report-server.py 192.168.1.50      # the TV's IP: only reports from it are accepted
    python3 tools/report-server.py 127.0.0.1         # for testing with the browser preview

Each report is saved as build/tv-reports/latest.json (plus a timestamped copy). Control-C to stop.
For testing without the remote: write one instruction into build/tv-reports/command.txt ("open <app id>" or
"key <key code>"); the test build picks it up within a few seconds and the file is removed.
macOS may ask whether Python may accept incoming connections: Allow (only needed while this runs).
"""
import http.server
import json
import os
import socket
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'build', 'tv-reports')
PORT = 8766
MAX = 2 * 1024 * 1024


def this_mac(towards):
    """This Mac's address on the network the TV is on."""
    if towards.startswith('127.'):
        return '127.0.0.1'
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.connect((towards, 9))
    return s.getsockname()[0]


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    tv = sys.argv[1]
    os.makedirs(OUT, exist_ok=True)

    class Handler(http.server.BaseHTTPRequestHandler):
        def _headers(self, code):
            self.send_response(code)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type')
            self.send_header('Content-Length', '0')
            self.end_headers()

        def do_OPTIONS(self):
            self._headers(204)

        def do_GET(self):
            ip = self.client_address[0]
            if not (ip == tv or (tv.startswith('127.') and ip.startswith('127.'))) or self.path != '/command':
                self._headers(403)
                return
            path = os.path.join(OUT, 'command.txt')
            text = ''
            if os.path.exists(path):
                with open(path, encoding='utf-8') as f:
                    text = f.read().strip()
                os.remove(path)
                print('%s  sent instruction: %s' % (time.strftime('%H:%M:%S'), text))
                sys.stdout.flush()
            body = text.encode('utf-8')
            self.send_response(200 if body else 204)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            ip = self.client_address[0]
            if not (ip == tv or (tv.startswith('127.') and ip.startswith('127.'))) or self.path != '/report':
                self._headers(403)
                return
            n = int(self.headers.get('Content-Length') or 0)
            if not 0 < n <= MAX:
                self._headers(413)
                return
            body = self.rfile.read(n)
            try:
                report = json.loads(body.decode('utf-8'))
            except ValueError:
                self._headers(400)
                return
            stamp = time.strftime('%H%M%S')
            text = json.dumps(report, indent=1, ensure_ascii=False)
            for name in ('latest.json', 'report-%s.json' % stamp):
                with open(os.path.join(OUT, name), 'w', encoding='utf-8') as f:
                    f.write(text)
            k = report.get('keys', {})
            print('%s  report (%s): %d key presses, %d slow frames, %d errors%s' % (
                time.strftime('%H:%M:%S'), report.get('reason', '?'), k.get('count', 0),
                report.get('frames', {}).get('slow', 0), len(report.get('errors', [])),
                ('  | last note: ' + report['notes'][-1]) if report.get('notes') else ''))
            sys.stdout.flush()
            self._headers(204)

        def log_message(self, *args):
            pass

    host = this_mac(tv)
    server = http.server.ThreadingHTTPServer((host, PORT), Handler)
    print('Waiting for reports from %s at http://%s:%d/report (saved in build/tv-reports). Control-C to stop.' % (tv, host, PORT))
    sys.stdout.flush()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nStopped.')


if __name__ == '__main__':
    main()
