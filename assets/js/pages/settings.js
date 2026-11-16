'use strict';
// The settings screen: school details and logo, waste types and their reference prices, sources, buyers, depositors,
// receivers, and the audit trail. Master data has no RPC: an admin writes these tables directly (db/deploy/005_policies.sql) and
// the audit row goes in through log_audit(). Nothing here edits db; every change is read back from the server.
//
// THIS SCREEN ONLY SETS THE SYSTEM UP. It lists what has been set and lets an admin change it; it does not look
// anything up. Searching the records belongs where the records are: a type's price history and the reference prices
// are on รายงาน, the sources and the depositors are columns of ทะเบียนใบรับฝาก, the buyers and the receivers are
// columns of ทะเบียนใบขาย. So there is no search box here and no column counting documents - a number on this
// screen is a count of what is configured, never of what has been recorded.
//
// EVERY PANEL IS THE SAME TWO THINGS: a table that reports what is configured, one row per thing with a single
// แก้ไข button, and a ＋ button in the heading. Both open the SAME sheet (App.form), so adding a waste type and
// renaming a buyer are one gesture, and switching a row off or deleting a name is in that sheet's footer, beside
// the values it changes. Nothing is written when the sheet closes: a change to master data is confirmed against the
// old value first (App.review with diff()), because slips already printed were written from it.
import { esc, fmt, date, round } from '../lib/fmt.js';
import { row, ptable } from '../lib/table.js';
import {
  db,
  S,
  $,
  today,
  TH,
  COLORS,
  SRCCOLORS,
  tchip,
  schip,
  field,
  inp,
  heading,
  diff,
  impact,
  stock,
  refPrice,
} from '../ui.js';
import { App } from '../app.js';
import { setupGaps, panelGaps } from '../lib/setup.js';
import * as Api from '../api.js';
import * as Store from '../store.js';
let busy = false;
// Courtesy, like every other ifAdmin: the database refuses a viewer's write whatever a screen offers. This only
// keeps a sheet from opening on a row nobody could save.
const isAdmin = () => App.ifAdmin('1') === '1';
async function commit(write, slices, done, resync) {
  if (busy) return false;
  busy = true;
  // busy stays up through the redraw: until the screen shows the server's state the duplicate-name checks read stale data.
  try {
    try {
      await write();
    } catch (x) {
      Store.markStale();
      App.fail(x);
      if (resync) App.render();
      return false;
    }
    let ok = await App.reload(slices);
    if (ok && done) App.notify(done);
    return ok ? true : 'stalled';
  } finally {
    busy = false;
  }
}

// ---- the lists' shared furniture --------------------------------------------------------------
const pills = a => a.map(([l, v]) => '<span class="phnum">' + l + ' <b>' + v + '</b></span>').join('');
// A register on a desktop, a list of cards on a phone: `cardtbl` plus the column name on every cell (lib/table.js
// row(cells, head)) is what the stylesheet turns into cards under 760px.
const ctable = (head, rows) =>
  '<div class="tablewrap cardtbl"><table><thead><tr>' +
  head.map(h => '<th>' + h + '</th>').join('') +
  '</tr></thead><tbody>' +
  (rows.length ? rows.join('') : '<tr><td class="empty" colspan="' + head.length + '">ยังไม่มีรายการ</td></tr>') +
  '</tbody></table></div>';
const dash = '<span class="muted">—</span>';
const statusBadge = on => (on ? '<span class="badge ok">เปิดใช้</span>' : '<span class="badge pending">ปิดอยู่</span>');
// One whole button per list, written out: a handler is never built by concatenation (tests/js/inline_handlers.test.js).
// An empty argument opens the sheet with nothing in it, which is how a row is added.
const ADD = {
  general: '<button type="button" onclick="App.editGeneral()">แก้ไขข้อมูลทั่วไป</button>',
  types: '<button type="button" class="primary" onclick="App.editType(\'\')">＋ เพิ่มประเภท</button>',
  sources: '<button type="button" class="primary" onclick="App.editSource(\'\')">＋ เพิ่มแหล่งที่มา</button>',
  buyers: '<button type="button" class="primary" onclick="App.editBuyer(\'\')">＋ เพิ่มผู้รับซื้อ</button>',
  depositors: '<button type="button" class="primary" onclick="App.editDepositor(\'\')">＋ เพิ่มผู้รับฝาก</button>',
  receivers: '<button type="button" class="primary" onclick="App.editReceiver(\'\')">＋ เพิ่มผู้รับเงิน</button>',
};
// Turning master data OFF takes something away from the forms, so it is confirmed and says what stays; turning it
// back ON cannot lose anything, so it is not asked about at all.
async function offOk(kind, name, extra) {
  return App.review({
    tone: 'warn',
    title: 'ปิดใช้งาน' + kind,
    sub: name,
    body: impact('ปิดใช้งาน ไม่ใช่ลบ', extra + ' · ใบเดิมและรายงานยังแสดงครบ · เปิดคืนได้ทุกเมื่อ'),
    confirm: 'ยืนยันปิดใช้งาน',
  });
}
// A change to a row that already exists: the old value against the new one, and what the change does not touch.
const editOk = (title, name, rows, extra = '') =>
  App.review({ tone: 'warn', title, sub: name, body: diff(rows) + extra, confirm: 'ยืนยันการแก้ไข' });
