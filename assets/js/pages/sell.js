'use strict';
// The sell screen: the slip being typed (S.draft), the register of sales, a slip's print view and voiding.
// Writes go through Api (create_sale, void_sale). The slip that opens after a save is built from the JSON the
// function returned, so it shows what the server kept (its number, its stock weights), not what was typed.
// A failed call leaves S.draft and the form alone.
import { esc, fmt, sum, be, dnum, date, nowTime, round, bahtText } from '../lib/fmt.js';
import { table, row, ptable, perBar, inPer, per, registerList } from '../lib/table.js';
import {
  db,
  S,
  $,
  today,
  signed,
  varCell,
  tchip,
  field,
  inp,
  options,
  heading,
  detail,
  printLogo,
  printHead,
  printFoot,
  cardhead,
  infoBtn,
  lhead,
  lname,
  loff,
  movedThisMonth,
  lastSale,
  rail,
  railsum,
  savebar,
  kv,
  impact,
  stock,
  refPrice,
  type,
} from '../ui.js';
import { App, printRegister } from '../app.js';
import { csv } from '../lib/csv.js';
import * as Api from '../api.js';
import * as Store from '../store.js';
let saving = false;
function render() {
  return (
    heading('ขายขยะ', 'ใบขายเดียวขายได้หลายประเภท • บันทึกแล้วพิมพ์ใบขายได้ทันที', '') +
    App.ifAdmin(
      '<form onsubmit="App.saveSale(event)"><div class="wcols"><div class="wmain"><section class="panel">' +
        cardhead(1, 'ข้อมูลใบขาย', 'เลขที่ใบออกให้อัตโนมัติ') +
        '<div class="formgrid deprow">' +
        field('วันที่และเวลาขาย', inp('sdate', 'datetime-local', today + 'T' + nowTime(), 'required')) +
        field(
          'ผู้รับซื้อ (ร้าน)',
          // A list, not a free-text box: the buyer is picked from ตั้งค่า › ผู้รับซื้อ, like the depositor on the
          // deposit screen. The option value is the name, which is what the slip prints and what buyerOf() looks
          // the row up by; create_sale still takes buyer_id as well, so the saved sale points at the row.
          '<select id="sbuyer" required onchange="App.buyerInfo()"><option value="">' +
            (db.buyers.some(x => x.active) ? 'เลือกผู้รับซื้อ' : '— ยังไม่มีรายชื่อ เพิ่มได้ที่ตั้งค่า —') +
            '</option>' +
            options(
              db.buyers.filter(x => x.active),
              'name',
              'name',
            ) +
            '</select><small class="muted" id="buyerinfo"></small>',
        ) +
        receiverField() +
        field('หมายเหตุ', inp('snote', 'text', '', 'maxlength="300" placeholder="หมายเหตุ (ถ้ามี)"')) +
        '</div></section><section class="panel">' +
        cardhead(2, 'รายการขาย', 'กรอกน้ำหนักเฉพาะประเภทที่ขาย', infoBtn('saleHelp', 'คำอธิบายช่องกรอกในรายการขาย')) +
        '<div id="salelines" class="lines"></div></section></div>' +
        rail(
          'ltotal',
          ['เป็นเงินรวม', '0.00', 'บาท'],
          [],
          '<button class="primary">ตรวจทานและบันทึก</button>' +
            '<button type="button" onclick="App.saleClear()">ล้างฟอร์ม</button>',
          'ยังไม่เขียนข้อมูลจนกดยืนยันในหน้าตรวจทาน',
          cardhead(3, 'ตรวจทานรายการ'),
        ) +
        '</div>' +
        savebar('sbar', 'ยังไม่มีรายการ', '0.00 บาท', '<button class="primary">ตรวจทานและบันทึก</button>') +
        '</form>',
    ) +
    // Same shape as ทะเบียนใบรับฝาก: the two ways out in the heading (พิมพ์รายงาน, ส่งออก CSV), the period bar
    // as the only toolbar, and the printed head and foot around the list so the register prints as a document.
    // No search box: every column carries its own filter, which says which column it is searching.
    '<section class="panel" id="salereg"><div class="panelhead"><div class="phtitle"><h2>ทะเบียนใบขาย</h2><div class="phsum" id="salesum">' +
    saleSum() +
    '</div></div><div class="actions"><button onclick="App.printSales()">พิมพ์รายงาน</button><button onclick="App.exportSales()">ส่งออก CSV</button></div></div>' +
    printHead('ทะเบียนใบขาย', date(per.sell.from) + ' – ' + date(per.sell.to)) +
    '<div class="toolbar"><div class="perbar" id="pb_sell">' +
    perBar('sell') +
    '</div></div><div id="salelist">' +
    saleView() +
    '</div>' +
    printFoot() +
    '</section>'
  );
}
function mkLine(t) {
  return { type: t.id, clear: true, sw: '', bw: '', price: String(refPrice(t)) };
}
// The card holds every type that has stock, so there is nothing to add and nothing to delete: a type is in the
// slip when a weight has been typed against it, exactly as on รายการรับฝาก. Switched off in ตั้งค่า does not take
// a type out of here while there is stock behind it - create_sale allows that sale, and it is the only way the
// stock can leave (db/deploy/004_functions_write.sql, the error contract).
const sellable = t => stock(t.id) > 0;
const inSlip = r => r.bw !== '' || r.sw !== '';
// One draft line per sellable type, in the order ตั้งค่า gives them, keeping whatever has been typed. A type
// whose stock reached zero while the screen was open drops out; one that just gained stock arrives empty.
function syncDraft() {
  let was = S.draft;
  S.draft = db.types.filter(sellable).map(t => was.find(r => r.type === t.id) || mkLine(t));
}
// `adj` is the correction a weighed sell-all line will book: our own scale against what the system holds.
// Blank on a sell-all line means nobody weighed the lot, so there is nothing to compare and no correction.
function lineVals(r) {
  let st = stock(r.type),
    bw = round(+r.bw || 0),
    sw = r.clear ? (r.sw === '' ? st : round(+r.sw || 0)) : round(r.sw === '' ? bw : +r.sw || 0),
    p = round(+r.price || 0);
  return { st, bw, sw, p, total: round(bw * p), adj: r.clear && r.sw !== '' ? round(sw - st) : 0 };
}
// The row's own sentence. คงคลัง is under the type's name now, so this says only what this line is about to do -
// and a row nobody has typed in says the one thing that matters about it: it is not in the slip.
function lineHint(r, v) {
  if (!inSlip(r)) return 'ยังไม่กรอกน้ำหนัก ประเภทนี้จะไม่เข้าใบขาย';
  let ref = refPrice(type(r.type), $('sdate')?.value.slice(0, 10) || today),
    parts = [];
  // What the sell-all line is about to do is said before it is saved, never discovered in a report later.
  if (r.clear)
    parts.push(
      r.sw === ''
        ? 'ขายหมด ตัดคลังทั้งหมด'
        : v.adj < 0
          ? '<b class="pricechg">จะบันทึกแก้ยอด ' + signed(v.adj) + ' กก. (ของหายหรือชั่งคลาดจากระบบ)</b>'
          : v.adj > 0
            ? '<b class="pricechg">รร.ชั่งเกินที่มีในคลัง ต้องตรวจใบรับฝากที่ตกหล่น</b>'
            : 'ขายหมด ชั่งได้ตรงกับระบบ',
    );
  else if (r.sw === '') parts.push('รร.ชั่งว่างไว้ = ใช้เท่ากับร้านชั่ง');
  if (r.price !== '' && v.p > 0 && v.p !== ref)
    parts.push('<b class="pricechg">ราคาอ้างอิงจะปรับจาก ' + fmt(ref) + ' เป็น ' + fmt(v.p) + '</b>');
  if (v.bw > 0 && v.sw > 0) parts.push('ต่างกัน ' + varCell(v.sw, v.bw) + ' กก.');
  return parts.join(' • ');
}
// One sellable type, as one row: what it is and what the store holds, how it is being sold, the two scales,
// the price, and what it comes to. No type box and no close button: the rows ARE the types, so what used to be
// a list the user built is now the same table รายการรับฝาก shows, with the same rows in the same order.
function lineRow(r, i) {
  let t = type(r.type),
    v = lineVals(r),
    n = esc(t.name),
    id = k => 'l' + k + i,
    num = (k, lab, val, extra) =>
      '<div><label class="mlab" for="' +
      id(k) +
      '">' +
      lab +
      '</label><input id="' +
      id(k) +
      '" type="number" inputmode="decimal" step="0.01" value="' +
      esc(val) +
      '" ' +
      extra +
      ' oninput="App.lineIn(' +
      i +
      ",'" +
      k +
      '\',this.value)"></div>';
  return (
    '<div class="lrow sell' +
    (inSlip(r) ? ' filled' : '') +
    '" id="line' +
    i +
    '" style="--c:' +
    t.color +
    '">' +
    // A type switched off while stock is still on the books says so where its name is: no more of it is coming
    // in, and this slip is how what is left leaves.
    lname(
      t,
      'คงคลัง <b>' + fmt(v.st) + '</b> กก.',
      t.active ? '' : '<span class="badge pending">ปิดรับฝากอยู่</span>',
    ) +
    '<div class="lmode"><span class="mlab">วิธีขาย</span><span class="seg seg-sm" role="group" aria-label="วิธีขาย ' +
    n +
    '"><button type="button" class="' +
    (r.clear ? 'on' : '') +
    '" aria-pressed="' +
    r.clear +
    '" onclick="App.lineSet(' +
    i +
    ',true)">ขายหมด</button><button type="button" class="' +
    (r.clear ? '' : 'on') +
    '" aria-pressed="' +
    !r.clear +
    '" onclick="App.lineSet(' +
    i +
    ',false)">บางส่วน</button></span></div>' +
    // Typeable on a sell-all line too, and empty by default: the lot on the scale at handover is the one
    // moment a shortfall can be noticed, and leaving the box locked to the system's figure is what used to
    // push that shortfall into the shop-scale variance. Empty still means "did not weigh it".
    num(
      'sw',
      'รร.ชั่ง (กก.)',
      r.sw,
      r.clear
        ? 'min="0.01" placeholder="' + fmt(v.st) + ' (ไม่ได้ชั่ง)" aria-label="รร.ชั่ง ' + n + ' (ขายหมด)"'
        : 'min="0.01" placeholder="= ร้านชั่ง" aria-label="รร.ชั่ง ' + n + '"',
    ) +
    num('bw', 'ร้านชั่ง (กก.)', r.bw, 'min="0.01" placeholder="0.00" aria-label="ร้านชั่ง ' + n + '"') +
    num('price', 'ราคา/กก.', r.price, 'min="0" aria-label="ราคาต่อกิโล ' + n + '"') +
    // The same figure คงคลังหลังรับฝาก is on the deposit screen: what the row works out to, quiet until the
    // row has something in it. The unit is in the column head, not after the number.
    '<div class="lamt ' +
    (v.total > 0 ? 'q' : 'dim') +
    '"><span class="mlab">จำนวนเงิน (บาท)</span><b id="' +
    id('amt') +
    '">' +
    fmt(v.total) +
    '</b></div><small class="lhint" id="' +
    id('hint') +
    '">' +
    lineHint(r, v) +
    '</small></div>'
  );
}
// A type that cannot be sold, as one line that keeps its place in the order rather than disappearing from it:
// empty but open (รับฝากเข้ามาก่อน), or switched off and sold out this month, which is this screen saying where
// the row that was here went. Switched off and sold out longer ago is gone - see movedThisMonth().
function typeRow(t) {
  if (sellable(t)) {
    let i = S.draft.findIndex(r => r.type === t.id);
    return i < 0 ? '' : lineRow(S.draft[i], i);
  }
  if (t.active) return loff(t, 'หมดคลัง', 'ไม่มีของให้ขาย · รับฝากเข้ามาก่อน');
  if (!movedThisMonth(t.id)) return '';
  let last = lastSale(t.id);
  return loff(
    t,
    'หมดคลัง · ปิดรับฝาก',
    (last ? 'ขายหมดเมื่อ ' + date(last.date) : 'ไม่มีของเหลือในคลัง') +
      ' · เปิดรับฝากที่ ตั้งค่า › ประเภทขยะ ถ้าจะรับเข้าอีก',
    true,
  );
}
function drawLines() {
  let el = $('salelines');
  if (!el) return;
  syncDraft();
  let rows = db.types.map(typeRow).join('');
  el.innerHTML = rows
    ? lhead('sell', ['ประเภท', 'วิธีขาย', 'รร.ชั่ง (กก.)', 'ร้านชั่ง (กก.)', 'ราคา/กก.', 'จำนวนเงิน (บาท)']) + rows
    : '<p class="muted lempty">ยังไม่มีประเภทขยะที่ขายได้ · รับฝากเข้ามาก่อน</p>';
  lineTotals();
}
// The same two numbers in both summaries: the rail beside the lines, and the bar above the menu on a phone.
// A sale moves stock and money, so both are shown - the weight the shop paid for and what it comes to.
function lineTotals() {
  let V = S.draft.filter(inSlip).map(lineVals),
    money = sum(V, 'total'),
    bw = sum(V, 'bw'),
    adj = V.reduce((s, v) => s + v.adj, 0);
  $('ltotal').innerHTML = railsum(
    ['เป็นเงินรวม', fmt(money), 'บาท'],
    [
      ['น้ำหนักที่ร้านชั่ง', fmt(bw) + ' กก.'],
      ['จำนวนรายการ', V.length + ' ประเภท'],
      ...(adj ? [['แก้ยอดคงคลัง', signed(adj) + ' กก.']] : []),
    ],
  );
  let bar = $('sbar');
  if (bar)
    bar.innerHTML =
      '<small>' +
      (V.length ? V.length + ' ประเภท · ' + fmt(bw) + ' กก.' : 'ยังไม่มีรายการ') +
      '</small><b>' +
      fmt(money) +
      ' บาท</b>';
}
// Typing changes the row in place - its amount, its sentence and the totals - rather than redrawing the list,
// which would take the caret out of the box being typed in. Whether the row counts as being in the slip can
// change with the first digit, so the row's own class is set here too.
function lineIn(i, k, val) {
  let r = S.draft[i];
  if (!r) return;
  r[k] = val;
  let v = lineVals(r);
  let amt = $('lamt' + i);
  amt.textContent = fmt(v.total);
  if (amt.parentElement) amt.parentElement.className = 'lamt ' + (v.total > 0 ? 'q' : 'dim');
  $('lhint' + i).innerHTML = lineHint(r, v);
  let row = $('line' + i);
  if (row) row.className = 'lrow sell' + (inSlip(r) ? ' filled' : '');
  lineTotals();
}
// The same button รายการรับฝาก has, doing the same thing: it empties what was typed about the waste and leaves
// the slip's own header alone (the date, the shop and who took the money), because a mistyped weight is not a
// reason to pick the shop again. Every row goes back to ขายหมด with the reference price of the day, which is
// what a row looks like before anyone has touched it.
function saleClear() {
  S.draft = [];
  let n = $('snote');
  if (n) n.value = '';
  drawLines();
}
// ขายหมด / บางส่วน. The weighed figure is dropped with the switch: it was weighed for the other way of selling.
function lineSet(i, clear) {
  let r = S.draft[i];
  if (!r) return;
  r.clear = clear;
  r.sw = '';
  drawLines();
}
function rcvOf(name) {
  let x = db.receivers.find(r => r.name === name);
  S.lastReceiver = name;
  return name ? { receiver: name, receiverRole: x?.role || '' } : {};
}
function refChanges(items, d) {
  let upd = [];
  items.forEach(i => {
    let t = db.types.find(x => x.id === i.type);
    if (!t || !(i.price > 0) || i.price === refPrice(t, d)) return;
    upd.push(t.name + ' ' + fmt(i.price));
  });
  return upd;
}
function lineErr(i, k, msg) {
  App.notify(msg);
  $('l' + k + i)?.focus?.();
}
// What the form asks for, on the info icon beside รายการขาย - the heading of the card that asks for it. It was
// a modal behind a ? on the register below, which is the wrong place twice over: the register is the record of
// sales already written, and a sheet that has to be dismissed to get back to the form is a sheet nobody opens
// while filling one in. One line per term; the bubble renders the newlines (.tip is white-space: pre-line).
const SALEHELP =
  'ขายหมด – ขายขยะประเภทนั้นทั้งหมด ระบบตัดคลังเท่าที่มีให้เหลือศูนย์ ไม่ต้องชั่งเอง\n' +
  'ขายบางส่วน – ชั่งส่วนที่ขายด้วยตาชั่งของโรงเรียนก่อนส่งมอบ ถ้าไม่ได้ชั่งให้ใช้เท่ากับที่ร้านชั่ง\n' +
  'รร.ชั่ง – น้ำหนักตามตาชั่งของโรงเรียน ใช้ลดยอดคงคลัง\n' +
  'ร้านชั่ง – น้ำหนักที่ร้านรับซื้อชั่ง ใช้คิดเงินและพิมพ์ในใบขาย\n' +
  'ราคาขาย – ถ้าราคาที่กรอกต่างจากราคาอ้างอิง ระบบจะปรับราคาอ้างอิงในตั้งค่าให้เอง โดยเริ่มใช้ตั้งแต่วันที่ขาย\n' +
  'ถ้าน้ำหนักต่างกันมากผิดปกติ ควรชั่งซ้ำหรือตรวจตาชั่ง';
