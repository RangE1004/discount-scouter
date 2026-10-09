const CACHE_NAME = 'scouter-cache-v2';
const urlsToCache = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg'
];

// 앱 설치 시 캐시 저장 (오프라인 구동 및 정식 앱 인식용)
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
  self.skipWaiting();
});

// 네트워크 요청 가로채기 (정식 PWA 필수 조건)
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});
