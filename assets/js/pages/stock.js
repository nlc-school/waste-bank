'use strict';
// The stock screen: balances by type, this month's trend, what should be done next, and the two newest slips.
import { esc, fmt, sum, be, date, round, shiftDay } from '../lib/fmt.js';
import {
  db,
  today,
  TH,
  adjCol,
  icon,
  infoBtn,
  tchip,
  stats,
  active,
  sold,
  lines,
  moved,
  stock,
  refPrice,
  type,
} from '../ui.js';
import { App } from '../app.js';
import { csv } from '../lib/csv.js';
import { todos, WATCHING } from '../lib/todo.js';
function stockInsights() {
  let m0 = today.slice(0, 8) + '01',
    day = +today.slice(8, 10),
    pm = shiftDay(m0, -1).slice(0, 8),
    pLast = +shiftDay(m0, -1).slice(8, 10),
    pTo = pm + String(Math.min(day, pLast)).padStart(2, '0'),
    inR = (a, b) => r => r.date >= a && r.date <= b,
    dep = active(),
    sal = sold(),
    dC = sum(dep.filter(inR(m0, today)), 'weight'),
    dP = sum(dep.filter(inR(pm + '01', pTo)), 'weight'),
    rC = sum(sal.filter(inR(m0, today)), 'total'),
    rP = sum(sal.filter(inR(pm + '01', pTo)), 'total'),
    y = today.slice(0, 4),
    yd = dep.filter(r => r.date.startsWith(y)),
    ys = sal.filter(r => r.date.startsWith(y)),
    pName = new Date(pm + '01T00:00:00').toLocaleDateString(TH, { month: 'short' }),
    cName = new Date(m0 + 'T00:00:00').toLocaleDateString(TH, { month: 'short' }),
    rng = '1–' + day + ' ' + cName + ' เทียบ 1–' + Math.min(day, pLast) + ' ' + pName,
    delta = (c, p) => {
      if (!p)
        return c
          ? '<span class="sp-delta flat">เดือนก่อนไม่มีรายการ</span>'
          : '<span class="sp-delta flat">ยังไม่มีรายการ</span>';
      let d = ((c - p) / p) * 100,
        k = Math.abs(d) < 0.5 ? 'flat' : d > 0 ? 'up' : 'down';
      return (
        '<span class="sp-delta ' +
        k +
        '">' +
        (k === 'up' ? '▲ +' : k === 'down' ? '▼ −' : '● ') +
        fmt(Math.abs(d), 0) +
        '%</span>'
      );
    },
    box = (lab, val, unit, dl, sub) =>
      '<div class="sp-ins"><small>' +
      lab +
      '</small><b class="sp-insv">' +
      val +
      ' <span>' +
      unit +
      '</span></b><div class="sp-insd">' +
      dl +
      '</div><span>' +
      sub +
      '</span></div>';
  return (
    '<div class="sp-insights" aria-label="แนวโน้ม">' +
    box('รับฝากเทียบเดือนก่อน', fmt(dC), 'กก.', delta(dC, dP), rng + ' · เดือนก่อน ' + fmt(dP) + ' กก.') +
    box('รายรับเทียบเดือนก่อน', fmt(rC), 'บาท', delta(rC, rP), rng + ' · เดือนก่อน ' + fmt(rP) + ' บาท') +
    box(
      'สะสมทั้งปี พ.ศ. ' + (+y + 543),
      fmt(sum(yd, 'weight')),
      'กก.',
      '<a href="#" class="drill" onclick="App.per.report=App.yearPer(App.today);App.pgReset(\'report\');App.go(\'report\');return false">ดูรายงานทั้งปี</a>',
      'รายรับ ' +
        fmt(sum(ys, 'total')) +
        ' บาท · ' +
        yd.length +
        ' รายการ จาก ' +
        new Set(yd.map(r => r.source)).size +
        ' แหล่ง',
    ) +
    '</div>'
  );
}
function render() {
  let rows = db.types.map(t => {
      let st = stock(t.id),
        p = refPrice(t);
      return { t, st, p, val: round(st * p) };
    }),
    left = round(rows.reduce((s, r) => s + r.st, 0)),
    tval = round(rows.reduce((s, r) => s + r.val, 0)),
    pct = r => (left > 0 ? (r.st / left) * 100 : 0),
    mon = today.slice(0, 7),
    inM = r => r.date.startsWith(mon),
    monIn = active().filter(inM),
    monSold = sold().filter(inM),
    L = lines().filter(inM),
    mSw = sum(L, 'stockWeight'),
    mBw = sum(L, 'buyerWeight'),
    ld = lastDepositSlip(),
    ls = sold()
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date) || b.no.localeCompare(a.no))[0];
  return (
    '<div class="sp"><div class="sp-head"><div class="sp-titlerow"><h1 class="sp-title">ขยะคงคลัง</h1><span class="sp-asof">ข้อมูล ณ ' +
    date(today) +
    '</span></div>' +
    '<div class="sp-acts"><button type="button" onclick="App.go(\'sell\')">' +
    icon('sell') +
    'ขายขยะ</button><button type="button" class="primary" onclick="App.go(\'deposit\')">' +
    icon('plus') +
    'รับฝากขยะ</button></div></div><div class="sp-grid">' +
    stats([
      ['คงคลังรวม', fmt(left), 'กก.', 'มูลค่าโดยประมาณ ' + fmt(tval) + ' บาท'],
      [
        'รับฝากเดือนนี้',
        fmt(sum(monIn, 'weight')),
        'กก.',
        // Slips, not item rows, and no source count: the card beside it reads "จาก N ใบขาย", and a deposit slip is
        // the thing a teacher would go and open. The link is the register, filtered to this month.
        'จาก <a href="#" class="drill" onclick="App.drill(\'deposit\',App.monthPer(App.today));return false">' +
          new Set(monIn.map(r => r.no || r.id)).size +
          ' ใบรับฝาก</a>',
      ],
      [
        'รายรับเดือนนี้',
        fmt(sum(monSold, 'total')),
        'บาท',
        'จาก <a href="#" class="drill" onclick="App.drill(\'sell\',App.monthPer(App.today));return false">' +
          monSold.length +
          ' ใบขาย</a>',
      ],
      ['ขายเดือนนี้ (ร้านชั่ง)', fmt(mBw), 'กก.', 'รร.ชั่งได้ ' + fmt(mSw) + ' กก.'],
    ]) +
    '<section class="sp-main"><div class="sp-cardhead"><h2>คงคลังตามประเภท</h2><button class="minibtn" onclick="App.exportStock()">ส่งออก CSV</button></div><div class="tablewrap"><table class="sp-table"><thead><tr><th>ประเภท</th><th>สัดส่วนในคลัง</th><th>ราคา/กก.</th><th>คงเหลือ (กก.)</th><th>มูลค่า (บาท)</th></tr></thead><tbody>' +
    rows
      .map(
        r =>
          '<tr><td>' +
          tchip(r.t.id) +
          (r.t.active ? '' : ' <span class="badge pending">ปิดรับฝาก</span>') +
          '</td><td><span class="sp-share"><span class="sp-bar"><i style="width:' +
          pct(r) +
          '%;background:' +
          r.t.color +
          '"></i></span><small>' +
          (r.st > 0 ? fmt(pct(r), 1) + '%' : '—') +
          '</small></span></td><td>' +
          fmt(r.p) +
          '</td><td>' +
          (r.st > 0 ? '<b>' + fmt(r.st) + '</b>' : '<span class="muted">หมดคลัง</span>') +
          '</td><td>' +
          (r.st > 0 ? fmt(r.val) : '<span class="muted">—</span>') +
          '</td></tr>',
      )
      .join('') +
    '</tbody><tfoot><tr><td>รวม ' +
    rows.length +
    ' ประเภท</td><td></td><td></td><td>' +
    fmt(left) +
    '</td><td>' +
    fmt(tval) +
    '</td></tr></tfoot></table></div>' +
    stockInsights() +
    '</section><div class="sp-side">' +
    todoCard() +
    lastDeposit(ld) +
    lastSale(ls) +
    '</div></div></div>'
  );
}
// One whole button per destination, written out: a handler is never built by concatenation, not even from a
// value this file chose itself (tests/js/inline_handlers.test.js holds that line).
const TODOBTN = {
  sell: '<button class="minibtn" onclick="App.go(\'sell\')">',
  settings: '<button class="minibtn" onclick="App.go(\'settings\')">',
  deposit: '<button class="minibtn" onclick="App.go(\'deposit\')">',
};
// รายการแจ้งเตือน: the first screen's one piece of advice. The rules are lib/todo.js, which reads only rows the
// app already holds; this draws them, keeps the two worth acting on at the top and folds the rest into a line,
// and says plainly when there is nothing to do rather than leaving an empty box.
function todoCard() {
  let all = todos(db, today, { stock, refPrice, sold, active }),
    show = all.slice(0, 2),
    rest = all.slice(2);
  return (
    '<section class="sp-todo"><div class="blockhead"><div class="bhtitle"><h2>รายการแจ้งเตือน</h2>' +
    infoBtn('todoHelp', 'ระบบเตือนเรื่องอะไรได้บ้าง') +
    '</div>' +
    (all.length
      ? '<span class="badge warn">' + all.length + ' รายการ</span>'
      : '<span class="badge ok">ไม่มีรายการแจ้งเตือน</span>') +
    '</div>' +
    (all.length
      ? show
          .map(
            t =>
              '<div class="todo ' +
              t.tone +
              '"><div><b>' +
              esc(t.title) +
              '</b><small>' +
              esc(t.text) +
              '</small></div>' +
              TODOBTN[t.go] +
              esc(t.label) +
              '</button></div>',
          )
          .join('') +
        (rest.length
          ? '<p class="todomore">อีก ' + rest.length + ' รายการ: ' + rest.map(t => esc(t.title)).join(' · ') + '</p>'
          : '')
      : '<p class="todonone">คงคลังอยู่ในเกณฑ์ ราคาอ้างอิงเป็นปัจจุบัน และมีการรับฝากต่อเนื่อง</p>') +
    '</section>'
  );
}
// The newest deposit slip, as the store's flat rows see it: every live item of the slip whose date and time are
// the latest. Live items only, so a slip whose every line was voided is not "the latest" any more.
function lastDepositSlip() {
  const g = new Map();
  for (const r of active()) {
    const k = r.no || r.id;
    if (!g.has(k)) g.set(k, []);
    g.get(k).push(r);
  }
  return [...g.values()].sort((a, b) => (b[0].date + b[0].time).localeCompare(a[0].date + a[0].time))[0] || null;
}
// ใบรับฝากล่าสุด and ใบขายล่าสุด are the same card: the slip number and when it was written, who it names, the
// types on it as chips, its two totals, and one button that opens the slip itself. A deposit slip carries no
// money of its own, so its second figure is the stock value of what came in, at today's reference prices.
function lastDeposit(g) {
  if (!g)
    return '<section class="soft"><h2>ใบรับฝากล่าสุด</h2><p class="muted" style="margin:0">ยังไม่มีใบรับฝาก</p><div><button class="primary" onclick="App.go(\'deposit\')">รับฝากขยะ</button></div></section>';
  const h = g[0],
    w = round(sum(g, 'weight')),
    val = round(g.reduce((n, r) => n + r.weight * refPrice(type(r.type)), 0));
  return (
    '<section class="soft"><div class="blockhead"><h2>ใบรับฝากล่าสุด</h2><small>' +
    esc(h.no) +
    ' · ' +
    date(h.date) +
    (h.time ? ' ' + esc(h.time) + ' น.' : '') +
    '</small></div><div><b>' +
    esc(h.operator) +
    '</b><div class="lschips">' +
    g.map(r => tchip(r.type)).join('') +
    '</div></div><div class="lsstats"><div><small>น้ำหนักรับฝากรวม</small><b>' +
    fmt(w) +
    ' <span>กก.</span></b></div><div><small>มูลค่ารวม</small><b>' +
    fmt(val) +
    ' <span>บาท</span></b></div></div><button data-act="depSlip" data-arg="' +
    esc(h.no || h.id) +
    '">เปิดใบรับฝาก</button></section>'
  );
}
function lastSale(s) {
  if (!s)
    return '<section class="soft"><h2>ใบขายล่าสุด</h2><p class="muted" style="margin:0">ยังไม่มีใบขาย</p><div><button class="primary" onclick="App.go(\'sell\')">ขายขยะ</button></div></section>';
  return (
    '<section class="soft"><div class="blockhead"><h2>ใบขายล่าสุด</h2><small>' +
    esc(s.no) +
    ' · ' +
    date(s.date) +
    (s.time ? ' ' + esc(s.time) + ' น.' : '') +
    '</small></div><div><b>' +
    esc(s.buyer) +
    '</b><div class="lschips">' +
    s.items.map(i => tchip(i.type)).join('') +
    '</div></div><div class="lsstats"><div><small>น้ำหนักขายรวม</small><b>' +
    fmt(sum(s.items, 'buyerWeight')) +
    ' <span>กก.</span></b></div><div><small>รายได้ขายรวม</small><b>' +
    fmt(s.total) +
    ' <span>บาท</span></b></div></div><button data-act="saleSlip" data-arg="' +
    esc(s.id) +
    '">เปิดใบขาย</button></section>'
  );
}
// The ± แก้ยอด column is dropped when the school has no stock counts, by the same rule the report uses
// (ui.js adjCol): a school that has never had one should not meet a column of zeros in either place.
function exportStock() {
  csv(
    'stock_' + be(today) + '.csv',
    adjCol(
      ['ประเภท', 'รับเข้ากก.', 'ขายกก.(รร.ชั่ง)', 'แก้ยอดชั่งจริงกก.', 'คงเหลือกก.', 'ราคาอ้างอิง', 'มูลค่าโดยประมาณ'],
      3,
    ),
    db.types.map(t => {
      let m = moved(t.id),
        st = stock(t.id);
      return adjCol([t.name, m.in, m.out, m.adj, st, refPrice(t), round(st * refPrice(t))], 3);
    }),
  );
}
// The one explanation the card carries: what the app watches for, read where the warnings appear. The text is
// WATCHING in lib/todo.js, built from the same constants the rules use.
const todoHelp = (_arg, el) => App.info(el, WATCHING);
const handlers = { exportStock, todoHelp };
export { render, handlers };
App.registerPage('stock', { render, handlers });