const saleHelp = (_arg, el) => App.info(el, SALEHELP);
function buyerOf(name) {
  return db.buyers.find(x => x.name === String(name).trim());
}
function buyerLine(x) {
  return [x.address, x.phone ? 'โทร ' + x.phone : ''].filter(Boolean).map(esc).join(' • ');
}
// The picked shop's contact details, under the list. Nothing to say when nothing is picked; a name that is not in
// the list cannot be picked any more, so there is no "not in the list" case to report here.
function buyerInfo() {
  let x = buyerOf($('sbuyer').value);
  $('buyerinfo').textContent = x ? [x.contact, x.phone, x.address].filter(Boolean).join(' • ') : '';
}
// The guard covers the review sheet as well as the write (see saveDeposit): two clicks, one slip.
async function saveSale(e) {
  e.preventDefault();
  if (saving) return;
  saving = true;
  try {
    return await writeSale(e);
  } finally {
    saving = false;
  }
}
async function writeSale(e) {
  if (!App.user()) return App.showLogin();
  let dt = $('sdate').value,
    d = dt.slice(0, 10),
    tm = dt.slice(11, 16),
    buyer = $('sbuyer').value.trim(),
    receiver = ($('sreceiver')?.value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !buyer) return App.notify('กรอกวันที่และเวลา และผู้รับซื้อ');
  // The slip says who took the money, so the name is required here as ผู้รับฝาก is on a deposit. The database
  // still accepts a sale without one (create_sale nullifies a blank receiver_name), and the slips written before
  // this was asked for keep showing ไม่ระบุ in the register; what is closed is the way to write another.
  if (!receiver)
    return App.notify(
      db.receivers.some(x => x.active)
        ? 'เลือกผู้รับเงิน'
        : 'ยังไม่มีรายชื่อผู้รับเงิน เพิ่มได้ที่ ตั้งค่า › ผู้รับเงิน',
    );
  let items = [];
  // Every sellable type has a row; the ones nobody typed a weight into are not part of this slip, the same rule
  // รายการรับฝาก uses (create_sale and create_deposit both skip a line with no weight as well).
  for (const [i, r] of S.draft.entries()) {
    if (!inSlip(r)) continue;
    let v = lineVals(r),
      n = type(r.type).name;
    if (!(v.bw > 0)) return lineErr(i, 'bw', 'กรอกน้ำหนักที่ร้านชั่งของ ' + n);
    if (!(v.sw > 0)) return lineErr(i, 'sw', 'กรอกน้ำหนักที่รร.ชั่งของ ' + n);
    if (v.sw > v.st)
      return lineErr(
        i,
        'sw',
        n +
          ': ' +
          (r.sw === ''
            ? 'ร้านชั่งเกินที่มีในคลัง ' + fmt(v.st) + ' กก. กรอกน้ำหนักที่รร.ชั่ง'
            : 'รร.ชั่งเกินที่มีในคลัง ' + fmt(v.st) + ' กก.'),
      );
    if (r.price === '' || !(v.p >= 0)) return lineErr(i, 'price', 'ราคาของ ' + n + ' ต้องตั้งแต่ 0');
    items.push({
      type: r.type,
      clear: r.clear,
      // null, not the system's figure, when a sell-all line was not weighed: that is how the server tells
      // "nobody put it on a scale" from "we weighed it and it came to exactly what you think it is".
      stockWeight: r.clear && r.sw === '' ? null : v.sw,
      buyerWeight: v.bw,
      price: v.p,
      total: v.total,
    });
  }
  if (!items.length)
    return App.notify(db.types.some(sellable) ? 'เพิ่มรายการขายอย่างน้อย 1 รายการ' : 'ไม่มีขยะคงคลังให้ขาย');
  let bx = buyerOf(buyer),
    upd = refChanges(items, d),
    adj = items.filter(i => i.clear && i.stockWeight !== null && round(i.stockWeight - stock(i.type)) !== 0);
  // The sheet before the write: every line as money, what the slip comes to, and the two things a sale does
  // besides book the money - the stock it takes out and any reference price it moves.
  if (
    !(await App.review({
      title: 'ตรวจทานใบขาย',
      sub: 'ยืนยันแล้วคงคลังจะลดตามน้ำหนักที่ชั่ง และบันทึกรายรับเข้าโรงเรียน',
      body:
        kv([
          ['วันที่และเวลา', date(d) + ' เวลา ' + esc(tm || nowTime()) + ' น.'],
          ['ผู้รับซื้อ', esc(buyer)],
          ['ผู้รับเงิน', esc(receiver)],
          ...items.map(i => [
            type(i.type).name + ' · ' + fmt(i.buyerWeight) + ' กก. × ' + fmt(i.price),
            fmt(i.total) + ' บาท',
          ]),
          ['total', 'รวม ' + fmt(sum(items, 'buyerWeight')) + ' กก.', fmt(sum(items, 'total')) + ' บาท'],
        ]) +
        impact(
          'หลังบันทึก',
          items
            .map(
              i =>
                type(i.type).name +
                ' ' +
                fmt(stock(i.type)) +
                ' → ' +
                fmt(round(stock(i.type) - (i.stockWeight === null ? stock(i.type) : i.stockWeight))) +
                ' กก.',
            )
            .join(' · '),
          'ok',
        ) +
        (upd.length ? impact('ราคาอ้างอิงจะถูกปรับ', upd.join(' · ') + ' บาท/กก. ตั้งแต่วันที่ขาย') : '') +
        (adj.length
          ? impact(
              'จะบันทึกแก้ยอดคงคลัง',
              adj
                .map(i => type(i.type).name + ' ' + signed(round(i.stockWeight - stock(i.type))) + ' กก.')
                .join(' · ') + ' เพราะน้ำหนักที่รร.ชั่งไม่ตรงกับที่ระบบถืออยู่',
            )
          : ''),
      confirm: 'ยืนยันบันทึกใบขาย',
    }))
  )
    return;
  let rc = rcvOf(receiver);
  let b = e.submitter;
  if (b) b.disabled = true;
  let saved;
  // The guard covers the write AND the redraw (see saveDeposit).
  try {
    try {
      saved = await Api.createSale({
        date: d,
        time: tm || nowTime(),
        buyerId: bx ? bx.id : null,
        buyer,
        ref: '',
        receiver: rc.receiver,
        receiverRole: rc.receiverRole,
        note: $('snote').value.trim(),
        items,
      });
    } catch (x) {
      return App.fail(x, stockHint(x));
    }
    // The write has committed: from here nothing may throw as if the save had failed.
    //
    // Which types this sale finished off, worked out here, while db still holds the stock these figures came
    // from (the same arithmetic the review sheet showed a moment ago). A type that was switched off in ตั้งค่า
    // and has just had the last of it sold leaves this screen for good, and a row that vanishes without a word
    // is a row the next person goes looking for.
    let gone = items
      .filter(i => {
        let t = db.types.find(x => x.id === i.type);
        return t && !t.active && round(stock(i.type) - (i.stockWeight === null ? stock(i.type) : i.stockWeight)) <= 0;
      })
      .map(i => type(i.type).name);
    S.draft = [];
    App.render();
    if (!saved) {
      if (await App.reload(['sales', 'types']))
        App.notify('บันทึกใบขายแล้ว แต่ไม่ได้รับข้อมูลใบกลับมา ดูได้ที่ทะเบียนใบขาย');
      return;
    }
    let s = Store.saleFromRpc(saved);
    // The corrections are read back from the server's own rows, not from what was on screen: the stock the
    // screen compared against may have been stale, and the figure the school keeps is the server's.
    let adj = (saved.adjustments || []).map(a => a.waste_type_name + ' ' + fmt(+a.diff));
    if (await App.reload(['sales', 'types', 'adjustments']))
      App.notify(
        'บันทึกใบขาย ' +
          s.no +
          ' แล้ว' +
          (upd.length ? ' • ปรับราคาอ้างอิง ' + upd.join(', ') : '') +
          (adj.length ? ' • แก้ยอด ' + adj.join(', ') + ' กก.' : '') +
          (gone.length
            ? ' • ' +
              gone.join(', ') +
              ' ขายหมดแล้วและปิดรับฝากอยู่ จึงไม่อยู่ในรายการขายอีก ดูได้ที่ คงคลัง และ ตั้งค่า › ประเภทขยะ'
            : ''),
      );
    saleSlipOf(s);
  } finally {
    if (b) b.disabled = false;
  }
}
// WB001 cannot say whether the operator left the our-weight box blank; the draft can. Same two sentences as the client check above.
function stockHint(x) {
  let m = x && x.code === 'WB001' && /^insufficient stock for (.*): available (-?[\d.]+) kg\s*$/s.exec(x.message || '');
  if (!m) return {};
  let i = S.draft.findIndex(r => type(r.type).name === m[1]);
  if (i < 0 || S.draft[i].clear || S.draft[i].sw !== '') return {};
  return { text: m[1] + ': ร้านชั่งเกินที่มีในคลัง ' + fmt(+m[2]) + ' กก. กรอกน้ำหนักที่รร.ชั่ง' };
}
function saleSlip(id) {
  saleSlipOf(db.sales.find(x => x.id === id));
}
function saleSlipOf(s) {
  let bx = db.buyers.find(x => x.id === s.buyerId),
    bl = bx ? buyerLine(bx) : '';
  detail(
    '<div class="sliphead">' +
      printLogo() +
      '<div><h2 style="margin:0">ใบขายขยะรีไซเคิล</h2><small>' +
      esc(db.school) +
      ' • ธนาคารขยะ</small></div><div class="right"><b>เลขที่ ' +
      esc(s.no) +
      '</b><br><small>วันที่ ' +
      date(s.date) +
      (s.time ? ' เวลา ' + s.time + ' น.' : '') +
      '</small></div></div>' +
      (s.void ? '<p class="note">ใบขายนี้ถูกยกเลิก: ' + esc(s.voidReason) + '</p>' : '') +
      '<p>ผู้รับซื้อ <b>' +
      esc(s.buyer) +
      '</b>' +
      (s.ref ? ' • เอกสารอ้างอิง ' + esc(s.ref) : '') +
      (bl ? '<br><small>' + bl + '</small>' : '') +
      '</p>' +
      table(
        ['ลำดับ', 'รายการ', 'น้ำหนัก (กก.)', 'ราคา/กก.', 'จำนวนเงิน (บาท)'],
        // The type wears its own pill here, the way it does on ใบรับฝาก and in both registers: one slip can run to
        // six lines, and the colour is what tells them apart before the figures are read. On paper it prints as
        // the word alone (the @media print rule for .badge).
        s.items.map((r, i) => row([i + 1, tchip(r.type), fmt(r.buyerWeight), fmt(r.price), fmt(r.total)])),
      ) +
      '<div class="totals"><div>รวมเป็นเงิน<b>' +
      fmt(s.total) +
      ' บาท</b></div><div>ตัวอักษร<b style="font-size:16px">(' +
      bahtText(s.total) +
      ')</b></div></div><p><small>น้ำหนักตามตาชั่งร้านรับซื้อ • บันทึกโดย ' +
      esc(s.operator) +
      (s.note ? ' • ' + esc(s.note) : '') +
      '</small></p>' +
      (s.receiver
        ? '<p class="slipby">ผู้รับเงิน (ธนาคารขยะ) <b>' +
          esc(s.receiver) +
          '</b>' +
          (s.receiverRole ? ' · ' + esc(s.receiverRole) : '') +
          '</p>'
        : ''),
  );
}
function saleTable(a) {
  return ptable(
    'sell',
    // The columns ทะเบียนใบรับฝาก and this one share are worded the same way: เลขที่ / วันที่, the counterparty,
    // ประเภท น้ำหนัก (กก.), the person, สถานะ. The per-type weight is the school's own reading, so the lines add
    // up to the รร.ชั่ง column beside them, which is the figure that moved the stock.
    [
      'เลขที่ / วันที่',
      'ผู้รับซื้อ',
      'ประเภท น้ำหนัก (กก.)',
      'รร.ชั่ง (กก.)',
      'ร้านชั่ง (กก.)',
      'ต่างกัน (กก.)',
      'รายรับ (บาท)',
      'ผู้รับเงิน',
      'สถานะ',
      '',
    ],
    a.map(r => {
      let sw = sum(r.items, 'stockWeight'),
        bw = sum(r.items, 'buyerWeight');
      return {
        k: { 0: r.date + r.no, 9: null },
        f: { 1: [r.buyer], 2: r.items.map(i => type(i.type).name), 7: [r.receiver || 'ไม่ระบุ'] },
        c: [
          esc(r.no) + '<br><small>' + date(r.date) + (r.time ? ' ' + r.time : '') + '</small>',
          esc(r.buyer) + (r.ref ? '<br><small>' + esc(r.ref) + '</small>' : ''),
          r.items
            .map(i => '<span class="dline">' + tchip(i.type) + '<small>' + fmt(i.stockWeight) + '</small></span>')
            .join('<br>'),
          fmt(sw),
          fmt(bw),
          varCell(sw, bw),
          fmt(r.total),
          r.receiver ? esc(r.receiver) : '<span class="muted">ไม่ระบุ</span>',
          '<span class="badge ' + (r.void ? 'pending' : 'ok') + '">' + (r.void ? 'ยกเลิก' : 'ขายแล้ว') + '</span>',
          '<button class="minibtn" data-act="saleSlip" data-arg="' +
            esc(r.id) +
            '">ดูใบขาย</button> ' +
            App.ifAdmin(
              !r.void
                ? '<button class="minibtn danger" data-act="voidSale" data-arg="' + esc(r.id) + '">ยกเลิก</button>'
                : '',
            ),
        ],
      };
    }),
    [1, 2, 7, 8],
  );
}
// Newest slip first, like ทะเบียนใบรับฝาก. There is no search over the whole register: each column carries its
// own filter under its heading, which says what it is searching instead of leaving that to be guessed.
function saleView() {
  return saleTable(db.sales.filter(inPer('sell')).slice().reverse());
}
function saleSum() {
  let all = db.sales.filter(inPer('sell')),
    ok = all.filter(r => !r.void),
    L = ok.flatMap(r => r.items),
    bw = sum(L, 'buyerWeight'),
    v = all.length - ok.length;
  return (
    '<span class="phrange">' +
    date(per.sell.from) +
    ' – ' +
    date(per.sell.to) +
    '</span><span class="phnum"><b>' +
    ok.length +
    '</b> ใบ' +
    (v ? ' <small>(ยกเลิก ' + v + ')</small>' : '') +
    '</span><span class="phnum">รายรับ <b>' +
    fmt(sum(ok, 'total')) +
    '</b> บาท</span><span class="phnum">ร้านชั่ง <b>' +
    fmt(bw) +
    '</b> กก.</span>'
  );
}
async function voidSale(id) {
  let r = db.sales.find(x => x.id === id),
    // A weighed sell-all line on this slip left a stock count behind, and void_sale cancels it with the
    // slip so the whole document is undone. Say so before the reason is typed, not afterwards.
    counts = db.adjustments.filter(a => a.saleId === id && !a.void),
    reason = await App.askReason('ยกเลิกใบขาย ' + r.no, {
      impact: impact(
        'ยืนยันแล้วจะเกิดอะไร',
        'คงคลังเพิ่มกลับ ' +
          fmt(sum(r.items, 'stockWeight')) +
          ' กก. ใน ' +
          r.items.length +
          ' ประเภท · รายรับลดลง ' +
          fmt(r.total) +
          ' บาท · รายงานช่วงที่มีใบนี้เปลี่ยนตาม · ใบรับฝากที่ถูกล็อกเพราะใบขายนี้จะยกเลิกได้อีกครั้ง' +
          (counts.length ? ' · แก้ยอด ' + counts.map(a => fmt(a.diff)).join(', ') + ' กก. จะถูกยกเลิกด้วย' : ''),
        'bad',
      ),
      reasons: ['บันทึกน้ำหนักผิด', 'ร้านยกเลิกการซื้อ', 'บันทึกซ้ำ'],
      word: r.no,
    });
  if (!reason) return;
  try {
    await Api.voidSale(r.id, reason);
  } catch (x) {
    return App.fail(x);
  }
  if (await App.reload(['sales', 'adjustments']))
    App.notify(
      'ยกเลิกใบขายแล้ว น้ำหนักคืนเข้าคงคลัง' +
        (counts.length ? ' • ยกเลิกแก้ยอด ' + counts.length + ' รายการด้วย' : ''),
    );
}
// Who is picked, like ผู้รับฝาก on the deposit screen: only a name that is switched on is offered, nothing is
// pre-selected, and the empty option says เลือกผู้รับเงิน rather than ไม่ระบุ, so the slip cannot be written
// without naming the person who took the money. Within the visit the last pick is offered back (S.lastReceiver),
// which saves retyping through a stack of slips without ever opening on a choice nobody made this time.
function receiverField() {
  let live = db.receivers.filter(x => x.active),
    sel = live.some(x => x.name === S.lastReceiver) ? S.lastReceiver : '';
  return field(
    'ผู้รับเงิน',
    '<select id="sreceiver" required><option value="">' +
      (live.length ? 'เลือกผู้รับเงิน' : '— ยังไม่มีรายชื่อ เพิ่มได้ที่ตั้งค่า —') +
      '</option>' +
      live
        .map(
          x =>
            '<option value="' +
            esc(x.name) +
            '"' +
            (x.name === sel ? ' selected' : '') +
            (x.role ? ' title="' + esc(x.role) + '"' : '') +
            '>' +
            esc(x.name) +
            '</option>',
        )
        .join('') +
      '</select>',
  );
}
function exportSales() {
  csv(
    'sales_' + be(per.sell.from) + '_' + be(per.sell.to) + '.csv',
    [
      'เลขที่',
      'วันที่',
      'ผู้รับซื้อ',
      'เวลา',
      'ประเภท',
      'วิธีขาย',
      'รร.ชั่งกก.',
      'ร้านชั่งกก.',
      'ต่างกันกก.',
      'ราคาขาย',
      'จำนวนเงิน',
      'ผู้บันทึก',
      'ผู้รับเงิน',
      'สถานะ',
      'เหตุผลยกเลิก',
    ],
    db.sales
      .filter(inPer('sell'))
      .flatMap(s =>
        s.items.map(i => [
          s.no,
          dnum(s.date),
          s.buyer,
          s.time || '',
          type(i.type).name,
          i.clear ? 'ขายหมด' : 'บางส่วน',
          i.stockWeight,
          i.buyerWeight,
          round(i.buyerWeight - i.stockWeight),
          i.price,
          i.total,
          s.operator,
          s.receiver || '',
          s.void ? 'ยกเลิก' : 'ขายแล้ว',
          s.voidReason || '',
        ]),
      ),
  );
}
registerList('sell', () => {
  $('salelist').innerHTML = saleView();
  $('salesum').innerHTML = saleSum();
});
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
  buyerInfo,
  exportSales,
  lineIn,
  lineSet,
  saleClear,
  printSales: printRegister,
  saleHelp,
  saleSlip,
  saveSale,
  voidSale: single(voidSale),
};
export { render, handlers };
App.registerPage('sell', {
  render,
  handlers,
  after() {
    if ($('salelines')) drawLines();
  },
});