const colorField = (label, id, value, hint = '') =>
  field(
    label,
    '<div class="cpick">' +
      inp(id, 'color', value, 'aria-label="' + label + '"') +
      (hint ? '<small class="muted">' + hint + '</small>' : '') +
      '</div>',
  );

// ---- ข้อมูลทั่วไป -----------------------------------------------------------------------------
function generalBody() {
  return (
    '<div class="setvals"><div><small class="muted">ชื่อโรงเรียน / หน่วยงาน</small><b>' +
    (esc(db.school) || dash) +
    '</b></div><div><small class="muted">จุดรับฝากหลัก</small><b>' +
    (esc(db.point) || dash) +
    '</b></div></div>' +
    '<div class="logoset"><label>โลโก้โรงเรียน <span class="muted">(แสดงที่มุมซ้ายบนทุกหน้า)</span></label><div class="logoprev"><div class="brand"><span class="mark' +
    (db.schoolLogo ? ' hasimg' : '') +
    '">' +
    (db.schoolLogo ? '<img src="' + esc(db.schoolLogo) + '" alt="">' : S.brand) +
    '</span><div><b>ระบบธนาคารขยะ</b><small>' +
    esc(db.school) +
    '</small></div></div></div>' +
    App.ifAdmin(
      '<div class="logoacts"><input type="file" id="logofile" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" hidden onchange="App.setLogo(this)"><button type="button" onclick="App.$(\'logofile\').click()">เปลี่ยนโลโก้</button>' +
        (db.schoolLogo ? '<button type="button" class="minibtn" onclick="App.resetLogo()">ใช้โลโก้เดิม</button>' : '') +
        '<small class="muted">รองรับ PNG, JPG, WebP, SVG • ระบบตัดขอบว่างและย่อขนาดให้อัตโนมัติ</small></div>',
    ) +
    '</div>'
  );
}
async function editGeneral() {
  if (!isAdmin()) return;
  const was = { school: db.school, point: db.point };
  const ok = await App.form({
    title: 'ข้อมูลทั่วไป',
    sub: 'ชื่อที่พิมพ์บนใบและจุดรับฝากที่ขึ้นบนใบรับฝากทุกใบ',
    body:
      '<div class="formgrid two">' +
      field('ชื่อโรงเรียน / หน่วยงาน *', inp('school', 'text', db.school, 'required maxlength="150"')) +
      // The point is typed in, never prefilled: the placeholder shows the shape of an answer without putting a
      // made-up one in the box, where it would be saved unread and printed on every deposit slip.
      field(
        'จุดรับฝากหลัก *',
        inp('point', 'text', db.point, 'required maxlength="120" placeholder="เช่น จุดรับฝากหน้าอาคารเรียน"'),
      ) +
      '</div>',
    confirm: 'ตรวจทานการแก้ไข',
  });
  if (!ok) return;
  const school = $('school').value.trim(),
    point = $('point').value.trim();
  if (!school || !point) return App.notify('กรอกชื่อโรงเรียนและจุดรับฝาก');
  if (school === was.school && point === was.point) return App.notify('ยังไม่มีอะไรเปลี่ยนในข้อมูลทั่วไป');
  if (
    !(await editOk(
      'ยืนยันการแก้ไขข้อมูลทั่วไป',
      school,
      [
        ['ชื่อโรงเรียน', esc(was.school) || '—', esc(school)],
        ['จุดรับฝากหลัก', esc(was.point) || '—', esc(point)],
      ],
      impact('ใบเดิมไม่เปลี่ยน', 'ใบรับฝากที่บันทึกไปแล้วเก็บจุดรับฝากที่ใช้ตอนนั้นไว้ในใบของมันเอง'),
    ))
  )
    return;
  await commit(
    async () => {
      await Api.saveGeneral({ school, point });
      await Api.audit('แก้ไขข้อมูลทั่วไป');
    },
    ['settings'],
    'บันทึกแล้ว',
  );
}

