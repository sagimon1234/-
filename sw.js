// ============================================================
// Service Worker - オフラインキャッシュ対応
// ============================================================

const CACHE_NAME = 'kakeibo-v1';
const CACHE_URLS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@300;400;500;700&family=DM+Mono:wght@400;500&display=swap',
];

// インストール: キャッシュに保存
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(CACHE_URLS).catch(err => console.warn('Cache install partial:', err));
    })
  );
  self.skipWaiting();
});

// アクティベート: 古いキャッシュを削除
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// フェッチ: キャッシュファーストで静的リソース、ネットワークファーストでAPI
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Google Apps Script APIはネットワーク優先
  if (url.hostname.includes('script.google.com') || url.hostname.includes('googleusercontent.com')) {
    event.respondWith(fetch(event.request).catch(() => new Response(JSON.stringify({ success: false, error: 'オフライン' }), { headers: { 'Content-Type': 'application/json' } })));
    return;
  }

  // 静的リソースはキャッシュファースト
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // フォールバック: index.htmlを返す（SPA対応）
        if (event.request.destination === 'document') {
          return caches.match('./index.html');
        }
        return new Response('', { status: 404 });
      });
    })
  );
});
