// ของที่ใช้ร่วมกันทุกหน้า: เรียก API, คำนวณระยะทาง/เวลาถึง, แสดงผลภาษาไทย
'use strict';

const API = '/api/bus';

async function api(action, body, params) {
  const opt = body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : { cache: 'no-store' };
  const qs = params ? '&' + new URLSearchParams(params).toString() : '';
  let r;
  try {
    r = await fetch(`${API}?a=${action}${qs}${body || params ? '' : '&t=' + Math.floor(Date.now() / 5000)}`, opt);
  } catch {
    throw Object.assign(new Error('ไม่มีอินเทอร์เน็ต หรือสัญญาณไม่ดี'), { offline: true });
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || 'ระบบขัดข้อง'), { status: r.status });
  return j;
}

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get: (k, d = null) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
  del: (k) => localStorage.removeItem(k),
};

// ---------- ภูมิศาสตร์ ----------
const R_EARTH = 6371000;
const toRad = (d) => (d * Math.PI) / 180;
function dist(a, b) {
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(h));
}

// เตรียมเส้นทาง: ระยะสะสมตามเส้น และตำแหน่งของแต่ละป้ายบนเส้น
function buildRoute(route) {
  const road = Boolean(route.path && route.path.length >= 2);
  const pts = road ? route.path : route.stops.map((s) => [s.lat, s.lng]);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
  const g = { route, pts, cum, len: cum[cum.length - 1] || 0, road, factor: road ? 1 : 1.3 };
  let hint = 0;
  g.stopAlong = route.stops.map((s) => {
    const p = project(g, [s.lat, s.lng], hint);
    hint = p.along;
    return p.along;
  });
  return g;
}

// หาจุดบนเส้นทางที่ใกล้ตำแหน่งนี้ที่สุด (along = ระยะจากต้นสาย, off = ห่างจากเส้นกี่เมตร)
function project(g, p, hint) {
  if (g.pts.length === 0) return { along: 0, off: Infinity };
  if (g.pts.length === 1) return { along: 0, off: dist(g.pts[0], p) };
  const kx = Math.cos(toRad(p[0])) * 111320;
  const ky = 110540;
  const cands = [];
  let best = Infinity;
  for (let i = 0; i < g.pts.length - 1; i++) {
    const a = g.pts[i];
    const b = g.pts[i + 1];
    const ax = (a[1] - p[1]) * kx, ay = (a[0] - p[0]) * ky;
    const bx = (b[1] - p[1]) * kx, by = (b[0] - p[0]) * ky;
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy;
    let t = L2 ? -(ax * dx + ay * dy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    const off = Math.hypot(ax + t * dx, ay + t * dy);
    const along = g.cum[i] + t * (g.cum[i + 1] - g.cum[i]);
    cands.push({ off, along });
    if (off < best) best = off;
  }
  // ถ้าถนนวนผ่านจุดเดิมหลายครั้ง เลือกจุดที่ใกล้ตำแหน่งล่าสุดที่รู้
  const near = cands.filter((c) => c.off <= best + 40);
  if (hint == null || near.length === 1) return near.reduce((x, y) => (y.off < x.off ? y : x));
  return near.reduce((x, y) => (Math.abs(y.along - hint) < Math.abs(x.along - hint) ? y : x));
}

// รถคันนี้จะถึงป้ายนี้อีกกี่เมตร / กี่นาที
function etaToStop(g, bus, stopIdx) {
  const sa = g.stopAlong[stopIdx];
  // คนขับส่งตำแหน่งบนเส้นทางมาด้วย (แม่นกว่าเมื่อถนนวนกลับทางเดิม) ถ้าไม่มีค่อยคำนวณเอง
  const pos = Number.isFinite(bus.along) && bus.along <= g.len + 50 && bus.off < 1500
    ? { along: bus.along, off: bus.off }
    : project(g, [bus.lat, bus.lng]);
  const straight = dist([bus.lat, bus.lng], [g.route.stops[stopIdx].lat, g.route.stops[stopIdx].lng]);
  if (pos.off > 1500) {
    return { kind: 'off', meters: straight, minutes: null, along: pos.along };
  }
  const slack = 80; // ถือว่าถึงป้ายแล้วถ้าห่างไม่เกินนี้
  let meters, kind;
  if (bus.dir === -1) {
    if (sa <= pos.along + slack) { meters = Math.max(0, pos.along - sa); kind = 'coming'; }
    else { meters = pos.along + sa; kind = 'return'; }
  } else {
    if (sa >= pos.along - slack) { meters = Math.max(0, sa - pos.along); kind = 'coming'; }
    else { meters = (g.len - pos.along) + (g.len - sa); kind = 'return'; }
  }
  const speed = (g.route.speed || 30) / 3.6; // ม./วินาที
  let minutes = (meters * g.factor) / speed / 60;
  if (kind === 'return') minutes += 5; // เวลากลับรถที่ปลายสาย
  if (meters < 150 && kind === 'coming') minutes = 0;
  return { kind, meters: meters * g.factor, minutes: Math.round(minutes), along: pos.along };
}

function headingTo(route, dir) {
  const s = route.stops;
  if (!s.length) return '';
  return dir === -1 ? s[0].name : s[s.length - 1].name;
}

// ---------- รูปแบบการแสดงผล ----------
function fmtDist(m) {
  if (m == null || !Number.isFinite(m)) return '';
  if (m < 1000) return `${Math.round(m / 10) * 10} ม.`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} กม.`;
}
function fmtMin(n) {
  if (n == null) return '';
  if (n <= 1) return 'ใกล้ถึงแล้ว';
  if (n < 60) return `${n} นาที`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m ? `${h} ชม. ${m} นาที` : `${h} ชั่วโมง`;
}
function fmtAgo(ts, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return 'เมื่อสักครู่';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} นาทีที่แล้ว`;
  return `${Math.round(m / 60)} ชม.ที่แล้ว`;
}
const nowHM = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// พูดภาษาไทย (สำหรับคนที่อ่านตัวหนังสือเล็กไม่ถนัด)
function speak(text) {
  if (!('speechSynthesis' in window)) return false;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'th-TH';
  u.rate = 0.9;
  const th = speechSynthesis.getVoices().find((v) => v.lang && v.lang.toLowerCase().startsWith('th'));
  if (th) u.voice = th;
  speechSynthesis.speak(u);
  return true;
}

