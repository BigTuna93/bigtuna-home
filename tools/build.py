#!/usr/bin/env python3
"""Builds BigTuna Home: build/BigTunaHome.wgt, signed and ready for the TV.

    python3 tools/build.py            # build and sign with the TVHome certificate
    python3 tools/build.py --preview  # build only, then open build/BigTunaHome/index.html in a browser (real data)
    python3 tools/build.py --diag http://192.168.1.20:8766    # a TEST build that sends reports to that address (your Mac)
                                                              # (receive them with tools/report-server.py)

Your API keys come from config/keys.txt and go only into the build folder, never into app/.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, 'app')
OUT = os.path.join(ROOT, 'build', 'BigTunaHome')
WGT = os.path.join(ROOT, 'build', 'BigTunaHome.wgt')
PROFILE = 'TVHome'


def keys():
    path = os.path.join(ROOT, 'config', 'keys.txt')
    found = {}
    if os.path.exists(path):
        with open(path, encoding='utf-8') as f:
            for line in f:
                m = re.match(r'\s*(TMDB_READ_TOKEN|OMDB_KEY)\s*=\s*(\S*)', line)
                if m:
                    found[m.group(1)] = m.group(2)
    tmdb, omdb = found.get('TMDB_READ_TOKEN', ''), found.get('OMDB_KEY', '')
    if not tmdb or not omdb:
        print('Note: config/keys.txt is missing a key, so the app will show sample movies.')
    return tmdb, omdb


def tizen_cli():
    path = os.path.join(os.path.expanduser('~'), 'tizen-studio', 'tools', 'ide', 'bin', 'tizen')
    return path if os.path.exists(path) else shutil.which('tizen')


def build_folder(diag=None):
    if os.path.exists(OUT):
        shutil.rmtree(OUT)
    shutil.copytree(APP, OUT, ignore=shutil.ignore_patterns('.DS_Store'))
    write_diag(diag)
    tmdb, omdb = keys()
    with open(os.path.join(OUT, 'js', 'keys.js'), 'w', encoding='utf-8') as f:
        f.write('window.KEYS = {tmdb: %r, omdb: %r};\n' % (tmdb, omdb))
    # The browser preview reloads itself when this changes (the TV ignores it).
    with open(os.path.join(OUT, 'version.txt'), 'w', encoding='utf-8') as f:
        f.write(str(time.time()))


def write_diag(url):
    """Normal builds: reporting off. Test builds: the report address, and permission to reach only that address."""
    with open(os.path.join(OUT, 'js', 'diag-config.js'), 'w', encoding='utf-8') as f:
        f.write('window.DIAG = %s;\n' % (json.dumps({'url': url.rstrip('/') + '/report'}) if url else 'null'))
    if not url:
        # The test code isn't needed: a stand-in with the same (empty) answers, so the TV loads less.
        with open(os.path.join(OUT, 'js', 'diag.js'), 'w', encoding='utf-8') as f:
            f.write('/* Test builds only (see app/js/diag.js); off in this build. */\n'
                    'var Diag = {on: false, attach: function () {}, note: function () {}};\n')
        return
    m = re.match(r'^(http://(?:\d{1,3}\.){3}\d{1,3}:\d{2,5})/?$', url)
    if not m:
        sys.exit('--diag needs an address like http://192.168.1.20:8766')
    origin = m.group(1)
    page = os.path.join(OUT, 'index.html')
    with open(page, encoding='utf-8') as f:
        html = f.read()
    html = html.replace('connect-src ', 'connect-src %s %s ' % (origin, origin.rsplit(':', 1)[0]), 1)
    html = html.replace("script-src 'self'", "script-src 'self' 'unsafe-eval'", 1)   # the Mac's questions (diag.js)
    with open(page, 'w', encoding='utf-8') as f:
        f.write(html)
    manifest = os.path.join(OUT, 'config.xml')
    with open(manifest, encoding='utf-8') as f:
        xml = f.read()
    # The TV may not match an address with a port, so test builds also list it without one, and allow any address
    # (test builds only: normal builds keep the strict list in app/config.xml).
    plain = origin.rsplit(':', 1)[0]
    extra = ''.join('    <access origin="%s" subdomains="false"/>\n' % o for o in (origin, plain))
    extra += '    <access origin="*" subdomains="true"/>\n'
    xml = xml.replace('    <tizen:privilege', extra + '    <tizen:privilege', 1)
    with open(manifest, 'w', encoding='utf-8') as f:
        f.write(xml)
    print('TEST build: reports go to %s/report' % origin)


def package():
    if os.path.exists(WGT):
        os.remove(WGT)
    with zipfile.ZipFile(WGT, 'w', zipfile.ZIP_DEFLATED) as z:
        for base, _, files in os.walk(OUT):
            for name in sorted(files):
                full = os.path.join(base, name)
                z.write(full, os.path.relpath(full, OUT))


def sign():
    cli = tizen_cli()
    if not cli:
        sys.exit('Samsung\'s tizen tool isn\'t installed. Run tools/setup-mac.sh first.')
    out = tempfile.mkdtemp()
    try:
        run = subprocess.run([cli, 'package', '-t', 'wgt', '-s', PROFILE, '-o', out, '--', WGT],
                             stdout=subprocess.PIPE, stderr=subprocess.STDOUT, universal_newlines=True)
        made = [n for n in os.listdir(out) if n.endswith('.wgt')]
        if run.returncode != 0 or not made:
            sys.exit('Signing didn\'t work. The tizen tool said:\n' + run.stdout.strip())
        shutil.move(os.path.join(out, made[0]), WGT)
    finally:
        shutil.rmtree(out, ignore_errors=True)
    with zipfile.ZipFile(WGT) as z:
        names = z.namelist()
    if 'author-signature.xml' not in names or 'signature1.xml' not in names:
        sys.exit('The package came back without its signatures.')


def main():
    diag = sys.argv[sys.argv.index('--diag') + 1] if '--diag' in sys.argv and sys.argv.index('--diag') + 1 < len(sys.argv) else None
    build_folder(diag)
    if '--preview' in sys.argv:
        import functools
        import http.server
        import webbrowser
        port = 8765
        class NoCache(http.server.SimpleHTTPRequestHandler):
            # Always the latest files: the browser never keeps an old copy of the app.
            def end_headers(self):
                self.send_header('Cache-Control', 'no-store')
                super().end_headers()

            def log_message(self, *args):
                pass
        handler = functools.partial(NoCache, directory=OUT)
        server = http.server.ThreadingHTTPServer(('127.0.0.1', port), handler)
        url = 'http://localhost:%d/index.html' % port
        print('Preview running at ' + url)
        print('Arrow keys move, Enter selects, Esc goes back. Keys 1-4 act as the red/green/yellow/blue buttons.')
        print('Press Control-C here to stop it.')
        webbrowser.open(url)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print('\nPreview stopped.')
        return
    package()
    sign()
    print('Built and signed: %s (%d KB)' % (os.path.relpath(WGT, ROOT), os.path.getsize(WGT) // 1024))


if __name__ == '__main__':
    main()