// ---- ประเภทขยะและราคาอ้างอิง -------------------------------------------------------------------
const TH_TYPES = ['ประเภท', 'คำอธิบาย', 'ราคาอ้างอิง (บาท/กก.)', 'สถานะ', ''];
function typeList() {
  return ctable(
    TH_TYPES,
    db.types.map(t => {
      const last = t.prices
        .slice()
        .sort((a, b) => a.from.localeCompare(b.from))
        .pop();
      return row(
        [
          tchip(t.id),
          t.note ? '<span class="wrapcell">' + esc(t.note) + '</span>' : dash,
          '<b>' +
            fmt(refPrice(t)) +
            '</b><br><small class="muted">' +
            (last ? 'ตั้งแต่ ' + date(last.from) : 'ยังไม่ตั้งราคา') +
            '</small>',
          t.active ? '<span class="badge ok">เปิดรับฝาก</span>' : '<span class="badge pending">ปิดรับฝาก</span>',
          App.ifAdmin('<button class="minibtn" data-act="editType" data-arg="' + esc(t.id) + '">แก้ไข</button>'),
        ],
        TH_TYPES,
      );
    }),
  );
}
async function editType(id) {
  if (!isAdmin()) return;
  const t = db.types.find(x => x.id === id) || null,
    was = t ? refPrice(t) : 0;
  const ok = await App.form({
    title: t ? 'แก้ไขประเภทขยะ' : 'เพิ่มประเภทขยะ',
    sub: t ? t.name : 'ประเภทที่เปิดรับฝาก พร้อมราคาอ้างอิงตั้งต้น',
    body:
      '<div class="formgrid two">' +
      field('ชื่อประเภท *', inp('tname', 'text', t ? t.name : '', 'required maxlength="80"')) +
      // 0 is a real reference price: waste a school gives away rather than sells is worth nothing per kilo and
      // should read as nothing everywhere. It is never prefilled on a new type, so a 0 is always something somebody typed.
      field(
        'ราคาอ้างอิง (บาท/กก.) *',
        inp(
          'tprice',
          'number',
          t ? String(was) : '',
          'required min="0" step="0.01" placeholder="เช่น 3.50 หรือ 0 ถ้าบริจาค"',
        ),
      ) +
      colorField(
        'สีประจำประเภท',
        'tcolor',
        t ? t.color : COLORS[db.types.length % COLORS.length],
        'ใช้เป็นจุดสีหน้าชื่อประเภททุกหน้า',
      ) +
      field('คำอธิบาย / เกณฑ์รับฝาก', inp('tnote', 'text', t ? t.note : '', 'maxlength="200"')) +
      '</div>' +
      (t ? '' : '<p class="note">ราคาที่กรอกจะมีผลตั้งแต่วันนี้ ปรับได้ทีหลังและระบบเก็บประวัติราคาไว้ให้</p>'),
    confirm: t ? 'ตรวจทานการแก้ไข' : 'เพิ่มประเภท',
    foot: t
      ? '<button type="button" class="minibtn danger" data-act="toggleType" data-arg="' +
        esc(t.id) +
        '">' +
        (t.active ? 'ปิดรับฝากประเภทนี้' : 'เปิดรับฝากคืน') +
        '</button>'
      : '',
  });
  if (!ok) return;
  const name = $('tname').value.trim(),
    note = $('tnote').value.trim(),
    color = $('tcolor').value,
    p = +$('tprice').value;
  if (!name || db.types.some(x => x.name === name && x.id !== (t && t.id))) return App.notify('ชื่อประเภทว่างหรือซ้ำ');
  if (!Number.isFinite(p) || p < 0) return App.notify('ราคาอ้างอิงต้องตั้งแต่ 0');
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return App.notify('เลือกสีประจำประเภทให้ถูกต้อง');
  const price = round(p);
  if (!t)
    return commit(
      async () => {
        await Api.addType({ name, note, color, price, from: today });
        await Api.audit('เพิ่มประเภท ' + name);
      },
      ['types'],
      'เพิ่มประเภทแล้ว',
    );
  const priceChanged = price !== was || !t.prices.length;
  if (!priceChanged && name === t.name && note === t.note && color.toLowerCase() === String(t.color).toLowerCase())
    return App.notify('ยังไม่มีอะไรเปลี่ยนในประเภท ' + t.name);
  if (
    !(await editOk(
      'ยืนยันการแก้ไขประเภทขยะ',
      t.name,
      [
        ['ชื่อประเภท', esc(t.name), esc(name)],
        ['ราคาอ้างอิง', fmt(was) + ' บาท/กก.', fmt(price) + ' บาท/กก.'],
        ['คำอธิบาย', esc(t.note) || '—', esc(note) || '—'],
        // Both are hex, by the column's CHECK constraint and by the test above, and both are escaped anyway:
        // every value that reaches markup is escaped where it is written, with no exceptions to remember.
        ['สีประจำประเภท', esc(t.color), esc(color)],
      ],
      // No figure on the last line on purpose: the estimated value of the stock on hand is a number nobody is
      // deciding anything by here (the stock screen and the report carry it), and a signed baht figure in the
      // middle of a sentence about prices reads as the price itself.
      priceChanged
        ? impact(
            'ราคามีผลกับอะไร',
            'ใบขายใบใหม่จะใช้ ' +
              fmt(price) +
              ' บาท/กก. ตั้งแต่วันนี้ · ใบขายที่บันทึกไปแล้วยังใช้ราคาเดิม ไม่คำนวณใหม่ · มูลค่าคงคลังประมาณการของประเภทนี้เปลี่ยนตามราคาใหม่',
          )
        : '',
    ))
  )
    return;
  await commit(
    async () => {
      await Api.saveType({ id: t.id, name, note, color, active: t.active, price, from: today, priceChanged });
      await Api.audit('แก้ไขประเภท ' + name + ' ราคาอ้างอิง ' + price);
    },
    ['types'],
    'บันทึกแล้ว',
  );
}
async function toggleType(id) {
  App.formHide();
  const t = db.types.find(x => x.id === id);
  if (!t || !isAdmin()) return;
  if (
    t.active &&
    !(await offOk(
      'ประเภทขยะ',
      t.name,
      'จะไม่ขึ้นในฟอร์มรับฝากและฟอร์มขายใบใหม่ · คงคลังที่เหลือ ' + fmt(stock(t.id)) + ' กก. จะค้างอยู่จนเปิดคืน',
    ))
  )
    return;
  await commit(
    async () => {
      await Api.setTypeActive(id, !t.active);
      await Api.audit((t.active ? 'ปิดรับฝากประเภท ' : 'เปิดรับฝากประเภท ') + t.name);
    },
    ['types'],
    t.active ? 'ปิดรับฝากแล้ว' : 'เปิดรับฝากแล้ว',
  );
}

