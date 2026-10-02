'use strict';
// 앱 파일을 수정하면 SHELL 버전을 올린다.
const SHELL = 'shell-v4';
const AUDIO = 'audio-v1';
const SHELL_FILES = [
  './', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'data/languages.json', 'data/crimes.json', 'data/lang/ko.json', 'audio/manifest.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await cache.addAll(SHELL_FILES);
    const langs = await (await fetch('data/languages.json')).json();
    await cache.addAll(langs.map((l) => `data/lang/${l.code}.json`));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== SHELL && key !== AUDIO) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  // 음성: URL 에 ?v=해시 가 붙어 있으므로 캐시 우선
  if (url.pathname.endsWith('.mp3')) {
    e.respondWith((async () => {
      const cache = await caches.open(AUDIO);
      const hit = await cache.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    })());
    return;
  }

  // 그 외: 네트워크 우선 (고지문 수정이 바로 반영되도록), 실패하면 캐시
  e.respondWith((async () => {
    const cache = await caches.open(SHELL);
    try {
      const res = await fetch(e.request);
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    } catch {
      return (await cache.match(e.request, { ignoreSearch: true })) || Response.error();
    }
  })());
});
