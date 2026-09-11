/* 바이브 아레나 서비스 워커
   - 스프라이트/아이콘처럼 버전 쿼리(?v=)가 붙은 정적 자산: 캐시 우선(재접속 때 수 MB 재다운로드 제거)
   - index.html / game.js: 네트워크 우선 + 캐시 폴백(업데이트는 즉시 반영, 오프라인이면 마지막 버전)
   - Firebase / 구글 API: 캐시하지 않음 */
const VER = 'va-v1';
const SHELL = VER + '-shell', ASSET = VER + '-asset';
const SHELL_URLS = ['/', '/index.html', '/manifest.webmanifest', '/assets/pwa/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => Promise.all(SHELL_URLS.map(u => c.add(u).catch(() => {})))).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => !k.startsWith(VER)).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
/* 자산을 다른 호스트(예: cdn.sanghak.kr)에서 받도록 바꿀 경우 여기에 그 오리진을 넣는다.
   game.js의 ASSET_BASE와 짝이다 — 비워 두면 같은 오리진만 캐시한다. */
const ASSET_HOSTS = []; /* game.js의 ASSET_BASE와 짝 — 지금은 꺼져 있다 */
const isAsset = u => /\/assets\/.*\.(png|jpg|jpeg|webp|svg|json|glb|woff2?)$/i.test(u.pathname);
const isCode = u => u.pathname === '/' || /\.(html|js|webmanifest)$/i.test(u.pathname);

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let u; try { u = new URL(req.url); } catch (err) { return; }
  if (u.origin !== self.location.origin && !(ASSET_HOSTS.includes(u.origin) && isAsset(u))) return; /* Firebase·gstatic 등은 그대로 통과 */
  if (u.pathname === '/sw.js') return;

  if (isAsset(u)) {                                          /* 캐시 우선 */
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      /* 실패 응답은 캐시하지 않고 그대로 넘겨 클라이언트가 재시도하게 둔다 */
      if (res && res.ok) {
        const cp = res.clone();
        caches.open(ASSET).then(async c => {
          for (const k of await c.keys()) { try { if (new URL(k.url).pathname === u.pathname) await c.delete(k); } catch (err) {} } /* 같은 파일의 옛 버전 제거 */
          await c.put(req, cp);
        }).catch(() => {});
      }
      return res;
    })));
    return;
  }
  if (isCode(u)) {                                           /* 네트워크 우선 */
    /* 캐시 키에서 쿼리를 뗀다. 예전에는 요청 URL 그대로 저장해서
       업데이트 확인이 만드는 index.html?t=<시각>과 버전마다 다른 game.js?v=N이
       삭제되지 않고 무한히 쌓였다(10분마다 한 건씩). */
    const key = new Request(u.origin + u.pathname);
    e.respondWith(fetch(req).then(res => {
      if (res && res.ok) {
        const cp = res.clone();
        caches.open(SHELL).then(async c => {
          for (const k of await c.keys()) { try { if (new URL(k.url).pathname === u.pathname) await c.delete(k); } catch (err) {} } /* 같은 경로의 옛 항목 정리 */
          await c.put(key, cp);
        }).catch(() => {});
      }
      return res;
    }).catch(() => caches.match(key).then(hit => hit
      || (req.mode === 'navigate' ? caches.match('/index.html') : null)
      || Response.error()))); /* 문서가 아닌 요청에 HTML을 돌려주면 MIME 오류로 흰 화면이 된다 */
  }
});
