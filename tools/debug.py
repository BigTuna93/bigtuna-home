#!/usr/bin/env python3
"""Looks inside BigTuna Home while it runs on the TV: the same inspector a browser has, over the TV's developer connection.

    python3 tools/debug.py start            # restart the app on the TV in debug mode and keep a connection open
                                            # (leave it running; Control-C stops it)
    python3 tools/debug.py eval "1 + 1"     # run JavaScript in the app on the TV and print the answer
    python3 tools/debug.py shot out.png     # a screenshot of the app as the TV shows it
    python3 tools/debug.py stop             # restart the app normally (out of debug mode)

The TV must be in Developer Mode with this Mac's IP (the same as for installing). The connection is only reachable
from this Mac (127.0.0.1). Uses Samsung's debug launch (`0 debug <app id>`, as Tizen Studio does) and SDB's tcp: streams.
"""
import base64
import json
import os
import re
import select
import socket
import struct
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from install import DEFAULT_TV, ROOT, Sdb  # noqa: E402

LOCAL_PORT = 9226                       # where the inspector is reachable on this Mac
STATE = os.path.join(ROOT, 'build', 'debug-port.txt')


def app_id():
    with open(os.path.join(ROOT, 'app', 'config.xml'), encoding='utf-8') as f:
        tag = re.search(r'<tizen:application[^>]*>', f.read()).group(0)
    found = re.search(r'\bid="([A-Za-z0-9]{10}\.[A-Za-z0-9]{1,52})"', tag)
    if not found:
        sys.exit('config.xml has no valid app id.')
    return found.group(1)


# MARK: - start: debug launch, then pass connections from this Mac through to the TV

def start(ip):
    sdb = Sdb(ip)
    out = sdb.shell('0 debug ' + app_id(), r'port\s*:\s*\d+', 60)
    found = re.search(r'port\s*:\s*(\d+)', out)
    if not found:
        sys.exit('The TV didn\'t start the app in debug mode. It said:\n' + out.strip())
    tv_port = int(found.group(1))
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    with open(STATE, 'w') as f:
        f.write(str(LOCAL_PORT))
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind(('127.0.0.1', LOCAL_PORT))
    listener.listen(8)
    print('BigTuna Home is in debug mode on the TV (its inspector port %d).' % tv_port)
    print('Inspector reachable on this Mac at http://127.0.0.1:%d/json. Control-C to stop.' % LOCAL_PORT)
    sys.stdout.flush()
    relay(sdb, listener, tv_port)


def relay(sdb, listener, tv_port):
    """Each connection to LOCAL_PORT becomes one SDB stream to the TV's inspector port, both ways."""
    pairs = {}          # SDB local stream id -> (socket on this Mac, (local id, remote id))
    by_sock = {}
    sdb.sock.settimeout(None)
    try:
        while True:
            # Packets already read into the buffer first: select can't see them.
            while len(sdb.buf) >= 24 and _whole_packet(sdb):
                sdb.pump()
            for lid in list(pairs):
                sock, stream = pairs[lid]
                data = sdb.inbox.pop(lid, b'')
                if data:
                    try:
                        sock.sendall(data)
                    except OSError:
                        _close(sdb, pairs, by_sock, lid, tell_tv=True)
                        continue
                if lid in sdb.closed:
                    sdb.closed.discard(lid)
                    _close(sdb, pairs, by_sock, lid, tell_tv=False)
            ready, _, _ = select.select([listener, sdb.sock] + list(by_sock), [], [], 0.5)
            for r in ready:
                if r is listener:
                    sock, _ = listener.accept()
                    try:
                        stream = sdb.open('tcp:%d' % tv_port)
                    except ConnectionError:
                        sock.close()
                        continue
                    pairs[stream[0]] = (sock, stream)
                    by_sock[sock] = stream[0]
                elif r is sdb.sock:
                    sdb.pump()
                else:
                    lid = by_sock.get(r)
                    try:
                        data = r.recv(65536)
                    except OSError:
                        data = b''
                    if not data:
                        _close(sdb, pairs, by_sock, lid, tell_tv=True)
                        continue
                    stream = pairs[lid][1]
                    step = sdb.max
                    for i in range(0, len(data), step):
                        sdb.write(stream, data[i:i + step])
    except KeyboardInterrupt:
        print('\nStopped. Run `python3 tools/debug.py stop` to restart the app normally.')
    finally:
        if os.path.exists(STATE):
            os.remove(STATE)


def _whole_packet(sdb):
    n = struct.unpack('<6I', sdb.buf[:24])[3]
    return len(sdb.buf) >= 24 + n


def _close(sdb, pairs, by_sock, lid, tell_tv):
    sock, stream = pairs.pop(lid, (None, None))
    if sock is None:
        return
    by_sock.pop(sock, None)
    try:
        sock.close()
    except OSError:
        pass
    if tell_tv:
        try:
            sdb.send(b'CLSE', stream[0], stream[1])
        except OSError:
            pass


# MARK: - eval and shot: talk to the inspector (Chrome DevTools protocol over a WebSocket)