function toast(msg, ms = 2600) {
  let t = $('#toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), ms);
}

async function shareLink(url, text) {
  if (navigator.share) {
    try { await navigator.share({ title: document.title, text, url }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`);
    toast('คัดลอกลิงก์แล้ว นำไปวางใน LINE ได้เลย');
  } catch {
    prompt('คัดลอกลิงก์นี้', url);
  }
}
const lineShare = (url, text) => `https://line.me/R/share?text=${encodeURIComponent(`${text}\n${url}`)}`;

// ---------- แผนที่ (Leaflet + OpenStreetMap) ----------
// ภาพแผนที่: ใช้ OpenStreetMap ก่อน ถ้าโหลดไม่ขึ้น (บางเน็ต/VPN/เบราว์เซอร์ในแอป LINE ถูกบล็อก) สลับเจ้าถัดไปอัตโนมัติ
// ทุกเจ้าในรายการนี้ใช้ได้ฟรีโดยไม่ต้องมี API key
const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const TILES = [
  { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: OSM_ATTR, maxZoom: 19 },
  { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', attribution: 'Tiles &copy; Esri', maxZoom: 19 },
  { url: 'https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png', attribution: OSM_ATTR + ' &copy; OSM France', maxZoom: 19, subdomains: 'abc' },
];
const TILE_KEY = 'bus.tiles3';
function makeMap(el, opts = {}) {
  const m = L.map(el, { zoomControl: true, attributionControl: true, ...opts });
  let i = Number(sessionStorage.getItem(TILE_KEY) || 0) % TILES.length;
  let layer = null, ok = 0, bad = 0, timer = null;
  const next = () => {
    if (ok > 0 || i >= TILES.length - 1) return;
    i++;
    sessionStorage.setItem(TILE_KEY, String(i));
    use(i);
  };
  const use = (n) => {
    if (layer) m.removeLayer(layer);
    ok = 0; bad = 0;
    const t = TILES[n];
    // ส่ง Referer เสมอ (OSM ไม่ให้ภาพถ้าไม่มี) แม้เบราว์เซอร์ในแอปจะตั้งค่าไม่ส่ง
    layer = L.tileLayer(t.url, { maxZoom: t.maxZoom, attribution: t.attribution, subdomains: t.subdomains || 'abc', referrerPolicy: 'strict-origin-when-cross-origin', crossOrigin: false }).addTo(m);
    layer.on('tileload', () => { ok++; clearTimeout(timer); });
    layer.on('tileerror', () => { bad++; if (bad >= 3 && ok === 0 && n === i) next(); });
    // โหลดนานเกินไปแต่ไม่ error (บางเน็ตค้าง) ก็สลับเหมือนกัน
    clearTimeout(timer);
    timer = setTimeout(() => { if (ok === 0 && n === i && navigator.onLine !== false) next(); }, 8000);
  };
  use(i);
  m.setView([13.4, 101.0], 6);
  // ถ้ากล่องแผนที่เปลี่ยนขนาด (เช่น เพิ่งแสดง) ให้วาดใหม่ ไม่งั้นจะเป็นพื้นเทา
  if (window.ResizeObserver) new ResizeObserver(() => m.invalidateSize()).observe(el);
  return m;
}
function busIcon(color, label, full) {
  return L.divIcon({
    className: 'bus-pin',
    html: `<div class="bus-pin-in" style="background:${color}">🚌</div>${label ? `<div class="bus-pin-lb">${esc(label)}${full ? ' · เต็ม' : ''}</div>` : ''}`,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
  });
}
function stopIcon(sel, n) {
  return L.divIcon({
    className: 'stop-pin',
    html: `<div class="stop-pin-in${sel ? ' sel' : ''}">${n ?? ''}</div>`,
    iconSize: sel ? [30, 30] : [22, 22],
    iconAnchor: sel ? [15, 15] : [11, 11],
  });
}
const meIcon = () => L.divIcon({ className: 'me-pin', html: '<div class="me-pin-in"></div>', iconSize: [20, 20], iconAnchor: [10, 10] });

function getPosition(opts = {}) {
  return new Promise((ok, no) => {
    if (!navigator.geolocation) return no(new Error('เครื่องนี้หาตำแหน่งไม่ได้'));
    navigator.geolocation.getCurrentPosition(ok, (e) => no(new Error(gpsError(e))), { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000, ...opts });
  });
}
function gpsError(e) {
  if (e && e.code === 1) return 'ยังไม่ได้อนุญาตให้ใช้ตำแหน่ง กรุณากด "อนุญาต" (ดูวิธีด้านล่าง)';
  if (e && e.code === 3) return 'หาตำแหน่งนานเกินไป ลองออกไปที่โล่งแล้วลองใหม่';
  return 'หาตำแหน่งไม่ได้ ลองเปิด GPS ในมือถือแล้วลองใหม่';
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
if (!window.L && document.querySelector('script[src*="leaflet"]')) {
  window.addEventListener('load', () => { if (!window.L) toast('โหลดแผนที่ไม่ได้ ลองปิด VPN หรือรีเฟรชหน้า', 5000); });
}
