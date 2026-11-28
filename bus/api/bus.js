// API เดียวของแอป · เรียกแบบ /api/bus?a=<คำสั่ง>
import crypto from 'node:crypto';
import * as db from './_store.js';

const LIVE_KEEP_MS = 15 * 60 * 1000; // ไม่ได้ส่งตำแหน่งเกิน 15 นาที ถือว่าเลิกวิ่ง
const SESSION_DAYS = 90;

const EMPTY = { name: 'รถโดยสารประจำทาง', routes: [], drivers: [] };

const hashPin = (pin, salt) => crypto.scryptSync(String(pin), salt, 32).toString('hex');
const newId = (n = 6) => crypto.randomBytes(n).toString('base64url');
const okPin = (p) => /^\d{4,8}$/.test(String(p || ''));

function publicConfig(cfg) {
  return {
    name: cfg.name,
    routes: cfg.routes,
    drivers: cfg.drivers.map(({ id, name, plate, routeId }) => ({ id, name, plate, routeId })),
    updated: cfg.updated || 0,
  };
}

async function loadConfig() {
  return (await db.get('config')) || structuredClone(EMPTY);
}

async function session(token) {
  if (!token || typeof token !== 'string') return null;
  return db.get('sess:' + token);
}

async function tooMany(req) {
  const ip = String(req.headers['x-forwarded-for'] || 'x').split(',')[0].trim();
  return (await db.incr('fail:' + ip, 600)) > 15;
}

async function newSession(data) {
  const token = newId(24);
  await db.set('sess:' + token, data, SESSION_DAYS * 86400);
  return token;
}

const num = (v, lo, hi) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
};
const str = (v, max) => String(v ?? '').trim().slice(0, max);

function cleanConfig(input, old) {
  const routes = (Array.isArray(input.routes) ? input.routes : []).slice(0, 50).map((r) => {
    const stops = (Array.isArray(r.stops) ? r.stops : []).slice(0, 200)
      .map((s) => ({ id: str(s.id, 20) || newId(4), name: str(s.name, 60) || 'ป้าย', lat: num(s.lat, -90, 90), lng: num(s.lng, -180, 180) }))
      .filter((s) => s.lat !== null && s.lng !== null);
    const path = Array.isArray(r.path)
      ? r.path.slice(0, 8000).map((p) => [num(p[0], -90, 90), num(p[1], -180, 180)]).filter((p) => p[0] !== null && p[1] !== null)
        .map((p) => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5])
      : null;
    const times = (Array.isArray(r.times) ? r.times : []).map((t) => str(t, 5)).filter((t) => /^\d{2}:\d{2}$/.test(t)).sort().slice(0, 60);
    return {
      id: str(r.id, 20) || newId(4),
      name: str(r.name, 60) || 'สายใหม่',
      color: /^#[0-9a-f]{6}$/i.test(r.color) ? r.color : '#e11d48',
      speed: num(r.speed, 5, 90) || 30,
      note: str(r.note, 200),
      stops,
      road: r.road !== false,
      path: path && path.length >= 2 ? path : null,
      times,
    };
  });
  const oldDrivers = new Map(old.drivers.map((d) => [d.id, d]));
  const drivers = (Array.isArray(input.drivers) ? input.drivers : []).slice(0, 200).map((d) => {
    const id = str(d.id, 20) || newId(4);
    const prev = oldDrivers.get(id);
    const out = { id, name: str(d.name, 40) || 'คนขับ', plate: str(d.plate, 20), routeId: str(d.routeId, 20) };
    if (okPin(d.pin)) {
      out.salt = newId(8);
      out.pinHash = hashPin(d.pin, out.salt);
    } else if (prev?.pinHash) {
      out.salt = prev.salt;
      out.pinHash = prev.pinHash;
    }
    return out;
  });
  return { name: str(input.name, 80) || EMPTY.name, routes, drivers, updated: Date.now() };
}

