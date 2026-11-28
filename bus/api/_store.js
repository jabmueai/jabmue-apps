// ที่เก็บข้อมูล: ใช้ Upstash Redis (เชื่อมผ่านเมนู Storage ของ Vercel) ถ้ายังไม่ได้เชื่อม จะเก็บในหน่วยความจำชั่วคราว
// ไฟล์ขึ้นต้นด้วย _ จึงไม่ถูกเปิดเป็น API

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';

export const hasDb = Boolean(URL_ && TOKEN);

async function redis(...cmd) {
  const r = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error('db: ' + (j.error || r.status));
  return j.result;
}

// ---- โหมดหน่วยความจำ (ใช้ทดสอบในเครื่อง / ก่อนเชื่อมฐานข้อมูล) ----
const mem = globalThis.__busMem || (globalThis.__busMem = { kv: new Map(), h: new Map() });
const alive = (e) => e && (!e.exp || e.exp > Date.now());

export async function get(key) {
  if (hasDb) {
    const v = await redis('GET', key);
    return v == null ? null : JSON.parse(v);
  }
  const e = mem.kv.get(key);
  return alive(e) ? e.v : null;
}

export async function set(key, val, ttlSec) {
  if (hasDb) {
    const s = JSON.stringify(val);
    return ttlSec ? redis('SET', key, s, 'EX', String(ttlSec)) : redis('SET', key, s);
  }
  mem.kv.set(key, { v: val, exp: ttlSec ? Date.now() + ttlSec * 1000 : 0 });
}

export async function del(key) {
  if (hasDb) return redis('DEL', key);
  mem.kv.delete(key);
}

export async function incr(key, ttlSec) {
  if (hasDb) {
    const n = await redis('INCR', key);
    if (n === 1) await redis('EXPIRE', key, String(ttlSec));
    return n;
  }
  const e = mem.kv.get(key);
  const n = (alive(e) ? e.v : 0) + 1;
  mem.kv.set(key, { v: n, exp: alive(e) ? e.exp : Date.now() + ttlSec * 1000 });
  return n;
}

export async function hset(key, field, val) {
  if (hasDb) return redis('HSET', key, field, JSON.stringify(val));
  if (!mem.h.has(key)) mem.h.set(key, new Map());
  mem.h.get(key).set(field, val);
}

export async function hdel(key, field) {
  if (hasDb) return redis('HDEL', key, field);
  mem.h.get(key)?.delete(field);
}

export async function hgetall(key) {
  if (hasDb) {
    const arr = (await redis('HGETALL', key)) || [];
    const out = {};
    for (let i = 0; i < arr.length; i += 2) {
      try { out[arr[i]] = JSON.parse(arr[i + 1]); } catch { /* ข้าม */ }
    }
    return out;
  }
  return Object.fromEntries(mem.h.get(key) || []);
}
