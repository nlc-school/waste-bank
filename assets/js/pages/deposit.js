'use strict';
// The deposit screen: the entry form, the register of slips, a slip's detail and voiding.
// Writes go through Api (create_deposit, void_deposit_item) and nothing here edits db: the screen redraws from what the
// server holds single the call has succeeded. A failed call renders nothing, so the typed slip is still in the form.
import { esc, fmt, sum, be, dnum, date, nowTime, round } from '../lib/fmt.js';
import { table, row, ptable, perBar, inPer, per, registerList } from '../lib/table.js';
import {
  db,
  S,
  $,
  today,
  tchip,
  schip,
  field,
  inp,
  options,
  heading,
  cardhead,
  lhead,
  lname,
  loff,
  movedThisMonth,
  lastSale,
  detail,
  printLogo,
  printHead,
  printFoot,
  rail,
  railsum,
  savebar,
  kv,
  impact,
  sold,
  stock,
  refPrice,
  type,
  source,
} from '../ui.js';
import { App, printRegister } from '../app.js';
import { csv } from '../lib/csv.js';
import * as Api from '../api.js';
let saving = false;
// Only a person who is switched on is offered: a name taken off duty stays on every slip it was written on, and
// ตั้งค่า is where it is switched back. Same rule as the waste types and the sources.
const depositors = () => db.depositors.filter(x => x.active);
function depositTable(gs) {
  return ptable(
    'deposit',
    ['เลขที่ / วันที่', 'แหล่งที่มา', 'ประเภท น้ำหนัก (กก.)', 'น้ำหนักรวม (กก.)', 'ผู้รับฝาก', 'สถานะ', ''],
    gs.map(g => {
      let h = g[0],
        ok = g.filter(r => !r.void),
        st = depStatus(g);
      return {
        k: { 0: h.date + h.time + h.no, 6: null },
        f: {
          1: [source(h.source).name],
          2: g.map(r => type(r.type).name),
          // The depositor is a list to pick from, not a box to type in: the names come from ตั้งค่า, and this
          // register is where "what did this teacher take in?" is answered.
          4: [h.operator],
          5: st === 'ยกเลิกบางส่วน' ? ['รับฝากแล้ว', st] : [st],
        },
        c: [
          esc(h.no) + '<br><small>' + date(h.date) + ' ' + esc(h.time) + '</small>',
          schip(h.source),
          g
            .map(
              r =>
                '<span class="dline' +
                (r.void ? ' dvoid' : '') +
                '" title="' +
                (r.void ? 'ยกเลิกแล้ว' : '') +
                '">' +
                tchip(r.type) +
                '<small>' +
                fmt(r.weight) +
                '</small></span>',
            )
            .join('<br>'),
          fmt(sum(ok, 'weight')),
          esc(h.operator),
          '<span class="badge ' + (st === 'รับฝากแล้ว' ? 'ok' : 'pending') + '">' + st + '</span>',
          '<button class="minibtn" data-act="depSlip" data-arg="' + esc(h.no) + '">ดูใบรับฝาก</button>',
        ],
      };
    }),
    [1, 2, 4, 5],
  );
}
// The earliest live sale of this type that could have carried this item, or nothing. It is the same rule
// void_deposit_item() enforces (WB002), kept here only so the screen can say so before anything is sent: the
// sale's moment against the deposit's own, not just its day, because this morning's sale cannot have carried
// what came in this afternoon. Both times are 'HH:MM' and both dates 'YYYY-MM-DD', so concatenating them
// compares as the pair does in SQL. Still per type: stock is one pool and nothing records which kilo went.
function lockSale(r) {
  const at = x => x.date + x.time;
  return sold()
    .filter(s => at(s) >= at(r) && s.items.some(i => i.type === r.type))
    .sort((a, b) => (at(a) + a.no).localeCompare(at(b) + b.no))[0];
}
function depVoidBtn(r) {
  let s = lockSale(r);
  return s
    ? '<span class="badge lock" title="ขายแล้วในใบ ' +
        esc(s.no) +
        ' วันที่ ' +
        date(s.date) +
        '">ล็อก · ขายแล้ว</span><br><small class="muted">ใบ ' +
        esc(s.no) +
        '</small>'
    : App.ifAdmin('<button class="minibtn danger" data-act="voidDeposit" data-arg="' + esc(r.id) + '">ยกเลิก</button>');
}
function render() {
  // Every type that is open for deposits is a row, in the order ตั้งค่า gives them. A type switched off keeps
  // its place as one collapsed line while there is still stock behind it, or for the rest of the month the last
  // of it moved in: the list does not reshuffle when a type is switched off, and a row does not vanish from
  // under the person who just finished it. After that it is finished business and lives in ตั้งค่า › ประเภทขยะ
  // and on คงคลัง, not in a form that cannot take it in.
  let ts = db.types.filter(t => t.active || stock(t.id) > 0 || movedThisMonth(t.id));
  return (
    heading('รับฝากขยะ', 'เลือกแหล่งที่มา กรอกน้ำหนักเฉพาะประเภทที่มี แล้วตรวจทานครั้งเดียว', '') +
    App.ifAdmin(
      '<form onsubmit="App.saveDeposit(event)"><div class="wcols"><div class="wmain"><section class="panel">' +
        cardhead(1, 'ข้อมูลใบรับฝาก', 'เลขที่ใบออกให้อัตโนมัติ') +
        '<div class="formgrid deprow">' +
        field('วันที่และเวลา', inp('depdate', 'datetime-local', today + 'T' + nowTime(), 'required')) +
        field(
          'แหล่งที่มาของขยะ',
          '<select id="depsource" required><option value="">เลือกแหล่งที่มา</option>' +
            options(
              db.sources.filter(s => s.active),
              'id',
              'name',
              S.lastSource,
            ) +
            '</select>',
        ) +
        field(
          'ผู้รับฝาก',
          '<select id="depop" required><option value="">' +
            (depositors().length ? 'เลือกผู้รับฝาก' : '— ยังไม่มีรายชื่อ เพิ่มได้ที่ตั้งค่า —') +
            '</option>' +
            depositors()
              .map(
                x =>
                  '<option value="' +
                  esc(x.name) +
                  '"' +
                  (x.name === S.lastDepositor ? ' selected' : '') +
                  '>' +
                  esc(x.name) +
                  '</option>',
              )
              .join('') +
            '</select>',
        ) +
        field('หมายเหตุ', inp('depnote', 'text', '', 'maxlength="300" placeholder="เช่น ขยะสะอาดและแห้ง"')) +
        '</div></section><section class="panel">' +
        cardhead(2, 'รายการรับฝาก', 'กรอกน้ำหนักเฉพาะประเภทที่รับฝาก') +
        '<div class="lines">' +
        lhead('dep', ['ประเภท', 'เกณฑ์รับฝาก', 'รับฝากครั้งล่าสุด', 'รับฝาก (กก.)', 'คงคลังหลังรับฝาก (กก.)']) +
        ts.map(typeRow).join('') +
        '</div></section></div>' +
        rail(
          'deptotal',
          ['น้ำหนักรวมใบนี้', '0.00', 'กก.'],
          [],
          '<button class="primary" type="submit">ตรวจทานและบันทึก</button>' +
            '<button type="button" onclick="App.depClear()">ล้างฟอร์ม</button>',
          'ยังไม่เขียนข้อมูลจนกดยืนยันในหน้าตรวจทาน',
          cardhead(3, 'ตรวจทานรายการ'),
        ) +
        '</div>' +
        savebar(
          'depbar',
          'รวม 0 ประเภท',
          '0.00 กก.',
          '<button class="primary" type="submit">ตรวจทานและบันทึก</button>',
        ) +
        '</form>',
    ) +
    '<section class="panel" id="depreg"><div class="panelhead"><div class="phtitle"><h2>ทะเบียนใบรับฝาก</h2><div class="phsum" id="depsum">' +
    depSum() +
    '</div></div><div class="actions"><button onclick="App.printDeposits()">พิมพ์รายงาน</button><button onclick="App.exportDeposits()">ส่งออก CSV</button></div></div>' +
    printHead('ทะเบียนใบรับฝาก', date(per.deposit.from) + ' – ' + date(per.deposit.to)) +
    '<div class="toolbar"><div class="perbar" id="pb_deposit">' +
    perBar('deposit') +
    '</div></div><div id="deplist">' +
    depView() +
    '</div>' +
    printFoot() +
    '</section>'
  );
}
// One waste type, as one row: what it is, what it takes, when it last came in, the box for what is being taken
// in now, and what the store will hold once it is. The type's own colour is the row's left edge and goes solid
// once the row holds a weight, so how many types this slip covers can be counted down the edge.
//
// เกณฑ์รับฝาก is waste_type.note, which the 232px card could only hide behind the info icon. It is what a teacher
// needs at the moment of accepting a bag, so with a row's width it is read where it is used; the icon stays for
// a note too long for two lines. รับฝากครั้งล่าสุด is derived from db.deposits and is what catches บันทึกซ้ำ -
// one of the reasons the void dialog already offers - before the slip is written rather than in a report later.
function typeRow(t) {
  if (!t.active) return offRow(t);
  let l = lastDep(t),
    st = stock(t.id);
  return (
    '<div class="lrow dep" id="wc_' +
    t.id +
    '" style="--c:' +
    t.color +
    '">' +
    lname(t, 'คงคลัง <b>' + fmt(st) + '</b> กก.') +
    '<p class="lnote' +
    (t.note ? '' : ' none') +
    '">' +
    (t.note ? esc(t.note) : 'ยังไม่ได้ใส่เกณฑ์ — เพิ่มได้ที่ ตั้งค่า › ประเภทขยะ') +
    '</p><div class="llast' +
    (l ? '' : ' none') +
    '"><span class="mlab">รับฝากครั้งล่าสุด</span><span class="lv"><b>' +
    (l ? date(l.date) : 'ยังไม่เคยรับฝาก') +
    '</b>' +
    (l ? fmt(l.weight) + ' กก.' : '') +
    '</span></div><div><label class="mlab" for="w_' +
    t.id +
    '">รับฝาก (กก.)</label><input id="w_' +
    t.id +
    '" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0.00" aria-label="รับฝาก ' +
    esc(t.name) +
    ' กิโลกรัม" oninput="App.depTotal()"></div><div class="lafter dim" id="wa_' +
    t.id +
    '"><span class="mlab">คงคลังหลังรับฝาก (กก.)</span><b>' +
    fmt(st) +
    '</b></div></div>'
  );
}
// A type switched off in ตั้งค่า, as the same collapsed line รายการขาย shows, so a type reads the same on both
// screens: what state it is in, and where it is switched back on. The difference is only the reason - the sale
// screen says that stock cannot be sold, this one that nothing more can be taken in.
function offRow(t) {
  if (stock(t.id) > 0)
    return loff(
      t,
      'ปิดรับฝากอยู่',
      'มีของค้าง ' + fmt(stock(t.id)) + ' กก. · ขายออกได้ตามปกติ · เปิดรับฝากที่ ตั้งค่า › ประเภทขยะ ก่อนจึงรับฝากได้',
      true,
    );
  let last = lastSale(t.id);
  return loff(
    t,
    'หมดคลัง · ปิดรับฝาก',
    (last ? 'ขายหมดเมื่อ ' + date(last.date) : 'ไม่มีของเหลือในคลัง') +
      ' · เปิดรับฝากที่ ตั้งค่า › ประเภทขยะ ถ้าจะรับเข้าอีก',
    true,
  );
}
// The last live deposit of this type, whenever it was: the figure that says "this one was already taken in this
// morning" while there is still time to not write it twice.
function lastDep(t) {
  return db.deposits
    .filter(r => r.type === t.id && !r.void)
    .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time))[0];
}
// A tap on the info icon says what the type takes, in a bubble at the icon and in the toast (App.info). `title`
// is still there for a mouse hovering it; a tap has no hover, and an explanation nobody can open is an
// explanation nobody reads.
function typeNote(id, el) {
  const t = db.types.find(x => x.id === id);
  if (t && t.note) App.info(el, t.name + ': ' + t.note);
}
// Printing the register prints the register, by the shell's own flag: ทะเบียนใบขาย prints the same way, so the
// mechanism and its afterprint listener live in app.js rather than once in each of the two screens.
const printDeposits = printRegister;
// The running summary: the rail beside the form, and on a phone the same two numbers in the bar above the menu.
// It also owns whether the slip can be written at all - an empty form says what is missing under the button
// rather than letting the user press it and be told afterwards.
function typed() {
  return db.types
    .filter(t => t.active)
    .map(t => ({ t, v: +$('w_' + t.id).value }))
    .filter(x => x.v > 0);
}
function depTotal() {
  let w = 0,
    n = 0,
    money = 0;
  db.types
    .filter(t => t.active)
    .forEach(t => {
      let v = +$('w_' + t.id).value;
      if (v > 0) {
        w += v;
        n++;
        money += v * refPrice(t);
      }
      $('wc_' + t.id).className = 'lrow dep' + (v > 0 ? ' filled' : '');
      let a = $('wa_' + t.id);
      if (a) {
        a.className = 'lafter' + (v > 0 ? ' q' : ' dim');
        // The unit is in the column head (and, on a phone, in .mlab), so the cell is the figure alone.
        a.innerHTML =
          '<span class="mlab">คงคลังหลังรับฝาก (กก.)</span><b>' + fmt(stock(t.id) + (v > 0 ? v : 0)) + '</b>';
      }
    });
  $('deptotal').innerHTML = railsum(
    ['น้ำหนักรวมใบนี้', fmt(w), 'กก.'],
    [
      ['จำนวนประเภท', n + ' ประเภท'],
      ['มูลค่าประมาณ', fmt(money, 0) + ' บาท'],
    ],
  );
  let bar = $('depbar');
  if (bar) bar.innerHTML = '<small>รวม ' + n + ' ประเภท</small><b>' + fmt(w) + ' กก.</b>';
  let note = document.querySelector('#view .railnote');
  if (note) {
    note.textContent = n ? 'ยังไม่เขียนข้อมูลจนกดยืนยันในหน้าตรวจทาน' : 'กรอกน้ำหนักอย่างน้อย 1 ประเภทก่อนบันทึก';
    note.className = 'railnote' + (n ? '' : ' bad');
  }
}
function depClear() {
  db.types.forEach(t => {
    let w = $('w_' + t.id);
    if (w) w.value = '';
  });
  let n = $('depnote');
  if (n) n.value = '';
  if ($('deptotal')) depTotal();
}
// The in-flight guard goes up before the review sheet opens and comes down only once the write and the redraw
// are done: two quick clicks must not open two sheets, and what writes the slip must not run twice.
async function saveDeposit(e) {
  e.preventDefault();
  if (saving) return;
  saving = true;
  try {
    return await writeDeposit(e);
  } finally {
    saving = false;
  }
}
async function writeDeposit(e) {
  let op = $('depop').value,
    src = $('depsource').value,
    dt = $('depdate').value,
    d = dt.slice(0, 10),
    tm = dt.slice(11, 16),
    recs = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return App.notify('ระบุวันที่และเวลา');
  if (!src) return App.notify('เลือกแหล่งที่มาของขยะ');
  if (!op)
    return App.notify(
      depositors().length ? 'เลือกผู้รับฝาก' : 'ยังไม่มีรายชื่อผู้รับฝาก เพิ่มได้ที่ ตั้งค่า › ผู้รับฝาก',
    );
  for (let t of db.types.filter(t => t.active)) {
    let v = $('w_' + t.id).value;
    if (v === '') continue;
    let w = round(+v);
    if (!Number.isFinite(w) || w < 0 || w > 100000) return App.notify('น้ำหนัก ' + t.name + ' ไม่ถูกต้อง');
    if (w > 0) recs.push({ type: t.id, weight: w });
  }
  if (!recs.length) return App.notify('กรอกน้ำหนักอย่างน้อย 1 ประเภท');
  // Nothing is written until this sheet is confirmed: it says what the slip will hold and what the stock of each
  // type becomes, which is the part a weight typed into the wrong box does not show on its own.
  if (
    !(await App.review({
      title: 'ตรวจทานใบรับฝาก',
      sub: 'ยืนยันแล้วระบบจะออกเลขที่ใบและเพิ่มคงคลังทันที',
      body:
        kv([
          ['วันที่และเวลา', date(d) + ' เวลา ' + esc(tm || nowTime()) + ' น.'],
          ['แหล่งที่มา', esc(source(src).name)],
          ['ผู้รับฝาก', esc(op)],
          ...($('depnote').value.trim() ? [['หมายเหตุ', esc($('depnote').value.trim())]] : []),
          ...recs.map(r => [type(r.type).name, fmt(r.weight) + ' กก.']),
          ['total', 'น้ำหนักรวม ' + recs.length + ' ประเภท', fmt(sum(recs, 'weight')) + ' กก.'],
        ]) +
        impact(
          'หลังบันทึก',
          recs
            .map(r => type(r.type).name + ' ' + fmt(stock(r.type)) + ' → ' + fmt(stock(r.type) + r.weight) + ' กก.')
            .join(' · '),
          'ok',
        ),
      confirm: 'ยืนยันบันทึกใบรับฝาก',
    }))
  )
    return;
  let b = e.submitter;
  if (b) b.disabled = true;
  let no;
  // The guard covers the write AND the redraw: until the screen shows the server's state the typed weights are still in the form,
  // and a second submit in that window would book the same waste twice.
  try {
    try {
      no = await Api.createDeposit({
        date: d,
        time: tm || nowTime(),
        source: src,
        point: db.point,
        operator: op,
        note: $('depnote').value.trim(),
        items: recs,
      });
    } catch (x) {
      return App.fail(x);
    }
    S.lastSource = src;
    S.lastDepositor = op;
    if (!(await App.reload(['deposits']))) {
      db.types.forEach(t => {
        let w = $('w_' + t.id);
        if (w) w.value = '';
      });
      let n = $('depnote');
      if (n) n.value = '';
      if ($('deptotal')) depTotal();
      return;
    }
    App.notify('บันทึกใบรับฝาก ' + no + ' • ' + recs.length + ' ประเภท รวม ' + fmt(sum(recs, 'weight')) + ' กก. แล้ว');
  } finally {
    if (b) b.disabled = false;
  }
}
function depGroups(a) {
  let m = new Map();
  a.forEach(r => {
    let k = r.no || r.id;
    m.has(k) || m.set(k, []);
    m.get(k).push(r);
  });
  return [...m.values()];
}
function depStatus(g) {
  let v = g.filter(r => r.void).length;
  return v === 0 ? 'รับฝากแล้ว' : v === g.length ? 'ยกเลิก' : 'ยกเลิกบางส่วน';
}
// Newest slip first. There is no search over the whole register: every column carries its own filter (the row
// under the headings), which says which column it is searching instead of leaving that to be guessed.
function depView() {
  const gs = depGroups(db.deposits.filter(inPer('deposit'))).sort((x, y) =>
    (y[0].date + y[0].time + y[0].no).localeCompare(x[0].date + x[0].time + x[0].no),
  );
  return depositTable(gs);
}
function depSum() {
  let all = db.deposits.filter(inPer('deposit')),
    ok = all.filter(r => !r.void),
    v = all.length - ok.length;
  return (
    '<span class="phrange">' +
    date(per.deposit.from) +
    ' – ' +
    date(per.deposit.to) +
    '</span><span class="phnum"><b>' +
    depGroups(ok).length +
    '</b> ใบ</span><span class="phnum"><b>' +
    ok.length +
    '</b> รายการ' +
    (v ? ' <small>(ยกเลิก ' + v + ')</small>' : '') +
    '</span><span class="phnum">รวม <b>' +
    fmt(sum(ok, 'weight')) +
    '</b> กก.</span>'
  );
}
async function voidDeposit(id) {
  let r = db.deposits.find(r => r.id === id),
    ls = lockSale(r);
  if (ls)
    return App.notify(
      'ยกเลิกไม่ได้: ขยะชุดนี้ขายแล้วในใบ ' +
        ls.no +
        ' (' +
        date(ls.date) +
        ') ถ้าต้องการยกเลิก ให้ยกเลิกใบขายนั้นก่อน',
    );
  if (stock(r.type) < r.weight) return App.notify('ยกเลิกไม่ได้: น้ำหนักคงคลังไม่พอ เพราะขายไปแล้ว');
  let reason = await App.askReason('ยกเลิก ' + type(r.type).name + ' ' + fmt(r.weight) + ' กก. ในใบ ' + r.no, {
    impact: impact(
      'ยืนยันแล้วจะเกิดอะไร',
      'คงคลัง ' +
        type(r.type).name +
        ' ' +
        fmt(stock(r.type)) +
        ' → ' +
        fmt(stock(r.type) - r.weight) +
        ' กก. · รายงานช่วงที่มีใบนี้เปลี่ยนตาม · รายการเดิมยังอยู่ในทะเบียนและขึ้นสถานะยกเลิก',
      'bad',
    ),
    reasons: ['บันทึกน้ำหนักผิด', 'บันทึกซ้ำ', 'กรอกประเภทผิด'],
  });
  if (!reason) return;
  let no = r.no,
    name = type(r.type).name;
  try {
    await Api.voidDepositItem(r.id, reason);
  } catch (x) {
    return App.fail(x);
  }
  if (!(await App.reload(['deposits']))) return;
  if ($('detail').open) depSlip(no || r.id);
  App.notify('ยกเลิก ' + name + ' แล้ว');
}
function depSlip(no) {
  let g = db.deposits.filter(r => (r.no || r.id) === no);
  if (!g.length) return;
  let h = g[0],
    ok = g.filter(r => !r.void),
    can = ok.filter(r => !lockSale(r));
  detail(
    '<div class="sliphead">' +
      printLogo() +
      '<div><h2 style="margin:0">ใบรับฝากขยะ</h2><small>' +
      esc(db.school) +
      ' • ธนาคารขยะ</small></div><div class="right"><b>เลขที่ ' +
      esc(no) +
      '</b><br><small>วันที่ ' +
      date(h.date) +
      ' เวลา ' +
      esc(h.time) +
      ' น.</small></div></div><p>แหล่งที่มา <b>' +
      esc(source(h.source).name) +
      '</b> • ' +
      esc(h.point) +
      '<br><small>ผู้รับฝาก ' +
      esc(h.operator) +
      (h.note ? ' • หมายเหตุ ' + esc(h.note) : '') +
      '</small></p>' +
      table(
        ['ลำดับ', 'ประเภท', 'น้ำหนัก (กก.)', 'สถานะ', '<span class="noprint">จัดการ</span>'],
        g.map((r, i) =>
          row([
            i + 1,
            tchip(r.type),
            fmt(r.weight),
            r.void
              ? '<span class="badge pending">ยกเลิก</span>' +
                (r.voidReason ? '<br><small class="muted">' + esc(r.voidReason) + '</small>' : '')
              : '<span class="badge ok">รับฝากแล้ว</span>',
            '<span class="noprint">' + (r.void ? '' : depVoidBtn(r)) + '</span>',
          ]),
        ),
      ) +
      '<div class="totals"><div>น้ำหนักรวม<b>' +
      fmt(sum(ok, 'weight')) +
      ' กก.</b></div><div>จำนวนประเภท<b>' +
      ok.length +
      (g.length > ok.length ? ' <small>(ยกเลิก ' + (g.length - ok.length) + ')</small>' : '') +
      '</b></div></div>' +
      App.ifAdmin(
        g.length > 1 && can.length
          ? '<p class="noprint" style="margin-top:14px"><button class="minibtn danger" data-act="voidDepSlip" data-arg="' +
              esc(no) +
              '">ยกเลิกทั้งใบรับฝาก</button>' +
              (can.length < ok.length ? ' <small class="muted">ประเภทที่ขายแล้วจะไม่ถูกยกเลิก</small>' : '') +
              '</p>'
          : '',
      ),
  );
}
async function voidDepSlip(no) {
  let g = db.deposits.filter(r => (r.no || r.id) === no && !r.void),
    can = g.filter(r => !lockSale(r) && stock(r.type) >= r.weight),
    left = g.length - can.length;
  if (!can.length) return App.notify('ยกเลิกไม่ได้: ทุกประเภทในใบนี้ขายแล้ว');
  let reason = await App.askReason(
    'ยกเลิกทั้งใบรับฝาก ' +
      no +
      ' (' +
      can.length +
      ' ประเภท' +
      (left ? ' • อีก ' + left + ' ประเภทขายแล้วจะคงไว้' : '') +
      ')',
    {
      impact: impact(
        'ยืนยันแล้วจะเกิดอะไร',
        'คงคลังลดลงรวม ' +
          fmt(sum(can, 'weight')) +
          ' กก. ใน ' +
          can.length +
          ' ประเภท' +
          (left ? ' · อีก ' + left + ' ประเภทที่ขายแล้วจะคงไว้' : '') +
          ' · รายงานช่วงที่มีใบนี้เปลี่ยนตาม',
        'bad',
      ),
      reasons: ['บันทึกน้ำหนักผิด', 'บันทึกซ้ำ', 'ยกเลิกการรับฝาก'],
      word: no,
    },
  );
  if (!reason) return;
  let done = 0;
  try {
    for (let r of can) {
      await Api.voidDepositItem(r.id, reason);
      done++;
    }
  } catch (x) {
    if (done) {
      await App.reload(['deposits']);
      if ($('detail').open) depSlip(no);
    }
    return App.fail(x, done ? { prefix: 'ยกเลิก ' + done + ' ประเภทแล้ว • ' } : {});
  }
  if (!(await App.reload(['deposits']))) return;
  if ($('detail').open) depSlip(no);
  App.notify('ยกเลิก ' + can.length + ' ประเภทแล้ว' + (left ? ' • ' + left + ' ประเภทขายแล้วยกเลิกไม่ได้' : ''));
}
function exportDeposits() {
  csv(
    'deposits_' + be(per.deposit.from) + '_' + be(per.deposit.to) + '.csv',
    [
      'เลขที่',
      'วันที่',
      'เวลา',
      'แหล่งที่มา',
      'ประเภท',
      'น้ำหนัก',
      'จุดรับฝาก',
      'ผู้รับฝาก',
      'สถานะ',
      'หมายเหตุ',
      'เหตุผลยกเลิก',
    ],
    db.deposits
      .filter(inPer('deposit'))
      .map(r => [
        r.no || '',
        dnum(r.date),
        r.time,
        source(r.source).name,
        type(r.type).name,
        r.weight,
        r.point,
        r.operator,
        r.void ? 'ยกเลิก' : 'รับฝาก',
        r.note,
        r.voidReason || '',
      ]),
  );
}
registerList('deposit', () => {
  $('deplist').innerHTML = depView();
  $('depsum').innerHTML = depSum();
});
// One void at a time: a second click while one is in flight would reach the server as "already void" and read as bad data.
let voiding = false;
const single =
  f =>
  async (...a) => {
    if (voiding) return;
    voiding = true;
    try {
      return await f(...a);
    } finally {
      voiding = false;
    }
  };
const handlers = {
  depSlip,
  printDeposits,
  typeNote,
  depTotal,
  depClear,
  exportDeposits,
  saveDeposit,
  voidDepSlip: single(voidDepSlip),
  voidDeposit: single(voidDeposit),
};
export { render, handlers };
App.registerPage('deposit', {
  render,
  handlers,
  after() {
    if ($('deptotal')) depTotal();
  },
});
