#!/usr/bin/env python3
"""A remote control for the TV over the home network (Samsung's own remote API, as phone remote apps use).

    python3 tools/remote.py connect                    # connect only (the TV asks to allow it the first time)
    python3 tools/remote.py KEY_RETURN                 # press Back
    python3 tools/remote.py KEY_RETURN KEY_ENTER        # several, half a second apart
    python3 tools/remote.py hold KEY_RETURN 2           # hold Back for 2 seconds (Samsung's "exit app")
    python3 tools/remote.py wake                       # turn the TV on (Wake-on-LAN); KEY_POWER turns it off
    python3 tools/remote.py status                     # on, standby, or not answering
    python3 tools/remote.py mac                        # the TV's hardware address, for TV_MAC in config/tv.txt

Other keys: KEY_HOME, KEY_ENTER (OK), KEY_UP/DOWN/LEFT/RIGHT, KEY_EXIT, KEY_PLAY, KEY_PAUSE.
The first time, the TV asks whether to allow "BigTuna Home tester": accept it with the remote. The TV's permission
token is saved in config/remote-token.txt (not shared; remove it, and the device in the TV's Device Connection Manager,
to undo). Python 3.9 standard library only.
"""
import base64
import json
import os
import socket
import ssl
import struct
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from install import DEFAULT_TV, NO_TV, ROOT, TV_CONFIG  # noqa: E402

# The TV's hardware address, for Wake-on-LAN: TV_MAC in config/tv.txt (python3 tools/remote.py mac shows it while the
# TV is on). The TV needs Settings > General > Network > Expert Settings > Power On with Mobile.
TV_MAC = TV_CONFIG.get('TV_MAC', '')
NAME = base64.b64encode(b'BigTuna Home tester').decode()
TOKEN = os.path.join(ROOT, 'config', 'remote-token.txt')


class Remote:
    def __init__(self, ip):
        token = open(TOKEN).read().strip() if os.path.exists(TOKEN) else ''
        path = '/api/v2/channels/samsung.remote.control?name=%s%s' % (NAME, '&token=' + token if token else '')
        raw = socket.create_connection((ip, 8002), timeout=40)
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE          # the TV's own self-signed certificate, on the home network
        self.sock = ctx.wrap_socket(raw, server_hostname=ip)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall(('GET %s HTTP/1.1\r\nHost: %s:8002\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
                           'Sec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n' % (path, ip, key)).encode())
        head = b''
        while b'\r\n\r\n' not in head:
            chunk = self.sock.recv(1)
            if not chunk:
                raise ConnectionError('the TV closed the connection')
            head += chunk
        if b' 101 ' not in head.split(b'\r\n')[0]:
            raise ConnectionError('the TV refused: ' + head.split(b'\r\n')[0].decode('utf-8', 'replace'))
        # The TV answers with ms.channel.connect once allowed (after the on-screen prompt, the first time).
        while True:
            msg = json.loads(self.recv_text())
            if msg.get('event') == 'ms.channel.connect':
                new = (msg.get('data') or {}).get('token')
                if new and new != token:
                    with open(TOKEN, 'w') as f:
                        f.write(new)
                    os.chmod(TOKEN, 0o600)
                break
            if msg.get('event') == 'ms.channel.unauthorized':
                raise ConnectionError('the TV said no (the connection was denied on the TV)')

    def _recv(self, n):
        out = b''
        while len(out) < n:
            chunk = self.sock.recv(n - len(out))
            if not chunk:
                raise ConnectionError('the TV closed the connection')
            out += chunk
        return out

    def recv_text(self):
        message = b''
        while True:
            b0, b1 = self._recv(2)
            n = b1 & 0x7f
            if n == 126:
                n = struct.unpack('>H', self._recv(2))[0]
            elif n == 127:
                n = struct.unpack('>Q', self._recv(8))[0]
            data = self._recv(n)
            if b0 & 0x0f == 8:
                raise ConnectionError('the TV closed the connection')
            if b0 & 0x0f in (9, 10):
                continue
            message += data
            if b0 & 0x80:
                return message.decode('utf-8', 'replace')

    def send_text(self, text):
        data = text.encode('utf-8')
        mask = os.urandom(4)
        n = len(data)
        head = b'\x81' + (bytes([0x80 | n]) if n < 126 else b'\xfe' + struct.pack('>H', n))
        self.sock.sendall(head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def key(self, code, cmd='Click'):
        self.send_text(json.dumps({'method': 'ms.remote.control', 'params': {
            'Cmd': cmd, 'DataOfCmd': code, 'Option': 'false', 'TypeOfRemote': 'SendRemoteKey'}}))


def power_state(ip):
    """'on', 'standby' or None (not answering), from the TV's own status service."""
    try:
        from urllib.request import urlopen
        d = json.loads(urlopen('http://%s:8001/api/v2/' % ip, timeout=3).read().decode())['device']
        return d.get('PowerState') or 'on'
    except Exception:
        return None


def wake(ip):
    """Wake-on-LAN: a "magic packet" (six 0xFF bytes, then the TV's hardware address 16 times), sent a few times."""
    if not TV_MAC:
        sys.exit('Put TV_MAC in config/tv.txt first (python3 tools/remote.py mac shows it while the TV is on).')
    packet = b'\xff' * 6 + bytes.fromhex(TV_MAC.replace(':', '')) * 16
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    subnet = '.'.join(ip.split('.')[:3]) + '.255'
    for _ in range(3):
        for target in ('255.255.255.255', subnet, ip):
            try:
                s.sendto(packet, (target, 9))
            except OSError:
                pass   # a fully asleep TV has no direct route; the broadcasts still reach it
        time.sleep(0.3)
    s.close()
    print('wake-up sent; waiting for the TV ...')
    for _ in range(20):
        if power_state(ip) == 'on':
            print('the TV is on')
            return
        time.sleep(1)
    print('the TV is ' + (power_state(ip) or 'not answering') + ' (check Power On with Mobile is on)')


def main():
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)
    ip = os.environ.get('TV_IP', DEFAULT_TV)
    if not ip:
        sys.exit(NO_TV)
    if args[0] == 'mac':
        try:
            from urllib.request import urlopen
            print(json.loads(urlopen('http://%s:8001/api/v2/' % ip, timeout=3).read().decode())['device']['wifiMac'])
        except Exception:
            print('The TV didn\'t answer: turn it on and try again.')
        return
    if args[0] == 'wake':
        wake(ip)
        return
    if args[0] == 'status':
        print(power_state(ip) or 'not answering')
        return
    r = Remote(ip)
    if args[0] == 'connect':   # just connect (the first time, the TV asks to allow it); presses nothing
        print('connected and allowed')
        return
    if args[0] == 'hold':
        r.key(args[1], 'Press')
        time.sleep(float(args[2]) if len(args) > 2 else 1.5)
        r.key(args[1], 'Release')
        print('held ' + args[1])
    else:
        for i, k in enumerate(args):
            if i:
                time.sleep(0.5)
            r.key(k)
        print('pressed ' + ' '.join(args))
    time.sleep(0.3)


if __name__ == '__main__':
    main()