// ---- แหล่งที่มาของขยะ --------------------------------------------------------------------------
const TH_SOURCES = ['แหล่งที่มา', 'สถานะ', ''];
function sourceList() {
  return ctable(
    TH_SOURCES,
    db.sources.map(s =>
      row(
        [
          schip(s.id),
          statusBadge(s.active),
          App.ifAdmin('<button class="minibtn" data-act="editSource" data-arg="' + esc(s.id) + '">แก้ไข</button>'),
        ],
        TH_SOURCES,
      ),
    ),
  );
}
async function editSource(id) {
  if (!isAdmin()) return;
  const s = db.sources.find(x => x.id === id) || null;
  const ok = await App.form({
    title: s ? 'แก้ไขแหล่งที่มาของขยะ' : 'เพิ่มแหล่งที่มาของขยะ',
    sub: s ? s.name : 'ที่ที่ขยะมาจาก เลือกตอนบันทึกรับฝาก',
    body:
      '<div class="formgrid two">' +
      field(
        'ชื่อแหล่งที่มา *',
        inp('srcname', 'text', s ? s.name : '', 'required maxlength="100" placeholder="เช่น อาคาร 3, ห้องสมุด"'),
      ) +
      colorField('สีประจำแหล่งที่มา', 'srccolor', s ? s.color : SRCCOLORS[db.sources.length % SRCCOLORS.length]) +
      '</div>',
    confirm: s ? 'ตรวจทานการแก้ไข' : 'เพิ่มแหล่งที่มา',
    foot: s
      ? '<button type="button" class="minibtn danger" data-act="toggleSource" data-arg="' +
        esc(s.id) +
        '">' +
        (s.active ? 'ปิดใช้แหล่งที่มานี้' : 'เปิดใช้คืน') +
        '</button>'
      : '',
  });
  if (!ok) return;
  const name = $('srcname').value.trim(),
    color = $('srccolor').value;
  if (!name || db.sources.some(x => x.name === name && x.id !== (s && s.id)))
    return App.notify('ชื่อแหล่งที่มาว่างหรือซ้ำ');
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return App.notify('เลือกสีประจำแหล่งที่มาให้ถูกต้อง');
  if (!s)
    return commit(
      async () => {
        await Api.addSource({ name, color });
        await Api.audit('เพิ่มแหล่งที่มา ' + name);
      },
      ['sources'],
      'เพิ่มแหล่งที่มาแล้ว',
    );
  if (name === s.name && color.toLowerCase() === String(s.color).toLowerCase())
    return App.notify('ยังไม่มีอะไรเปลี่ยนในแหล่งที่มา ' + s.name);
  if (
    !(await editOk(
      'ยืนยันการแก้ไขแหล่งที่มา',
      s.name,
      [
        ['ชื่อแหล่งที่มา', esc(s.name), esc(name)],
        ['สี', esc(s.color), esc(color)],
      ],
      impact('ใบเดิมอ้างถึงแถวนี้', 'ใบรับฝากที่บันทึกไปแล้วชี้มาที่แหล่งที่มานี้ และจะแสดงชื่อใหม่ตามที่แก้'),
    ))
  )
    return;
  await commit(
    async () => {
      await Api.saveSource({ id: s.id, name, color });
      await Api.audit('แก้ไขแหล่งที่มา ' + s.name + ' เป็น ' + name);
    },
    ['sources'],
    'บันทึกแล้ว',
  );
}
async function toggleSource(id) {
  App.formHide();
  const s = db.sources.find(x => x.id === id);
  if (!s || !isAdmin()) return;
  if (s.active && !(await offOk('แหล่งที่มา', s.name, 'จะไม่ขึ้นให้เลือกในฟอร์มรับฝากใบใหม่'))) return;
  await commit(
    async () => {
      await Api.setSourceActive(id, !s.active);
      await Api.audit('เปลี่ยนสถานะแหล่งที่มา ' + s.name);
    },
    ['sources'],
    s.active ? 'ปิดใช้แล้ว' : 'เปิดใช้แล้ว',
  );
}

