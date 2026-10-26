/* FP2級 再挑戦ドリル  service-worker.js
   ファイルを更新したら CACHE_VERSION を必ず上げてください（例：v1.0.0 → v1.0.1）。
   上げると古いキャッシュは activate 時に削除されます。 */
'use strict';

const CACHE_VERSION = 'v1.0.0';
const CACHE_PREFIX = 'fp2drill-';
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;

const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './questions.json',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

/* インストール：全ファイルをネットワークから取り直してキャッシュ */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' })))
    )
  );
});

/* 有効化：バージョンの違う古いキャッシュを削除 */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

/* 画面の「更新する」ボタンから届く合図で、新しい版に切り替え */
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

/* 取得：ページ本体と問題データはネットワーク優先、その他はキャッシュ優先 */
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const networkFirst = req.mode === 'navigate' || url.pathname.endsWith('/questions.json');

  if (networkFirst) {
    event.respondWith(
      fetch(req)
        .then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(req, { ignoreSearch: true })
            .then(hit => hit || caches.match('./index.html'))
        )
    );
    return;
  }

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => {
      if (hit) return hit;
      return fetch(req).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
        }
        return res;
      });
    })
  );
});