const UA = { 'User-Agent': 'jabmue-bus/1.0 (https://github.com/jabmueai/jabmue-apps)', 'Accept-Language': 'th,en' };
function fetchT(url, ms = 8000) {
  return fetch(url, { headers: UA, signal: AbortSignal.timeout(ms) });
}
async function geocode(q) {
  try {
    const r = await fetchT(`https://nominatim.openstreetmap.org/search?format=json&limit=6&countrycodes=th&accept-language=th&q=${encodeURIComponent(q)}`);
    if (r.ok) {
      const j = await r.json();
      if (Array.isArray(j) && j.length) return j.map((p) => ({ name: p.display_name, lat: Number(p.lat), lng: Number(p.lon) }));
    }
  } catch { /* ลองอีกที่ */ }
  try {
    const r = await fetchT(`https://photon.komoot.io/api/?limit=6&lat=15&lon=101&q=${encodeURIComponent(q)}`);
    const j = await r.json();
    return (j.features || []).filter((f) => !f.properties.countrycode || f.properties.countrycode === 'TH').map((f) => {
      const p = f.properties;
      return { name: [p.name, p.district, p.city, p.county, p.state].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', '), lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] };
    });
  } catch { return []; }
}

async function handle(a, req, body) {
  // ---------- สาธารณะ ----------
  if (a === 'config') {
    return { cache: 15, data: publicConfig(await loadConfig()) };
  }

  if (a === 'live') {
    const all = await db.hgetall('live');
    const now = Date.now();
    const buses = [];
    for (const [id, b] of Object.entries(all)) {
      if (!b || now - b.ts > LIVE_KEEP_MS) {
        if (!b || now - b.ts > 6 * 3600 * 1000) await db.hdel('live', id);
        continue;
      }
      buses.push(b);
    }
    return { cache: 4, data: { now, buses } };
  }

  // ค้นหาสถานที่ (ผ่านเซิร์ฟเวอร์เรา จะได้ไม่โดนบล็อกจากเน็ต/VPN ของผู้ใช้) · Nominatim ก่อน ไม่ได้ค่อยใช้ Photon
  if (a === 'geo') {
    const q = str(req.query?.q, 120);
    if (q.length < 2) return { status: 400, data: { error: 'พิมพ์ชื่อสถานที่' } };
    const results = await geocode(q);
    return { cache: 86400, data: { results } };
  }

  // เส้นทางตามถนนจริงระหว่างป้าย (OSRM ข้อมูล OpenStreetMap)
  if (a === 'road') {
    const pts = String(req.query?.p || '').split(';').slice(0, 100)
      .map((x) => x.split(',').map(Number)).filter((x) => x.length === 2 && x.every(Number.isFinite));
    if (pts.length < 2) return { status: 400, data: { error: 'ต้องมีอย่างน้อย 2 ป้าย' } };
    const coords = pts.map(([lat, lng]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(';');
    const j = await fetchT(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`, 10000)
      .then((r) => r.json()).catch(() => ({}));
    if (j.code !== 'Ok') return { status: 502, data: { error: 'หาเส้นตามถนนไม่ได้' } };
    return { cache: 86400, data: { path: j.routes[0].geometry.coordinates.map(([x, y]) => [y, x]), meters: j.routes[0].distance } };
  }

  if (a === 'status') {
    const admin = await db.get('admin');
    return { data: { db: db.hasDb, hasAdmin: Boolean(admin || process.env.ADMIN_PIN) } };
  }

  // ---------- แอดมิน ----------
  if (a === 'setup') {
    if (process.env.ADMIN_PIN || (await db.get('admin'))) return { status: 409, data: { error: 'ตั้งรหัสแอดมินไปแล้ว' } };
    if (!okPin(body.pin)) return { status: 400, data: { error: 'รหัสต้องเป็นตัวเลข 4-8 หลัก' } };
    const salt = newId(8);
    await db.set('admin', { salt, hash: hashPin(body.pin, salt) });
    return { data: { token: await newSession({ role: 'admin' }) } };
  }

  if (a === 'admin-login') {
    if (await tooMany(req)) return { status: 429, data: { error: 'ลองผิดหลายครั้ง รอ 10 นาทีแล้วลองใหม่' } };
    const admin = await db.get('admin');
    const pin = String(body.pin || '');
    const good = process.env.ADMIN_PIN
      ? pin === process.env.ADMIN_PIN
      : admin && hashPin(pin, admin.salt) === admin.hash;
    if (!good) return { status: 401, data: { error: 'รหัสไม่ถูกต้อง' } };
    return { data: { token: await newSession({ role: 'admin' }) } };
  }

  if (a === 'admin-config' || a === 'save-config' || a === 'admin-pin') {
    const s = await session(body.token);
    if (s?.role !== 'admin') return { status: 401, data: { error: 'กรุณาเข้าสู่ระบบใหม่' } };
    const cfg = await loadConfig();
    if (a === 'admin-config') {
      return { data: { ...publicConfig(cfg), drivers: cfg.drivers.map(({ id, name, plate, routeId, pinHash }) => ({ id, name, plate, routeId, hasPin: Boolean(pinHash) })) } };
    }
    if (a === 'admin-pin') {
      if (process.env.ADMIN_PIN) return { status: 400, data: { error: 'รหัสแอดมินตั้งไว้ในการตั้งค่า Vercel (ADMIN_PIN)' } };
      if (!okPin(body.pin)) return { status: 400, data: { error: 'รหัสต้องเป็นตัวเลข 4-8 หลัก' } };
      const salt = newId(8);
      await db.set('admin', { salt, hash: hashPin(body.pin, salt) });
      return { data: { ok: true } };
    }
    if (JSON.stringify(body.config || {}).length > 900_000) return { status: 413, data: { error: 'ข้อมูลใหญ่เกินไป' } };
    const next = cleanConfig(body.config || {}, cfg);
    await db.set('config', next);
    // คนขับที่ถูกลบ: เอารถออกจากแผนที่
    const ids = new Set(next.drivers.map((d) => d.id));
    for (const d of cfg.drivers) if (!ids.has(d.id)) await db.hdel('live', d.id);
    return { data: { ok: true, updated: next.updated } };
  }

  // ---------- คนขับ ----------
  if (a === 'driver-login') {
    if (await tooMany(req)) return { status: 429, data: { error: 'ลองผิดหลายครั้ง รอ 10 นาทีแล้วลองใหม่' } };
    const cfg = await loadConfig();
    const d = cfg.drivers.find((x) => x.id === body.driverId);
    if (!d) return { status: 404, data: { error: 'ไม่พบชื่อคนขับ' } };
    if (!d.pinHash) return { status: 401, data: { error: 'ยังไม่ได้ตั้งรหัสให้คนขับคนนี้ ติดต่อแอดมิน' } };
    if (hashPin(body.pin, d.salt) !== d.pinHash) return { status: 401, data: { error: 'รหัสไม่ถูกต้อง' } };
    return { data: { token: await newSession({ role: 'driver', id: d.id }) } };
  }

  if (a === 'ping' || a === 'stop') {
    const s = await session(body.token);
    if (s?.role !== 'driver') return { status: 401, data: { error: 'กรุณาเข้าสู่ระบบใหม่' } };
    if (a === 'stop') {
      await db.hdel('live', s.id);
      return { data: { ok: true } };
    }
    const cfg = await loadConfig();
    const d = cfg.drivers.find((x) => x.id === s.id);
    if (!d) return { status: 401, data: { error: 'บัญชีคนขับถูกลบแล้ว' } };
    const lat = num(body.lat, -90, 90);
    const lng = num(body.lng, -180, 180);
    if (lat === null || lng === null) return { status: 400, data: { error: 'ตำแหน่งไม่ถูกต้อง' } };
    const routeId = cfg.routes.some((r) => r.id === body.routeId) ? body.routeId : d.routeId;
    const bus = {
      id: d.id, name: d.name, plate: d.plate, routeId,
      dir: body.dir === -1 ? -1 : 1,
      lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6,
      spd: num(body.spd, 0, 60), // เมตร/วินาที
      acc: num(body.acc, 0, 100000),
      full: Boolean(body.full),
      along: num(body.along, 0, 1e7),
      off: num(body.off, 0, 1e7),
      ts: Date.now(),
    };
    await db.hset('live', d.id, bus);
    return { data: { ok: true, ts: bus.ts } };
  }

  return { status: 404, data: { error: 'ไม่รู้จักคำสั่ง' } };
}

export default async function handler(req, res) {
  const a = String(req.query?.a || '');
  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const isRead = ['config', 'live', 'status', 'geo', 'road'].includes(a);
  if (!isRead && req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }
  try {
    const out = await handle(a, req, body);
    res.setHeader('Cache-Control', out.cache ? `public, s-maxage=${out.cache}, stale-while-revalidate=${out.cache * 2}` : 'no-store');
    res.status(out.status || 200).json(out.data);
  } catch (e) {
    console.error(e);
    res.setHeader('Cache-Control', 'no-store');
    res.status(500).json({ error: 'ระบบขัดข้อง ลองใหม่อีกครั้ง' });
  }
}
