// 캐시 버전을 대폭 올려서 폰이 "어? 완전 새 버전이네!" 하고 놀라게 만듭니다.
const CACHE_NAME = 'scouter-cache-v100'; 

self.addEventListener('install', event => {
  self.skipWaiting(); // 새 코드가 폰에 들어오면 대기하지 않고 즉시 덮어씌움 (강제 업데이트)
});

self.addEventListener('activate', event => {
  // 폰에 몰래 남아있는 옛날 쓰레기 캐시(과거 index.html)를 싹 다 삭제!
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.map(key => {
        if (key !== CACHE_NAME) return caches.delete(key);
      })
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  // 💡 핵심: 무조건 Vercel 서버에서 최신 코드를 가져오고, 인터넷이 아예 끊겼을 때만 캐시를 씀
  event.respondWith(
    fetch(event.request)
      .catch(() => caches.match(event.request, { ignoreSearch: true }))
  );
});
