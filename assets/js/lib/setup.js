'use strict';
// What a new project needs before anybody can record anything. A deposit needs a source, a waste type and a
// depositor; a sale needs a buyer, a receiver and a type; both print the school name and the deposit point on
// their slip. Until all of that exists the screens would offer empty dropdowns, so the shell keeps every
// screen but ตั้งค่า shut (app.js) and the settings screen says which panel is still empty (pages/settings.js).
//
// This is courtesy, not a security boundary: the database refuses a deposit with no source whatever the
// screen shows, because deposit.source_id is NOT NULL and references waste_source (db/deploy/001_tables.sql). What
// this adds is telling the user which setting is missing instead of showing an empty select.
//
// `panel` is the ตั้งค่า panel heading that fixes the requirement; settings.js matches on that text, so the
// two must stay in step (tests/js/setup_gate.test.js asserts every panel named here is a panel that exists).
// An inactive row does not count anywhere: the deposit and sale screens list only the active ones, so a single
// deactivated waste type - or the only depositor switched off - leaves the screen just as unusable as none at all.
const REQS = [
  {
    key: 'school',
    panel: 'ข้อมูลทั่วไป',
    label: 'ชื่อโรงเรียน / หน่วยงาน',
    ok: db => !!String(db.school || '').trim(),
  },
  { key: 'point', panel: 'ข้อมูลทั่วไป', label: 'จุดรับฝากหลัก', ok: db => !!String(db.point || '').trim() },
  {
    key: 'types',
    panel: 'ประเภทขยะและราคาอ้างอิง',
    label: 'ประเภทขยะที่เปิดรับฝาก อย่างน้อย 1 ประเภท',
    ok: db => db.types.some(t => t.active),
  },
  {
    key: 'sources',
    panel: 'แหล่งที่มาของขยะ',
    label: 'แหล่งที่มาของขยะที่เปิดใช้ อย่างน้อย 1 แห่ง',
    ok: db => db.sources.some(s => s.active),
  },
  {
    key: 'buyers',
    panel: 'ผู้รับซื้อ',
    label: 'ผู้รับซื้อที่เปิดใช้ อย่างน้อย 1 ร้าน',
    ok: db => db.buyers.some(b => b.active),
  },
  {
    key: 'depositors',
    panel: 'ผู้รับฝาก',
    label: 'ผู้รับฝากที่เปิดใช้ อย่างน้อย 1 คน',
    ok: db => db.depositors.some(x => x.active),
  },
  {
    key: 'receivers',
    panel: 'ผู้รับเงิน',
    label: 'ผู้รับเงินที่เปิดใช้ อย่างน้อย 1 คน',
    ok: db => db.receivers.some(x => x.active),
  },
];

// Every requirement, in the order they are presented. Read-only copies: a caller cannot reach `ok`.
export const SETUP_KEYS = REQS.map(r => r.key);
export const SETUP_PANELS = [...new Set(REQS.map(r => r.panel))];

// What is still missing, as {key, panel, label}. Empty means the app is ready.
export function setupGaps(db) {
  return REQS.filter(r => !r.ok(db)).map(({ key, panel, label }) => ({ key, panel, label }));
}
export const setupReady = db => setupGaps(db).length === 0;
// What one ตั้งค่า panel is missing, for the warning inside that panel.
export const panelGaps = (db, panel) => setupGaps(db).filter(g => g.panel === panel);