// ---- ผู้รับซื้อ --------------------------------------------------------------------------------
const TH_BUYERS = ['ร้าน / ผู้ติดต่อ', 'เบอร์โทร', 'ที่อยู่ / หมายเหตุ', 'สถานะ', ''];
function buyerList() {
  return ctable(
    TH_BUYERS,
    db.buyers.map(x =>
      row(
        [
          '<b>' + esc(x.name) + '</b>' + (x.contact ? '<br><small>' + esc(x.contact) + '</small>' : ''),
          x.phone ? '<a href="tel:' + esc(x.phone.replace(/[^\d+]/g, '')) + '">' + esc(x.phone) + '</a>' : dash,
          '<span class="wrapcell">' +
            (x.address ? esc(x.address) : dash) +
            (x.note ? '<br><small>' + esc(x.note) + '</small>' : '') +
            '</span>',
          statusBadge(x.active),
          App.ifAdmin('<button class="minibtn" data-act="editBuyer" data-arg="' + esc(x.id) + '">แก้ไข</button>'),
        ],
        TH_BUYERS,
      ),
    ),
  );
}
async function editBuyer(id) {
  if (!isAdmin()) return;
  const x = db.buyers.find(b => b.id === id) || null,
    v0 = x || { name: '', contact: '', phone: '', address: '', note: '' };
  const ok = await App.form({
    title: x ? 'แก้ไขผู้รับซื้อ' : 'เพิ่มผู้รับซื้อ',
    sub: x ? x.name : 'ร้านที่รับซื้อขยะ เลือกตอนขาย และพิมพ์ที่อยู่กับเบอร์โทรในใบขาย',
    body:
      '<div class="formgrid two">' +
      field('ชื่อร้าน *', inp('bname', 'text', v0.name, 'required maxlength="120"')) +
      field('ผู้ติดต่อ', inp('bcontact', 'text', v0.contact, 'maxlength="100"')) +
      field(
        'เบอร์โทร',
        inp('bphone', 'tel', v0.phone, 'maxlength="30" inputmode="tel" placeholder="เช่น 08x-xxx-xxxx"'),
      ) +
      field(
        'หมายเหตุ',
        inp('bnote', 'text', v0.note, 'maxlength="200" placeholder="เช่น รับเฉพาะกระดาษและโลหะ, โทรนัดก่อน 1 วัน"'),
      ) +
      '<div class="wide"><label for="baddr">ที่อยู่</label><textarea id="baddr" rows="2" maxlength="300">' +
      esc(v0.address) +
      '</textarea></div></div>',
    confirm: x ? 'ตรวจทานการแก้ไข' : 'เพิ่มผู้รับซื้อ',
    foot: x
      ? '<button type="button" class="minibtn danger" data-act="toggleBuyer" data-arg="' +
        esc(x.id) +
        '">' +
        (x.active ? 'ปิดใช้ร้านนี้' : 'เปิดใช้คืน') +
        '</button>'
      : '',
  });
  if (!ok) return;
  const v = {
    name: $('bname').value.trim(),
    contact: $('bcontact').value.trim(),
    phone: $('bphone').value.trim(),
    address: $('baddr').value.trim(),
    note: $('bnote').value.trim(),
  };
  if (!v.name || db.buyers.some(b => b.name === v.name && b.id !== (x && x.id)))
    return App.notify('ชื่อร้านว่างหรือซ้ำกับที่มีอยู่');
  if (!/^[\d\s+\-()]*$/.test(v.phone)) return App.notify('เบอร์โทรใช้ได้เฉพาะตัวเลข เว้นวรรค + - ( )');
  if (!x)
    return commit(
      async () => {
        await Api.addBuyer(v);
        await Api.audit('เพิ่มผู้รับซื้อ ' + v.name);
      },
      ['buyers'],
      'เพิ่มผู้รับซื้อแล้ว',
    );
  if (
    !(await editOk('ยืนยันการแก้ไขผู้รับซื้อ', x.name, [
      ['ชื่อร้าน', esc(x.name), esc(v.name)],
      ['ผู้ติดต่อ', esc(x.contact) || '—', esc(v.contact) || '—'],
      ['เบอร์โทร', esc(x.phone) || '—', esc(v.phone) || '—'],
      ['ที่อยู่', esc(x.address) || '—', esc(v.address) || '—'],
      ['หมายเหตุ', esc(x.note) || '—', esc(v.note) || '—'],
    ]))
  )
    return;
  await commit(
    async () => {
      await Api.updateBuyer(x.id, v);
      await Api.audit('แก้ไขผู้รับซื้อ ' + v.name);
    },
    ['buyers'],
    'บันทึกการแก้ไขแล้ว',
  );
}
async function toggleBuyer(id) {
  App.formHide();
  const x = db.buyers.find(b => b.id === id);
  if (!x || !isAdmin()) return;
  if (x.active && !(await offOk('ผู้รับซื้อ', x.name, 'จะไม่ขึ้นให้เลือกในฟอร์มขายใบใหม่'))) return;
  await commit(
    async () => {
      await Api.setBuyerActive(id, !x.active);
      await Api.audit('เปลี่ยนสถานะผู้รับซื้อ ' + x.name);
    },
    ['buyers'],
    x.active ? 'ปิดใช้แล้ว' : 'เปิดใช้แล้ว',
  );
}