def inspector():
    if not os.path.exists(STATE):
        sys.exit('Not connected. Start it first (and leave it running): python3 tools/debug.py start')
    with open(STATE) as f:
        port = int(f.read().strip())
    targets = json.loads(_http_get(port, '/json'))
    pages = [t for t in targets if t.get('webSocketDebuggerUrl')]
    if not pages:
        sys.exit('The TV\'s inspector shows no page to connect to (is someone else connected?).')
    path = re.sub(r'^ws://[^/]+', '', pages[0]['webSocketDebuggerUrl'])
    return WebSocket(port, path)


def _http_get(port, path):
    s = socket.create_connection(('127.0.0.1', port), timeout=20)
    s.sendall(('GET %s HTTP/1.1\r\nHost: 127.0.0.1:%d\r\nConnection: close\r\n\r\n' % (path, port)).encode())
    data = b''
    while True:
        chunk = s.recv(65536)
        if not chunk:
            break
        data += chunk
    s.close()
    head, _, body = data.partition(b'\r\n\r\n')
    if b'chunked' in head.lower():
        out, rest = b'', body
        while rest:
            size, _, rest = rest.partition(b'\r\n')
            n = int(size.split(b';')[0], 16)
            if not n:
                break
            out, rest = out + rest[:n], rest[n + 2:]
        body = out
    return body.decode('utf-8', 'replace')


class WebSocket:
    """Just enough of a WebSocket client for the inspector: text frames out (masked), frames in, one call at a time."""

    def __init__(self, port, path):
        self.sock = socket.create_connection(('127.0.0.1', port), timeout=30)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall(('GET %s HTTP/1.1\r\nHost: 127.0.0.1:%d\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
                           'Sec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n' % (path, port, key)).encode())
        head = b''
        while b'\r\n\r\n' not in head:
            chunk = self.sock.recv(1)
            if not chunk:
                raise ConnectionError('the inspector closed the connection')
            head += chunk
        if b' 101 ' not in head.split(b'\r\n')[0]:
            raise ConnectionError('the inspector refused: ' + head.split(b'\r\n')[0].decode('utf-8', 'replace'))
        self.next_id = 1

    def _recv(self, n):
        out = b''
        while len(out) < n:
            chunk = self.sock.recv(n - len(out))
            if not chunk:
                raise ConnectionError('the inspector closed the connection')
            out += chunk
        return out

    def send_text(self, text):
        data = text.encode('utf-8')
        mask = os.urandom(4)
        n = len(data)
        head = b'\x81' + (bytes([0x80 | n]) if n < 126 else
                          b'\xfe' + struct.pack('>H', n) if n < 65536 else b'\xff' + struct.pack('>Q', n))
        self.sock.sendall(head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def recv_text(self):
        message = b''
        while True:
            b0, b1 = self._recv(2)
            n = b1 & 0x7f
            if n == 126:
                n = struct.unpack('>H', self._recv(2))[0]
            elif n == 127:
                n = struct.unpack('>Q', self._recv(8))[0]
            mask = self._recv(4) if b1 & 0x80 else None
            data = self._recv(n)
            if mask:
                data = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
            op = b0 & 0x0f
            if op == 8:
                raise ConnectionError('the inspector closed the connection')
            if op in (9, 10):          # ping / pong: not part of a message
                continue
            message += data
            if b0 & 0x80:
                return message.decode('utf-8', 'replace')

    def call(self, method, params=None):
        mid, self.next_id = self.next_id, self.next_id + 1
        self.send_text(json.dumps({'id': mid, 'method': method, 'params': params or {}}))
        while True:
            reply = json.loads(self.recv_text())
            if reply.get('id') == mid:
                if 'error' in reply:
                    raise RuntimeError(reply['error'].get('message', str(reply['error'])))
                return reply.get('result', {})


def run_js(ws, expression):
    result = ws.call('Runtime.evaluate', {'expression': expression, 'returnByValue': True, 'awaitPromise': True})
    if result.get('exceptionDetails'):
        details = result['exceptionDetails']
        return 'Error: ' + (details.get('exception', {}).get('description') or details.get('text', 'unknown'))
    value = result.get('result', {})
    return json.dumps(value['value'], indent=1, ensure_ascii=False) if 'value' in value else value.get('description', '')


def main():
    args = sys.argv[1:]
    if not args or args[0] not in ('start', 'eval', 'shot', 'stop'):
        sys.exit(__doc__)
    cmd = args[0]
    if cmd == 'start':
        start(args[1] if len(args) > 1 else DEFAULT_TV)
    elif cmd == 'stop':
        sdb = Sdb(args[1] if len(args) > 1 else DEFAULT_TV)
        print(sdb.shell('0 was_execute ' + app_id(), r'launched|spend time', 20).strip() or 'Restarted normally.')
    elif cmd == 'eval':
        if len(args) < 2:
            sys.exit('What to run? python3 tools/debug.py eval "document.title"')
        print(run_js(inspector(), args[1]))
    elif cmd == 'shot':
        out = args[1] if len(args) > 1 else os.path.join(ROOT, 'build', 'tv-screen.png')
        shot = inspector().call('Page.captureScreenshot', {'format': 'png'})
        with open(out, 'wb') as f:
            f.write(base64.b64decode(shot['data']))
        print('Saved ' + out)


if __name__ == '__main__':
    main()
