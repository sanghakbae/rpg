#!/usr/bin/env python3
"""bake.html 이 POST 한 스프라이트 시트(PNG dataURL + 메타 JSON)를 assets/sprites/ 에 저장하는 로컬 서버.
   사용: python3 tools/bake_server.py  (포트 8124)  — 게임 서버(8123)와 별개."""
import base64, json, os, re, sys
from http.server import BaseHTTPRequestHandler, HTTPServer

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(ROOT, 'assets', 'sprites')
os.makedirs(OUT, exist_ok=True)

def write_manifest():
    """png+json 둘 다 있는 시트 키 목록 → manifest.json. 게임은 이 목록에 없는 키는 요청조차 하지 않는다(404 소음 제거)"""
    names = sorted(f[:-4] for f in os.listdir(OUT) if f.endswith('.png') and os.path.exists(os.path.join(OUT, f[:-4] + '.json')))
    with open(os.path.join(OUT, 'manifest.json'), 'w') as f: json.dump(names, f)

class H(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.end_headers()
    def do_POST(self):
        n = int(self.headers.get('Content-Length', 0))
        if self.path.startswith('/upload'):
            # 브라우저(로그인 세션)가 받은 GLB 바이너리를 그대로 저장: /upload?name=<파일명>
            from urllib.parse import urlparse, parse_qs, unquote
            q = parse_qs(urlparse(self.path).query)
            fn = os.path.basename(unquote(q.get('name', ['model.glb'])[0]))
            dst = os.path.join(ROOT, 'assets', 'glb', fn)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            with open(dst, 'wb') as f:
                remain = n
                while remain > 0:
                    chunk = self.rfile.read(min(1 << 20, remain)); remain -= len(chunk); f.write(chunk)
            print('uploaded', fn, n // 1024, 'KB', flush=True)
            self.send_response(200); self._cors(); self.send_header('Content-Type', 'application/json'); self.end_headers()
            self.wfile.write(b'{"ok":true}'); return
        body = json.loads(self.rfile.read(n))
        name = re.sub(r'[^a-z0-9_]', '', str(body.get('name', '')).lower())
        if not name:
            self.send_response(400); self._cors(); self.end_headers(); return
        png = body['png'].split(',', 1)[1]
        with open(os.path.join(OUT, name + '.png'), 'wb') as f: f.write(base64.b64decode(png))
        with open(os.path.join(OUT, name + '.json'), 'w') as f: json.dump(body.get('meta', {}), f, ensure_ascii=False, indent=1)
        write_manifest()
        print('saved', name, len(png) // 1024, 'KB', flush=True)
        self.send_response(200); self._cors(); self.send_header('Content-Type', 'application/json'); self.end_headers()
        self.wfile.write(b'{"ok":true}')
    def log_message(self, *a): pass

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8124
    print('bake server on', port, '->', OUT, flush=True)
    HTTPServer(('127.0.0.1', port), H).serve_forever()
