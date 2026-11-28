// QA ครบทุกบทบาท (ต้องมี playwright): node tests/qa.cjs <BASE_URL> <โฟลเดอร์เก็บภาพ> <รหัสแอดมิน> [fresh]
// ไม่ใส่ fresh = ทดสอบเว็บที่ใช้งานจริง จะสำรองข้อมูลก่อน แล้วคืนค่าให้ตอนจบ
const { chromium, devices } = require('playwright');
const [BASE, SP, PIN, FRESH] = process.argv.slice(2);
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok: !!ok, extra }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };
const shot = (p, n) => p.screenshot({ path: `${SP}/qa-${n}.png`, fullPage: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// จุดทดสอบ: ถนนในขอนแก่น (มีถนนจริงให้ OSRM)
const STOPS = [[16.4419, 102.8360], [16.4300, 102.8230], [16.4180, 102.8100]];

async function ctx(b, geo) {
  return b.newContext({ ...devices['iPhone 13'], geolocation: { latitude: geo[0], longitude: geo[1] }, permissions: ['geolocation'], locale: 'th-TH', serviceWorkers: 'block' });
}
function watch(p, tag, errs) {
  p.on('pageerror', (e) => errs.push(`${tag}: ${e.message}`));
  p.on('response', (r) => { if (r.status() >= 500) errs.push(`${tag}: HTTP ${r.status()} ${r.url()}`); });
}
async function apiCall(req, a, body, params = '') {
  const r = body ? await req.post(`${BASE}/api/bus?a=${a}${params}`, { data: body }) : await req.get(`${BASE}/api/bus?a=${a}${params}`);
  let j = {}; try { j = await r.json(); } catch {}
  return { s: r.status(), j };
}
async function tapMap(p, sel, lat, lng) {
  await p.locator(sel).scrollIntoViewIfNeeded();
  const pt = await p.evaluate(([lat, lng]) => { const m = editMap; m.setView([lat, lng], 15, { animate: false }); const c = m.latLngToContainerPoint([lat, lng]); const r = m.getContainer().getBoundingClientRect(); return { x: r.left + c.x, y: r.top + c.y }; }, [lat, lng]);
  await sleep(300);
  await p.touchscreen.tap(pt.x, pt.y);
  await sleep(500);
}

(async () => {
  const b = await chromium.launch(BASE.startsWith('https') && process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {});
  const errs = [];
  const QA = 'QA ทดสอบ';

  // ================= API / ความปลอดภัย =================
  const cr = await ctx(b, STOPS[0]);
  const req = cr.request;
  let st = await apiCall(req, 'status');
  check('API status ตอบ', st.s === 200, JSON.stringify(st.j));
  check('ping ไม่มี token → 401', (await apiCall(req, 'ping', { lat: 1, lng: 1 })).s === 401);
  check('save-config ไม่มี token → 401', (await apiCall(req, 'save-config', { config: {} })).s === 401);
  check('GET คำสั่งเขียน → 405', (await apiCall(req, 'save-config')).s === 405);
  check('คำสั่งไม่รู้จัก → 404', (await apiCall(req, 'xyz', {})).s === 404);
  const g = await apiCall(req, 'geo', null, '&q=' + encodeURIComponent('บ้านไผ่ ขอนแก่น'));
  check('ค้นหาสถานที่ผ่านเซิร์ฟเวอร์', g.s === 200 && g.j.results?.length > 0, g.j.results?.[0]?.name?.slice(0, 50));
  const rd = await apiCall(req, 'road', null, '&p=' + STOPS.map((x) => x.join(',')).join(';'));
  check('เส้นตามถนนผ่านเซิร์ฟเวอร์', rd.s === 200 && rd.j.path?.length > 2, rd.j.meters ? `${Math.round(rd.j.meters)} ม.` : JSON.stringify(rd.j));

  // ================= แอดมิน =================
  const ca = await ctx(b, STOPS[0]);
  const a = await ca.newPage();
  watch(a, 'admin', errs);
  const prompts = [];
  a.on('dialog', (d) => { prompts.push(d.message()); d.accept(d.type() === 'prompt' ? (globalThis.nextPrompt ?? d.defaultValue()) : undefined); });
  await a.goto(BASE + '/admin');
  await sleep(1500);
  if (FRESH) {
    await a.fill('#sp1', '12'); await a.fill('#sp2', '12'); await a.click('#btnSetup');
    check('ตั้งรหัสสั้นเกิน → เตือน', await a.isVisible('#spErr'));
    await a.fill('#sp1', PIN); await a.fill('#sp2', PIN + '9'); await a.click('#btnSetup');
    check('รหัสสองช่องไม่ตรง → เตือน', (await a.textContent('#spErr')).includes('ไม่ตรง'));
    await a.fill('#sp2', PIN); await a.click('#btnSetup');
  } else {
    await a.fill('#lp', '0000'); await a.click('#btnLogin'); await sleep(1200);
    check('รหัสผู้ดูแลผิด → เตือน', await a.isVisible('#lpErr'), await a.textContent('#lpErr'));
    await a.fill('#lp', PIN); await a.click('#btnLogin');
  }
  await a.waitForSelector('#vMain:not(.hide)', { timeout: 15000 });
  check('ผู้ดูแลเข้าระบบได้', true);
  const token = await a.evaluate(() => token);
  const backup = (await apiCall(req, 'admin-config', { token })).j;
  check('แผนที่ Leaflet โหลด (ไฟล์ในเว็บเอง)', await a.evaluate(() => typeof L === 'object' && !!document.querySelector('script[src="/vendor/leaflet/leaflet.js"]')));

  // สร้างสาย QA
  await a.click('[data-t=routes]');
  await a.click('#btnAddRoute');
  await a.fill('#reName', `${QA} <b>สาย</b>`);
  await sleep(400);
  const tiles = await a.locator('#editMap .leaflet-tile-loaded').count();
  check('ภาพแผนที่ขึ้นในหน้าแก้สาย', tiles > 0, `${tiles} ภาพ`);
  await a.fill('#reSearch', 'บ้านไผ่');
  await a.press('#reSearch', 'Enter');
  await a.waitForSelector('#searchRes [data-ll]', { timeout: 15000 }).catch(() => {});
  const nres = await a.locator('#searchRes [data-ll]').count();
  check('ค้นหาที่อยู่ในหน้าแอดมิน', nres > 0, `${nres} ผลลัพธ์`);
  if (nres) { await a.click('#searchRes [data-ll]'); check('กดผลค้นหาแล้วแผนที่ย้าย', Math.abs((await a.evaluate(() => editMap.getCenter().lat)) - 16.3) < 0.3); }
  const names = ['ต้นสาย หน้าตลาด', 'หน้าวัด', 'ปลายสาย โรงเรียน'];
  for (let i = 0; i < 3; i++) { globalThis.nextPrompt = names[i]; await tapMap(a, '#editMap', ...STOPS[i]); }
  globalThis.nextPrompt = undefined;
  let stopsTxt = await a.textContent('#stopList');
  check('แตะแผนที่เพิ่มป้าย 3 ป้าย', names.every((n) => stopsTxt.includes(n)));
  await a.waitForFunction(() => cur().path && cur().path.length > 2, null, { timeout: 15000 }).catch(() => {});
  check('ลากเส้นตามถนนอัตโนมัติ', await a.evaluate(() => !!(cur().path && cur().path.length > 2)), await a.textContent('#roadStatus'));
  // แก้ชื่อ/เลื่อน/ลบ
  globalThis.nextPrompt = 'หน้าวัดใหม่';
  await a.click('#stopList [data-a=ren][data-i="1"]');
  globalThis.nextPrompt = undefined;
  check('เปลี่ยนชื่อป้าย', (await a.textContent('#stopList')).includes('หน้าวัดใหม่'));
  await a.click('#stopList [data-a=down][data-i="0"]');
  check('เลื่อนลำดับป้าย', (await a.evaluate(() => cur().stops[0].name)) === 'หน้าวัดใหม่');
  await a.click('#stopList [data-a=up][data-i="1"]');
  check('เลื่อนกลับ', (await a.evaluate(() => cur().stops[0].name)) === names[0]);
  globalThis.nextPrompt = 'ป้ายจะลบ';
  await tapMap(a, '#editMap', 16.45, 102.85);
  globalThis.nextPrompt = undefined;
  await a.click('#stopList [data-a=del][data-i="3"]');
  check('ลบป้าย', (await a.evaluate(() => cur().stops.length)) === 3);
  await a.waitForFunction(() => cur().path && cur().path.length > 2, null, { timeout: 15000 }).catch(() => {});
  await a.fill('#reTimeIn', '6.00 07:30 1600 25:00 abc 6:00');
  await a.click('#btnAddTime');
  check('ใส่เวลาหลายแบบ กรองค่าผิด/ซ้ำ', JSON.stringify(await a.evaluate(() => cur().times)) === '["06:00","07:30","16:00"]', JSON.stringify(await a.evaluate(() => cur().times)));
  await a.click('#reTimes .chip-x >> nth=2');
  check('ลบเวลา', (await a.evaluate(() => cur().times.length)) === 2);
  await a.selectOption('#reSpeed', '20');
  await a.fill('#reNote', 'ค่าโดยสาร 20 บาท');
  await a.click('#reColors [data-c="#2563eb"]');
  await shot(a, 'admin-route');
  // คนขับ
  await a.click('[data-t=drivers]');
  await a.click('#btnAddDriver');
  const card = a.locator('#driverList .card').last();
  await card.locator('[data-f=name]').fill(`${QA} ลุงสมชาย`);
  await card.locator('[data-f=plate]').fill('10-1234 ขก');
  const rid = await a.evaluate(() => cfg.routes.find((r) => r.name.startsWith('QA'))?.id);
  await card.locator('[data-f=routeId]').selectOption(rid);
  await card.locator('[data-f=pin]').fill('12');
  await sleep(1800);
  check('รหัสคนขับสั้นเกิน ยังไม่บันทึก', !(await a.evaluate(() => cfg.drivers[cfg.drivers.length - 1].hasPin)));
  await card.locator('[data-f=pin]').fill('4321');
  await sleep(2500);
  check('รหัสคนขับบันทึกแล้ว (ป้าย "ตั้งแล้ว")', (await a.locator('#driverList .card').last().textContent()).includes('ตั้งแล้ว'));
  await shot(a, 'admin-drivers');
  // ตั้งค่า
  await a.click('[data-t=settings]');
  check('ลิงก์ผู้โดยสารแสดง', (await a.textContent('#passUrl')).startsWith(BASE));
  check('ปุ่ม LINE มีลิงก์', (await a.getAttribute('#linePassenger', 'href')).startsWith('https://line.me/R/share'));
  const [dl] = await Promise.all([a.waitForEvent('download'), a.click('#btnBackup')]);
  const bk = JSON.parse(require('fs').readFileSync(await dl.path(), 'utf8'));
  check('ดาวน์โหลดสำรองข้อมูล (ไม่มีรหัส)', bk.routes.length > 0 && !JSON.stringify(bk).includes('pinHash'));
  // โหลดใหม่ ข้อมูลยังอยู่
  await sleep(1500);
  await a.reload(); await a.waitForSelector('#vMain:not(.hide)');
  const saved = await a.evaluate(() => cfg.routes.find((r) => r.name.startsWith('QA')));
  check('รีเฟรชแล้วข้อมูลสายยังอยู่ครบ', saved && saved.stops.length === 3 && saved.speed === 20 && saved.color === '#2563eb' && saved.note === 'ค่าโดยสาร 20 บาท' && saved.path?.length > 2);
  const cfgPub = (await apiCall(req, 'config')).j;
  check('config สาธารณะไม่มีรหัสคนขับ', !JSON.stringify(cfgPub).includes('pinHash') && !JSON.stringify(cfgPub).includes('salt'));
  const route = cfgPub.routes.find((r) => r.name.startsWith('QA')) || saved;
  const driverId = (await a.evaluate(() => cfg.drivers.find((d) => d.name.startsWith('QA')).id));

  // ================= คนขับ =================
  const cd = await ctx(b, [route.stops[0].lat, route.stops[0].lng]);
  const d = await cd.newPage();
  watch(d, 'driver', errs);
  d.on('dialog', (x) => x.accept());
  await d.goto(BASE + '/driver');
  await d.waitForSelector('#vWho:not(.hide)');
  await d.click(`#whoList [data-id="${driverId}"]`);
  for (const k of '9999') await d.click(`#pad [data-k="${k}"]`);
  await d.click('#pad [data-k="ตกลง"]');
  await sleep(1200);
  check('คนขับใส่รหัสผิด → เตือน', await d.isVisible('#pinErr'));
  for (const k of '4321') await d.click(`#pad [data-k="${k}"]`);
  await d.click('#pad [data-k="ลบ"]'); await d.click('#pad [data-k="1"]');
  await d.click('#pad [data-k="ตกลง"]');
  await d.waitForSelector('#vReady:not(.hide)', { timeout: 10000 });
  check('คนขับเข้าระบบได้ (ปุ่มลบทำงาน)', true);
  await d.click(`#routeList [data-r="${route.id}"]`).catch(() => {});
  await d.click('#dirList [data-d="1"]');
  await shot(d, 'driver-ready');
  await d.click('#btnStart');
  await sleep(2500);
  let live = (await apiCall(req, 'live')).j;
  let mine = live.buses.find((x) => x.id === driverId);
  check('เริ่มวิ่ง → ตำแหน่งขึ้นเซิร์ฟเวอร์', !!mine);
  // วิ่งไปป้าย 2 แบบค่อย ๆ ขยับ
  const path = route.path;
  const at = (f) => path[Math.floor((path.length - 1) * f)];
  for (const f of [0.15, 0.3, 0.4]) { await cd.setGeolocation({ latitude: at(f)[0], longitude: at(f)[1] }); await sleep(9500); }
  live = (await apiCall(req, 'live')).j; mine = live.buses.find((x) => x.id === driverId);
  check('รถขยับ ตำแหน่งอัปเดต', mine && mine.along > 300, mine ? `along ${Math.round(mine.along)} ม.` : '');
  check('หน้าคนขับบอกป้ายถัดไป', (await d.textContent('#runNext')).includes('ป้ายถัดไป'), await d.textContent('#runNext'));
  await d.click('#btnFull'); await sleep(14000);
  live = (await apiCall(req, 'live')).j; mine = live.buses.find((x) => x.id === driverId);
  check('ปุ่มรถเต็ม ส่งถึงเซิร์ฟเวอร์', mine?.full === true);
  await shot(d, 'driver-run');

  // ================= ผู้โดยสาร =================
  const cp = await ctx(b, [route.stops[2].lat + 0.0003, route.stops[2].lng]);
  const p = await cp.newPage();
  watch(p, 'passenger', errs);
  await p.goto(BASE + '/');
  await sleep(2500);
  if (await p.isVisible('#vRoutes')) {
    const txt = await p.textContent('#routeList');
    check('หน้าเลือกสาย แสดงจำนวนรถวิ่ง', txt.includes('วิ่งอยู่ 1 คัน'));
    await p.click(`#routeList [data-r="${route.id}"]`);
  }
  await p.click('#btnNear'); await sleep(1500);
  check('หาป้ายใกล้ฉัน เลือกปลายสายให้', (await p.textContent('#stopList .on')).includes('ปลายสาย'));
  await p.click('#stopList .on'); await sleep(1500);
  const eta1 = await p.textContent('#nextEta'), info1 = await p.textContent('#nextInfo');
  check('ผู้โดยสารเห็นเวลาถึง (รถกำลังมา)', /ประมาณ \d+/.test(eta1) && (await p.textContent('#nextLb')).includes('จะถึงป้าย'), `${eta1} · ${info1}`);
  check('แสดงทะเบียน + รถเต็ม', info1.includes('10-1234') && info1.includes('รถเต็ม'));
  check('ชื่อมี HTML ถูก escape', (await p.innerHTML('#wRoute')).includes('&lt;b&gt;'));
  check('ภาพแผนที่ผู้โดยสารขึ้น', (await p.locator('#map .leaflet-tile-loaded').count()) > 0);
  check('มีหมุดรถบนแผนที่', (await p.locator('#map .bus-pin').count()) === 1);
  check('ตารางเวลา + ประกาศ', (await p.textContent('#times')).includes('07:30') && (await p.textContent('#routeNote')).includes('20 บาท'));
  await p.click('#btnSpeak');
  await shot(p, 'pass-coming');
  // ป้ายต้นสาย: รถผ่านไปแล้ว
  await p.click('#btnChange'); await p.click('#stopList [data-i="0"]'); await sleep(800);
  check('ป้ายที่รถผ่านแล้ว → "ผ่านไปแล้ว"', (await p.textContent('#nextLb')).includes('ผ่านไปแล้ว'), await p.textContent('#nextEta'));
  // ลิงก์ที่แชร์
  const share = `${BASE}/?r=${route.id}&s=${route.stops[1].id}`;
  const p2 = await cp.newPage(); watch(p2, 'shared', errs);
  await p2.goto(share); await sleep(2500);
  check('เปิดลิงก์ที่เพื่อนส่ง → ตรงไปป้ายนั้น', (await p2.textContent('#wStop')).includes(route.stops[1].name));
  await p2.close();
  await p.reload(); await sleep(2500);
  check('เปิดครั้งหน้า จำป้ายเดิม', await p.isVisible('#vWatch'));

  // คนขับกลับรถ: วิ่งย้อนเกิน 400 ม. → สลับทางเอง
  for (const f of [0.3, 0.15]) { await cd.setGeolocation({ latitude: at(f)[0], longitude: at(f)[1] }); await sleep(9500); }
  live = (await apiCall(req, 'live')).j; mine = live.buses.find((x) => x.id === driverId);
  check('กลับรถ → ระบบสลับทางให้อัตโนมัติ', mine?.dir === -1 && (await d.textContent('#runDir')).includes(route.stops[0].name), `dir ${mine?.dir}`);
  await p.click('#btnChange'); await p.click('#stopList [data-i="0"]'); await sleep(11000);
  check('ผู้โดยสารต้นสายเห็นรถขากลับกำลังมา', (await p.textContent('#nextLb')).includes('จะถึงป้าย'), await p.textContent('#nextEta'));
  await d.click('#btnFlip'); await sleep(14000);
  live = (await apiCall(req, 'live')).j; mine = live.buses.find((x) => x.id === driverId);
  check('ปุ่มสลับทางเอง', mine?.dir === 1);
  // รีโหลดหน้าคนขับระหว่างวิ่ง → แชร์ต่อ
  await d.reload(); await sleep(3000);
  check('รีเฟรชหน้าคนขับ → แชร์ต่ออัตโนมัติ', await d.isVisible('#vRun'));
  // แอดมินเห็นรถ
  await a.click('[data-t=live]'); await sleep(2500);
  check('แอดมินเห็นรถในแท็บดูรถ', (await a.textContent('#liveList')).includes('ลุงสมชาย'));
  await shot(a, 'admin-live');
  // หยุดวิ่ง
  await d.click('#btnStop'); await sleep(14000);
  live = (await apiCall(req, 'live')).j;
  check('หยุดวิ่ง → รถหายจากระบบ', !live.buses.some((x) => x.id === driverId));
  check('หยุดแล้วกลับหน้าพร้อมออกรถ', await d.isVisible('#vReady'));

  // แอดมินลบคนขับ → คนขับถูกเด้งออก
  await a.click('[data-t=drivers]');
  const idx = await a.evaluate(() => cfg.drivers.findIndex((x) => x.name.startsWith('QA')));
  await a.click(`#driverList [data-del="${idx}"]`);
  await sleep(2500);
  check('ลบคนขับแล้ว ping ถูกปฏิเสธ', (await apiCall(req, 'ping', { token: await d.evaluate(() => me.token), lat: 16.4, lng: 102.8 })).s === 401);

  // ================= คืนค่าข้อมูลเดิม =================
  if (!FRESH) {
    const restore = { name: backup.name, routes: backup.routes, drivers: backup.drivers.map(({ id, name, plate, routeId }) => ({ id, name, plate, routeId })) };
    const r = await apiCall(req, 'save-config', { token, config: restore });
    const after = (await apiCall(req, 'admin-config', { token })).j;
    check('คืนข้อมูลเดิมของผู้ใช้', r.s === 200 && !after.routes.some((x) => x.name.startsWith('QA')) && after.routes.length === backup.routes.length);
  }
  check('ไม่มี JS error / 500', errs.length === 0, errs.join(' | ').slice(0, 400));
  const fail = results.filter((x) => !x.ok);
  console.log(`\n${results.length - fail.length}/${results.length} ผ่าน`);
  require('fs').writeFileSync(`${SP}/qa-result-${FRESH ? 'local' : 'live'}.json`, JSON.stringify(results, null, 1));
  await b.close();
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
