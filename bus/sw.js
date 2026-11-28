// เปิดแอปได้แม้เน็ตไม่ดี: หน้าเว็บดึงใหม่ก่อน ไฟล์อื่นใช้ของที่เก็บไว้ · ไม่เก็บ /api และแผนที่
const C = 'jabmue-bus-v1';
const SHELL = ['/', '/driver', '/admin', '/common.js', '/style.css', '/manifest.webmanifest', '/icon-192.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(C).then((c) => c.addAll(SHELL)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== C).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.pathname.startsWith('/api/') || u.hostname.includes('tile.openstreetmap') ||
      u.hostname.includes('osrm') || u.hostname.includes('nominatim')) return;
  const own = u.origin === location.origin;
  e.respondWith(caches.open(C).then(async (c) => {
    const hit = await c.match(e.request, { ignoreSearch: e.request.mode === 'navigate' });
    const net = fetch(e.request).then((r) => { if (r && (r.ok || r.type === 'opaque')) c.put(e.request, r.clone()); return r; })
      .catch(() => hit || Response.error());
    // ไฟล์ของแอปเอง: ดึงใหม่ก่อนเสมอ (อัปเดตทันที) · ไฟล์จากเว็บอื่น (ฟอนต์, Leaflet): ใช้ของเก่าก่อน
    return own ? net : (hit || net);
  }));
});