// ---- ผู้รับฝาก และ ผู้รับเงิน -------------------------------------------------------------------
// Two lists of names with the same two columns and the same rules, so they are one piece of code: `kind` is the
// table, and the words the school reads are derived from it, which is what keeps the two from drifting apart.
const TH_PEOPLE = ['ชื่อ', 'ตำแหน่ง', 'สถานะ', ''];
const EDITBTN = {
  depositor: '<button class="minibtn" data-act="editDepositor" data-arg="',
  receiver: '<button class="minibtn" data-act="editReceiver" data-arg="',
};
// A person is switched off, not deleted - the same rule as the waste types, the sources and the buyers. A name
// that was ever written on a slip stays in the list, because that list is also what explains an old slip.
const OFFBTN = {
  depositor: '<button type="button" class="danger" data-act="toggleDepositor" data-arg="',
  receiver: '<button type="button" class="danger" data-act="toggleReceiver" data-arg="',
};
const peopleOf = kind => (kind === 'depositor' ? db.depositors : db.receivers);
const whoOf = kind => (kind === 'depositor' ? 'ผู้รับฝาก' : 'ผู้รับเงิน');
function peopleList(kind) {
  return ctable(
    TH_PEOPLE,
    peopleOf(kind).map(x =>
      row(
        [
          '<b>' + esc(x.name) + '</b>',
          x.role ? esc(x.role) : dash,
          statusBadge(x.active),
          App.ifAdmin(EDITBTN[kind] + esc(x.id) + '">แก้ไข</button>'),
        ],
        TH_PEOPLE,
      ),
    ),
  );
}
async function editPerson(kind, id) {
  if (!isAdmin()) return;
  const who = whoOf(kind),
    rows = peopleOf(kind),
    dep = kind === 'depositor',
    ids = dep ? ['dpname', 'dprole'] : ['rname', 'rrole'],
    x = rows.find(r => r.id === id) || null;
  const ok = await App.form({
    title: (x ? 'แก้ไข' : 'เพิ่ม') + who,
    sub: x ? x.name : dep ? 'ครูที่รับฝากขยะ เลือกทุกครั้งที่บันทึกรับฝาก' : 'ครูที่รับเงิน เลือกได้ตอนขาย',
    body:
      '<div class="formgrid two">' +
      field(
        'ชื่อ' + who + ' *',
        inp(ids[0], 'text', x ? x.name : '', 'required maxlength="100" placeholder="เช่น ครูสมชาย ใจดี"'),
      ) +
      field(
        'ตำแหน่ง (ถ้ามี)',
        inp(ids[1], 'text', x ? x.role : '', 'maxlength="100" placeholder="เช่น ครูเวรธนาคารขยะ"'),
      ) +
      '</div>',
    confirm: x ? 'ตรวจทานการแก้ไข' : 'เพิ่ม' + who,
    foot: x ? OFFBTN[kind] + esc(x.id) + '">' + (x.active ? 'ปิดใช้ชื่อนี้' : 'เปิดใช้คืน') + '</button>' : '',
  });
  if (!ok) return;
  const name = $(ids[0]).value.trim(),
    role = $(ids[1]).value.trim();
  if (!name || rows.some(r => r.name === name && r.id !== (x && x.id))) return App.notify('ชื่อ' + who + 'ว่างหรือซ้ำ');
  const slice = dep ? 'depositors' : 'receivers';
  if (!x)
    return commit(
      async () => {
        await Api.addPerson(kind, { name, role });
        await Api.audit('เพิ่ม' + who + ' ' + name);
      },
      [slice],
      'เพิ่ม' + who + 'แล้ว',
    );
  if (name === x.name && role === x.role) return App.notify('ยังไม่มีอะไรเปลี่ยนใน' + who + ' ' + x.name);
  if (
    !(await editOk(
      'ยืนยันการแก้ไข' + who,
      x.name,
      [
        ['ชื่อ', esc(x.name), esc(name)],
        ['ตำแหน่ง', esc(x.role) || '—', esc(role) || '—'],
      ],
      impact(
        'ใบเดิมไม่เปลี่ยน',
        (dep ? 'ใบรับฝาก' : 'ใบขาย') + 'ที่บันทึกไปแล้วเก็บชื่อไว้เป็นข้อความ จะยังแสดงชื่อเดิม',
      ),
    ))
  )
    return;
  await commit(
    async () => {
      await Api.savePerson(kind, x.id, { name, role });
      await Api.audit('แก้ไข' + who + ' ' + x.name + ' เป็น ' + name);
      if (dep && S.lastDepositor === x.name) {
        S.lastDepositor = name;
      }
      if (!dep && S.lastReceiver === x.name) {
        S.lastReceiver = name;
      }
    },
    [slice],
    'บันทึกแล้ว',
  );
}
async function togglePerson(kind, id) {
  App.formHide();
  const who = whoOf(kind),
    dep = kind === 'depositor',
    x = peopleOf(kind).find(r => r.id === id);
  if (!x || !isAdmin()) return;
  if (x.active && !(await offOk(who, x.name, 'จะไม่ขึ้นให้เลือกใน' + (dep ? 'ฟอร์มรับฝาก' : 'ฟอร์มขาย') + 'ใบใหม่')))
    return;
  await commit(
    async () => {
      await Api.setPersonActive(kind, id, !x.active);
      await Api.audit('เปลี่ยนสถานะ' + who + ' ' + x.name);
      // The remembered pick is a convenience, and a name that is off duty must not be the one a form opens on.
      if (x.active && dep && S.lastDepositor === x.name) {
        S.lastDepositor = '';
      }
      if (x.active && !dep && S.lastReceiver === x.name) {
        S.lastReceiver = '';
      }
    },
    [dep ? 'depositors' : 'receivers'],
    x.active ? 'ปิดใช้แล้ว' : 'เปิดใช้แล้ว',
  );
}
const editDepositor = id => editPerson('depositor', id);
const editReceiver = id => editPerson('receiver', id);
const toggleDepositor = id => togglePerson('depositor', id);
const toggleReceiver = id => togglePerson('receiver', id);

// ---- the logo ----------------------------------------------------------------------------------
function fileToLogo(f, mw, mh) {
  return new Promise((res, rej) => {
    let u = URL.createObjectURL(f),
      im = new Image();
    im.onload = () => {
      try {
        let W = im.naturalWidth || 600,
          H = im.naturalHeight || 200,
          k = Math.min(1, 2400 / W, 2400 / H),
          c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(W * k));
        c.height = Math.max(1, Math.round(H * k));
        let x = c.getContext('2d');
        x.drawImage(im, 0, 0, c.width, c.height);
        let d = x.getImageData(0, 0, c.width, c.height).data,
          t = c.height,
          b = -1,
          l = c.width,
          r = -1;
        for (let y = 0; y < c.height; y++)
          for (let X = 0; X < c.width; X++) {
            let p = (y * c.width + X) * 4;
            if (d[p + 3] > 16 && !(d[p] > 245 && d[p + 1] > 245 && d[p + 2] > 245)) {
              if (y < t) t = y;
              if (y > b) b = y;
              if (X < l) l = X;
              if (X > r) r = X;
            }
          }
        if (r < 0) {
          l = 0;
          t = 0;
          r = c.width - 1;
          b = c.height - 1;
        }
        let pad = Math.round(Math.max(r - l, b - t) * 0.02),
          L = Math.max(0, l - pad),
          T = Math.max(0, t - pad),
          w = Math.min(c.width, r + pad + 1) - L,
          h = Math.min(c.height, b + pad + 1) - T,
          k2 = Math.min(1, mw / w, mh / h),
          o = document.createElement('canvas');
        o.width = Math.max(1, Math.round(w * k2));
        o.height = Math.max(1, Math.round(h * k2));
        o.getContext('2d').drawImage(c, L, T, w, h, 0, 0, o.width, o.height);
        res(o.toDataURL('image/png'));
      } catch (e) {
        rej(e);
      } finally {
        URL.revokeObjectURL(u);
      }
    };
    im.onerror = () => {
      URL.revokeObjectURL(u);
      rej(Error('img'));
    };
    im.src = u;
  });
}
async function setLogo(inp) {
  let f = inp.files && inp.files[0];
  inp.value = '';
  if (!f) return;
  if (!/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(f.type))
    return App.notify('เลือกไฟล์รูปภาพ PNG, JPG, WebP หรือ SVG');
  if (f.size > 20e6) return App.notify('ไฟล์รูปใหญ่เกิน 20 MB');
  let url;
  try {
    url = await fileToLogo(f, 256, 256);
  } catch {
    return App.notify('อ่านไฟล์รูปไม่ได้ ลองไฟล์อื่น');
  }
  await commit(
    async () => {
      await Api.setLogo(url);
      await Api.audit('เปลี่ยนโลโก้โรงเรียน');
    },
    ['settings'],
    'เปลี่ยนโลโก้แล้ว',
  );
}
function resetLogo() {
  return commit(
    async () => {
      await Api.resetLogo();
      await Api.audit('ใช้โลโก้โรงเรียนเริ่มต้น');
    },
    ['settings'],
    'กลับไปใช้โลโก้เดิมแล้ว',
  );
}

// ---- the screen --------------------------------------------------------------------------------
// Everything still missing, at the top of the screen. It is permanent, unlike the dialog after a sign-in:
// this is the screen where the gaps get closed, so the list belongs beside the panels that close them.
function setupBanner() {
  const g = setupGaps(db);
  if (!g.length) return '';
  return (
    '<section class="panel needpanel"><h2>ยังตั้งค่าไม่ครบ</h2><p class="muted">' +
    App.ifAdmin(
      'เมนูอื่นจะเปิดใช้งานเมื่อกำหนดรายการต่อไปนี้ครบแล้ว',
      'เมนูอื่นจะเปิดใช้งานเมื่อผู้ดูแลระบบกำหนดรายการต่อไปนี้ครบแล้ว',
    ) +
    '</p><ul class="gaplist">' +
    g.map(x => '<li>' + esc(x.label) + '<small class="muted">' + esc(x.panel) + '</small></li>').join('') +
    '</ul></section>'
  );
}
// The sections, in the order they are drawn and listed. `title` is also what lib/setup.js points a user at, so the
// two must stay in step (tests/js/setup_gate.test.js asserts every panel setup.js names is a panel that renders).
// `nav` is the one line the jump list shows under the name, `pills` the counts in the heading - of rows configured,
// never of documents recorded - `body` the panel's contents, and the ＋ button comes from ADD by the same id.
const SECTIONS = [
  { id: 'general', title: 'ข้อมูลทั่วไป', nav: () => esc(db.school) || 'ยังไม่ได้ตั้งชื่อ', body: generalBody },
  {
    id: 'types',
    title: 'ประเภทขยะและราคาอ้างอิง',
    nav: () => db.types.length + ' ประเภท',
    pills: () =>
      pills([
        ['ทั้งหมด', db.types.length + ' ประเภท'],
        ['เปิดรับฝาก', db.types.filter(t => t.active).length],
      ]),
    body: () =>
      typeList() +
      '<p class="note">ราคาอ้างอิงใช้ประเมินมูลค่าคงคลังและเป็นราคาตั้งต้นตอนขาย เปลี่ยนแล้วมีผลกับใบขายใบใหม่เท่านั้น ใบที่บันทึกไปแล้วเก็บราคาที่ใช้ตอนนั้นไว้ · ดูประวัติราคาย้อนหลังได้ที่หน้ารายงาน</p>',
  },
  {
    id: 'sources',
    title: 'แหล่งที่มาของขยะ',
    nav: () => db.sources.length + ' แห่ง',
    pills: () =>
      pills([
        ['ทั้งหมด', db.sources.length + ' แห่ง'],
        ['เปิดใช้', db.sources.filter(s => s.active).length],
      ]),
    body: () => sourceList() + '<p class="note">ดูว่ารับฝากจากแหล่งใดไปเท่าไรได้ที่ทะเบียนใบรับฝากและหน้ารายงาน</p>',
  },
  {
    id: 'buyers',
    title: 'ผู้รับซื้อ',
    nav: () => db.buyers.length + ' ร้าน',
    pills: () =>
      pills([
        ['ทั้งหมด', db.buyers.length + ' ร้าน'],
        ['เปิดใช้', db.buyers.filter(b => b.active).length],
      ]),
    body: () => buyerList() + '<p class="note">ดูว่าขายให้ร้านใดไปกี่ใบได้ที่ทะเบียนใบขาย</p>',
  },
  {
    id: 'depositors',
    title: 'ผู้รับฝาก',
    nav: () => db.depositors.length + ' คน',
    pills: () =>
      pills([
        ['ทั้งหมด', db.depositors.length + ' คน'],
        ['เปิดใช้', db.depositors.filter(x => x.active).length],
      ]),
    body: () =>
      peopleList('depositor') +
      '<p class="note">ผู้รับฝากขยะฝั่งธนาคารขยะ ต้องเลือกทุกครั้งที่บันทึกรับฝาก · ดูรายการของแต่ละคนได้ที่ทะเบียนใบรับฝาก</p>',
  },
  {
    id: 'receivers',
    title: 'ผู้รับเงิน',
    nav: () => db.receivers.length + ' คน',
    pills: () =>
      pills([
        ['ทั้งหมด', db.receivers.length + ' คน'],
        ['เปิดใช้', db.receivers.filter(x => x.active).length],
      ]),
    body: () =>
      peopleList('receiver') +
      '<p class="note">ผู้รับเงินฝั่งธนาคารขยะ เลือกได้ตอนขาย และพิมพ์ชื่อในใบขาย · ดูใบขายของแต่ละคนได้ที่ทะเบียนใบขาย</p>',
  },
  {
    id: 'audit',
    title: 'ประวัติการดำเนินการ',
    nav: () => db.audit.length + ' รายการ',
    pills: () => pills([['ล่าสุด', db.audit.length + ' รายการ']]),
    body: () =>
      ptable(
        'audit',
        ['วัน / เวลา', 'การดำเนินการ'],
        db.audit.map(r => ({
          k: { 0: r.at },
          c: [esc(new Date(r.at).toLocaleString(TH)), '<span class="wrapcell">' + esc(r.action) + '</span>'],
        })),
      ),
  },
];
function panelOf(s, k) {
  const need = panelGaps(db, s.title);
  return (
    '<section class="panel set' +
    (need.length ? ' needs' : '') +
    '" id="' +
    s.id +
    '" data-sec="' +
    k +
    '"><div class="panelhead"><div class="phtitle"><h2>' +
    s.title +
    '</h2>' +
    (s.pills ? '<div class="phsum">' + s.pills() + '</div>' : '') +
    '</div>' +
    (ADD[s.id] ? App.ifAdmin(ADD[s.id]) : '') +
    '</div>' +
    (need.length ? '<p class="needbox">ยังไม่ได้กำหนด: ' + need.map(x => esc(x.label)).join(' • ') + '</p>' : '') +
    s.body() +
    '</section>'
  );
}
// The screen is a list of sections down the left and the sections themselves on the right, in order. Every section
// stays on the page: a setting nobody can find is a setting nobody changes, and this screen is also the one a
// school prints when it wants its own configuration on paper. The list is a jump list - it marks where you are and
// scrolls there - not a set of tabs that hide six sections to show one.
function setnav() {
  return (
    '<nav class="setnav" aria-label="หมวดตั้งค่า">' +
    SECTIONS.map((s, k) => {
      const need = panelGaps(db, s.title),
        on = S.accOpen === k;
      return (
        '<button type="button" class="' +
        (on ? 'on' : '') +
        (need.length ? ' needs' : '') +
        '"' +
        (on ? ' aria-current="true"' : '') +
        ' onclick="App.accToggle(' +
        k +
        ')"><span>' +
        s.title +
        '</span><small>' +
        (need.length ? 'ยังไม่ได้กำหนด' : s.nav()) +
        '</small></button>'
      );
    }).join('') +
    '</nav>'
  );
}
// The list marks a section and scrolls to it; nothing is opened or closed, so there is no state to get wrong.
// `jump` is set only by a click on the list, so opening the screen (or redrawing it after a save) leaves the page
// where it is, while clicking ข้อมูลทั่วไป - the first section, which a `> 0` test used to skip - scrolls there too.
let jump = null;
function accToggle(k) {
  S.accOpen = k;
  jump = SECTIONS[k] ? SECTIONS[k].id : null;
  App.render();
}
const render = () =>
  heading('ตั้งค่า', 'ข้อมูลหน่วยงาน ประเภทขยะ ราคาอ้างอิง แหล่งที่มา ผู้รับซื้อ และผู้รับเงิน') +
  setupBanner() +
  '<div class="setcols">' +
  setnav() +
  '<div class="setmain">' +
  SECTIONS.map(panelOf).join('') +
  '</div></div>';
const handlers = {
  accToggle,
  editBuyer,
  editDepositor,
  editGeneral,
  editReceiver,
  editSource,
  editType,
  resetLogo,
  setLogo,
  toggleBuyer,
  toggleDepositor,
  toggleReceiver,
  toggleSource,
  toggleType,
};
export { render, handlers };
App.registerPage('settings', {
  render,
  handlers,
  // Coming back to the screen after a save leaves the user where they were working, which is the section the
  // list has marked. The first section is the top of the page, so that one needs no scrolling.
  after() {
    if (!jump) return;
    const id = jump;
    jump = null;
    document.querySelector('.setnav button.on')?.scrollIntoView?.({ block: 'nearest' });
    document.getElementById(id)?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  },
});
