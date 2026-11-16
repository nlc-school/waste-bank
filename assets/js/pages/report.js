'use strict';
// The report screen: movement by type over a period, monthly and per-source summaries, the sales in the period.
import { esc, fmt, sum, be, date, round, shiftDay } from '../lib/fmt.js';
import { table, row, ptable, pager, registerList, perBar, per, pg } from '../lib/table.js';
import {
  db,
  $,
  today,
  TH,
  adjCol,
  signed,
  varCell,
  tchip,
  schip,
  heading,
  detail,
  printHead,
  printFoot,
  stats,
  active,
  sold,
  adjusted,
  lines,
  moved,
  stockAt,
  refPrice,
  type,
} from '../ui.js';
import { App } from '../app.js';
import { csv } from '../lib/csv.js';
function reportRows() {
  let prev = shiftDay(per.report.from, -1);
  return db.types.map(ty => {
    let close = stockAt(ty.id, per.report.to),
      p = refPrice(ty, per.report.to);
    return {
      ty,
      m: moved(ty.id, per.report.from, per.report.to),
      open: stockAt(ty.id, prev),
      close,
      p,
      val: round(close * p),
    };
  });
}
function drill(k, p) {
  let dep = k === 'deposit',
    st = (pg[k] ??= { size: 10, page: 1 });
  per[k] = { ...(p || per.report) };
  st.f = { [dep ? 5 : 8]: dep ? 'รับฝากแล้ว' : 'ขายแล้ว' };
  st.sort = null;
  st.page = 1;
  App.go(k);
  document.getElementById(dep ? 'depreg' : 'salereg')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
}
function dsh(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString(TH, { day: 'numeric', month: 'short', year: '2-digit' });
}
function drng(a, b) {
  return a.slice(0, 7) === b.slice(0, 7) ? +a.slice(8) + '–' + dsh(b) : dsh(a) + ' – ' + dsh(b);
}
function thd(h, sub) {
  return h + '<span class="thsub">' + sub + '</span>';
}
function zf(v) {
  return v ? fmt(v) : '<span class="muted">—</span>';
}
function flowChart(rows) {
  let mx = Math.max(0, ...rows.map(r => Math.max(r.m.in, r.m.out))),
    bar = (r, k, lab) => {
      let v = r.m[k],
        q = mx > 0 ? v / mx : 0;
      return (
        '<div class="fbar">' +
        (v > 0
          ? '<span class="fb ' +
            k +
            '" style="width:max(3px,calc((100% - 64px) * ' +
            q.toFixed(4) +
            '))" tabindex="0" aria-label="' +
            esc(r.ty.name) +
            ' ' +
            lab +
            ' ' +
            fmt(v) +
            ' กก." data-tip="' +
            esc(lab + '|' + r.ty.name + '|' + fmt(v)) +
            '"></span>'
          : '<span class="fb none"></span>') +
        '<span class="fv">' +
        (v > 0 ? fmt(v) : '—') +
        '</span></div>'
      );
    };
  return (
    '<div class="flow" onpointermove="App.flowTip(event)" onpointerleave="App.flowTip()" onfocusin="App.flowTip(event)" onfocusout="App.flowTip()"><div class="flowhead"><h3>รับฝากเทียบกับขายออก (กก.)</h3><div class="legend"><span><i class="fk in"></i>รับฝาก</span><span><i class="fk out"></i>ขายออก</span></div></div>' +
    rows
      .map(
        r =>
          '<div class="frow' +
          (r.m.in || r.m.out || r.close ? '' : ' fdim') +
          '"><div class="fname">' +
          tchip(r.ty.id) +
          '</div><div class="fbars">' +
          bar(r, 'in', 'รับฝาก') +
          bar(r, 'out', 'ขายออก') +
          '</div><div class="fclose"><small>คงเหลือ</small><b>' +
          fmt(r.close) +
          '</b></div></div>',
      )
      .join('') +
    '<div id="ftip" class="phtip" hidden></div></div>'
  );
}
function flowTip(e) {
  let tip = $('ftip'),
    b = e?.target?.closest?.('.fb[data-tip]');
  if (!tip) return;
  if (!b) {
    tip.hidden = true;
    return;
  }
  let [lab, name, v] = b.dataset.tip.split('|'),
    r = b.getBoundingClientRect(),
    c = b.closest('.flow').getBoundingClientRect(),
    x = document.createElement('b'),
    y = document.createElement('small');
  x.textContent = v + ' กก.';
  y.textContent = lab + ' · ' + name;
  tip.replaceChildren(x, y);
  tip.hidden = false;
  tip.style.right = '';
  tip.style.left = Math.min(r.right - c.left + 10, c.width - 150) + 'px';
  tip.style.top = r.top - c.top + r.height / 2 - 28 + 'px';
}
// The ± แก้ยอด column is the fifth one in every row this screen builds, on screen and in the CSV.
const noAdj = a => adjCol(a, 4);
function render() {
  let f = per.report.from,
    t = per.report.to,
    rows = reportRows(),
    inR = r => r.date >= f && r.date <= t,
    dep = active().filter(inR),
    ss = sold().filter(inR),
    L = lines().filter(inR),
    tot = fn => round(rows.reduce((s, r) => s + fn(r), 0)),
    months = [];
  for (let m = f.slice(0, 7); m <= t.slice(0, 7);) {
    months.push(m);
    let [y, mo] = m.split('-').map(Number);
    m = mo === 12 ? y + 1 + '-01' : y + '-' + String(mo + 1).padStart(2, '0');
  }
  let srcs = [...new Set(dep.map(r => r.source))]
      .map(id => ({
        id,
        n: dep.filter(r => r.source === id).length,
        w: sum(
          dep.filter(r => r.source === id),
          'weight',
        ),
      }))
      .sort((a, b) => b.w - a.w),
    depW = sum(dep, 'weight');
  return (
    printHead('รายงานธนาคารขยะ', date(f) + ' – ' + date(t)) +
    heading(
      'รายงาน',
      esc(db.school) + ' • ช่วง ' + date(f) + ' – ' + date(t),
      '<button onclick="window.print()">พิมพ์รายงาน</button><button onclick="App.exportReport()">ส่งออก CSV</button>',
    ) +
    '<div class="toolbar"><div class="perbar">' +
    perBar('report') +
    '</div></div>' +
    stats([
      [
        'รับฝากในช่วง',
        fmt(depW, 1),
        'กก.',
        // Slips, not item rows: the card beside it counts ใบขาย, the first screen counts ใบรับฝาก, and a slip is
        // what a teacher would go and open. One deposit slip can carry six types, so counting รายการ counted
        // the rows behind the weight and read as several times the work that was actually done.
        'จาก <a href="#" class="drill" onclick="App.drill(\'deposit\');return false">' +
          new Set(dep.map(r => r.no || r.id)).size +
          ' ใบรับฝาก</a>',
      ],
      [
        'ขายในช่วง (ร้านชั่ง)',
        fmt(
          tot(r => r.m.buyer),
          1,
        ),
        'กก.',
        'จาก <a href="#" class="drill" onclick="App.drill(\'sell\');return false">' + ss.length + ' ใบขาย</a>',
      ],
      [
        'รายรับจากการขาย',
        fmt(sum(ss, 'total')),
        'บาท',
        'น้ำหนักต่างกัน ' + signed(tot(r => r.m.buyer - r.m.out)) + ' กก.',
      ],
      [
        'มูลค่าคงคลังปลายงวด',
        fmt(tot(r => r.val)),
        'บาท',
        'คงเหลือ ' +
          fmt(
            tot(r => r.close),
            1,
          ) +
          ' กก. × ราคาอ้างอิง',
      ],
    ]) +
    '<section class="panel"><div class="panelhead"><h2>ความเคลื่อนไหวตามประเภทขยะ</h2><small class="muted">' +
    date(f) +
    ' – ' +
    date(t) +
    '</small></div>' +
    flowChart(rows) +
    '<div class="flowtable">' +
    table(
      noAdj([
        'ประเภท',
        thd('ยกมา', 'ณ ' + dsh(shiftDay(f, -1))),
        thd('+ รับฝาก', drng(f, t)),
        thd('− ขายออก', drng(f, t)),
        thd('± แก้ยอด', drng(f, t)),
        thd('= คงเหลือ', 'ณ ' + (t >= today ? 'วันนี้ ' + dsh(today) : dsh(t))),
        thd('รายรับ (บาท)', drng(f, t)),
        thd('มูลค่าคงเหลือ (บาท)', 'ณ ' + (t >= today ? 'วันนี้ ' + dsh(today) : dsh(t))),
      ]),
      [
        ...rows.map(r =>
          row(
            noAdj([
              tchip(r.ty.id),
              zf(r.open),
              zf(r.m.in),
              zf(r.m.out),
              r.m.adj ? signed(r.m.adj) : zf(0),
              '<b>' + fmt(r.close) + '</b>',
              zf(r.m.money),
              zf(r.val),
            ]),
          ),
        ),
        row(
          noAdj([
            '<b>รวม</b>',
            '<b>' + fmt(tot(r => r.open)) + '</b>',
            '<b>' + fmt(tot(r => r.m.in)) + '</b>',
            '<b>' + fmt(tot(r => r.m.out)) + '</b>',
            '<b>' + signed(tot(r => r.m.adj)) + '</b>',
            '<b>' + fmt(tot(r => r.close)) + '</b>',
            '<b>' + fmt(tot(r => r.m.money)) + '</b>',
            '<b>' + fmt(tot(r => r.val)) + '</b>',
          ]),
        ),
      ],
    ) +
    '</div><p><small>น้ำหนักเป็นกิโลกรัม • คงเหลือ = ยกมา + รับฝาก − ขายออก' +
    (adjusted().length ? ' ± แก้ยอด' : '') +
    ' • ขายออกนับตามตาชั่งของโรงเรียน น้ำหนักที่ร้านชั่งดูได้ใน “ใบขายในช่วง” • มูลค่าคงเหลือใช้ราคาอ้างอิง ณ ' +
    date(t) +
    '</small></p></section>' +
    '<section class="panel"><div class="panelhead"><h2>ราคาอ้างอิงและประวัติราคา</h2><small class="muted">ราคาที่ใช้ประเมินมูลค่า · ปรับราคาได้ที่หน้าตั้งค่า</small></div>' +
    priceTable() +
    '</section>' +
    '<div class="cols"><section class="panel"><h2>สรุปรายเดือน</h2>' +
    ptable(
      'report_month',
      ['เดือน', 'รับฝาก (กก.)', 'ขาย-รร.ชั่ง (กก.)', 'ร้านชั่ง (กก.)', 'รายรับ (บาท)'],
      months.map(m => {
        let inM = r => r.date.startsWith(m),
          lm = L.filter(inM);
        return {
          k: { 0: m },
          c: [
            new Date(m + '-01T00:00:00').toLocaleDateString(TH, { month: 'long', year: 'numeric' }),
            fmt(sum(dep.filter(inM), 'weight')),
            fmt(sum(lm, 'stockWeight')),
            fmt(sum(lm, 'buyerWeight')),
            fmt(sum(lm, 'total')),
          ],
        };
      }),
    ) +
    '</section><section class="panel"><h2>แหล่งที่มาของขยะ</h2>' +
    ptable(
      'report_source',
      ['แหล่งที่มา', 'ครั้ง', 'น้ำหนัก (กก.)', 'สัดส่วน'],
      srcs.map(s => ({ c: [schip(s.id), s.n, fmt(s.w), fmt(depW ? (s.w / depW) * 100 : 0, 1) + '%'] })),
    ) +
    '</section></div>' +
    '<section class="panel"><h2>ใบขายในช่วง</h2>' +
    ptable(
      'report_sale',
      ['เลขที่', 'วันที่', 'ผู้รับซื้อ', 'รร.ชั่ง (กก.)', 'ร้านชั่ง (กก.)', 'ต่างกัน (กก.)', 'รายรับ (บาท)'],
      ss.map(s => {
        let sw = sum(s.items, 'stockWeight'),
          bw = sum(s.items, 'buyerWeight');
        return {
          k: { 1: s.date },
          c: [esc(s.no), date(s.date), esc(s.buyer), fmt(sw), fmt(bw), varCell(sw, bw), fmt(s.total)],
        };
      }),
      [2],
    ) +
    '</section>' +
    printFoot()
  );
}
// ---- ราคาอ้างอิงและประวัติราคา -----------------------------------------------------------------
// The price side of the records, where the records are read rather than where they are set: ตั้งค่า holds the price
// a type is valued at today, and this is the question "what has it been, and when did it change?". A viewer has it
// too, because nothing here writes anything.
function priceTable() {
  return ptable(
    'report_price',
    ['ประเภท', thd('ราคาอ้างอิง (บาท/กก.)', 'ณ ' + dsh(per.report.to)), 'เริ่มใช้เมื่อ', 'ปรับมาแล้ว', 'ประวัติราคา'],
    db.types.map(t => {
      const P = pricesOf(t),
        last = P[P.length - 1];
      return {
        k: { 2: last ? last.from : '', 4: null },
        c: [
          tchip(t.id),
          fmt(refPrice(t, per.report.to)),
          last ? date(last.from) : '<span class="muted">ยังไม่ตั้งราคา</span>',
          P.length > 1 ? P.length - 1 + ' ครั้ง' : '<span class="muted">—</span>',
          spark(t) || '<span class="muted">—</span>',
        ],
      };
    }),
  );
}
function niceStep(v) {
  if (!(v > 0)) return 1;
  let e = 10 ** Math.floor(Math.log10(v)),
    f = v / e;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e;
}
let ph = null;
function pricesOf(t) {
  return (t.prices || []).slice().sort((a, b) => a.from.localeCompare(b.from));
}
function priceSpan(P) {
  let day = d => new Date(d + 'T00:00:00').getTime();
  return {
    day,
    x0: Math.min(day(P[0].from), day(today) - 30 * 864e5),
    x1: Math.max(day(today), day(P[P.length - 1].from)),
  };
}
function spark(t) {
  let P = pricesOf(t);
  if (!P.length) return '';
  let W = 112,
    H = 30,
    p = 6,
    { day, x0, x1 } = priceSpan(P),
    lo = Math.min(...P.map(q => q.price)),
    hi = Math.max(...P.map(q => q.price)),
    X = v => +(p + ((v - x0) / (x1 - x0)) * (W - 2 * p)).toFixed(1),
    Y = v => +(hi === lo ? H / 2 : p + (1 - (v - lo) / (hi - lo)) * (H - 2 * p)).toFixed(1),
    pts = P.map(q => [X(day(q.from)), Y(q.price)]),
    d =
      'M' +
      pts[0][0] +
      ' ' +
      pts[0][1] +
      pts
        .slice(1)
        .map(q => 'H' + q[0] + 'V' + q[1])
        .join('') +
      'H' +
      X(x1),
    c = esc(t.color),
    last = P[P.length - 1],
    prev = P[P.length - 2];
  return (
    '<button type="button" class="sparkbtn" data-act="priceModal" data-arg="' +
    esc(t.id) +
    '" aria-label="ดูประวัติราคา ' +
    esc(t.name) +
    '"><svg width="' +
    W +
    '" height="' +
    H +
    '" viewBox="0 0 ' +
    W +
    ' ' +
    H +
    '" aria-hidden="true"><path d="' +
    d +
    '" fill="none" stroke="' +
    c +
    '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="' +
    X(x1) +
    '" cy="' +
    Y(last.price) +
    '" r="3.5" fill="' +
    c +
    '" stroke="#fff" stroke-width="2"/></svg><small>' +
    (prev
      ? 'ปรับ ' +
        (P.length - 1) +
        ' ครั้ง' +
        (prev.price
          ? '<br>ล่าสุด ' +
            (last.price >= prev.price ? '+' : '') +
            fmt(((last.price - prev.price) / prev.price) * 100, 0) +
            '%'
          : '')
      : 'ยังไม่เคยปรับ') +
    '</small></button>'
  );
}
// The price history of one type: the chart, then every entry as a table, newest first. The name and the line
// about reading the chart are the dialog's own header (ui.js detail()), not the first two lines of the body, so
// the dialog cannot be left wearing the title of whatever was opened before it.
// A school that has run for years has a price for every term: five rows a page here, not the ten a register
// uses, because the dialog also carries the chart and a sheet that has to be scrolled to reach its own pager is
// a sheet that hides it. Same pager otherwise (lib/table.js), minus the size picker, which has no five to
// offer. The rows that are not on the page are hidden rather than left out, so พิมพ์ still puts the whole
// history on paper (tr.pgoff in style.css).
const PHSIZE = 5;
let phId = null; // the type the dialog is open on, so the pager knows what to redraw
function priceRows(t, P) {
  let st = (pg.price ??= { size: PHSIZE, page: 1 }),
    rows = P.map((p, i) =>
      row([
        date(p.from) + (i === P.length - 1 ? ' <span class="badge ok">ใช้อยู่</span>' : ''),
        fmt(p.price),
        i
          ? signed(p.price - P[i - 1].price) +
            (P[i - 1].price
              ? ' <small>(' +
                (p.price >= P[i - 1].price ? '+' : '') +
                fmt(((p.price - P[i - 1].price) / P[i - 1].price) * 100, 1) +
                '%)</small>'
              : '')
          : '<span class="muted">ราคาแรก</span>',
      ]),
    ).reverse(),
    pages = Math.max(1, Math.ceil(rows.length / st.size));
  if (st.page > pages) st.page = pages;
  let a = (st.page - 1) * st.size,
    b = Math.min(a + st.size, rows.length);
  return (
    table(
      ['เริ่มใช้', 'ราคา (บาท/กก.)', 'เปลี่ยนแปลง'],
      rows.map((r, x) => (x < a || x >= b ? r.replace('<tr>', '<tr class="pgoff">') : r)),
    ) + (rows.length > st.size ? pager('price', st, pages, rows.length, a, b, false) : '')
  );
}
function priceModal(id) {
  let t = type(id),
    P = pricesOf(t);
  if (id !== phId) {
    phId = id;
    (pg.price ??= { size: PHSIZE, page: 1 }).page = 1; // another type's history opens on its first page
  }
  detail(P.length ? priceSvg(t, P) + priceRows(t, P) : '<p>ยังไม่ได้ตั้งราคาอ้างอิง</p>', {
    title: 'ประวัติราคาอ้างอิง · ' + t.name,
    sub: 'ชี้หรือแตะที่กราฟเพื่อดูราคา ณ วันนั้น • ปรับราคาได้ที่หน้าตั้งค่า',
  });
}
// Turning the page redraws the dialog, not the screen behind it (lib/table.js pgRefresh), so the chart does not
// flicker and the report keeps its own scroll position.
registerList('price', () => phId && priceModal(phId));
function priceSvg(t, P) {
  let W = Math.round(Math.min(564, Math.max(280, (window.innerWidth || 900) - 90))),
    H = 220,
    L = 44,
    Rm = 66,
    T = 14,
    B = 30,
    { day, x0, x1 } = priceSpan(P),
    mx = Math.max(0, ...P.map(p => p.price)),
    st = niceStep(mx / 4 || 1),
    ym = st * Math.max(1, Math.ceil((mx * 1.15) / st)),
    X = v => +(L + ((v - x0) / (x1 - x0)) * (W - L - Rm)).toFixed(1),
    Y = v => +(T + (1 - v / ym) * (H - T - B)).toFixed(1),
    pts = P.map(p => [X(day(p.from)), Y(p.price)]),
    line =
      'M' +
      pts[0][0] +
      ' ' +
      pts[0][1] +
      pts
        .slice(1)
        .map(q => 'H' + q[0] + 'V' + q[1])
        .join('') +
      'H' +
      X(x1),
    area = line + 'V' + Y(0) + 'H' + pts[0][0] + 'Z',
    g = '',
    xt = '',
    c = esc(t.color),
    lp = P[P.length - 1];
  for (let v = 0; v <= ym + 1e-9; v += st)
    g +=
      '<line x1="' +
      L +
      '" x2="' +
      (W - Rm) +
      '" y1="' +
      Y(v) +
      '" y2="' +
      Y(v) +
      '" class="ph-grid"/><text x="' +
      (L - 8) +
      '" y="' +
      (Y(v) + 4) +
      '" text-anchor="end" class="ph-axis">' +
      fmt(v, v % 1 ? 2 : 0) +
      '</text>';
  for (let i = 0; i < 4; i++) {
    let v = x0 + ((x1 - x0) * i) / 3;
    xt +=
      '<text x="' +
      X(v) +
      '" y="' +
      (H - 8) +
      '" text-anchor="' +
      (i === 0 ? 'start' : i === 3 ? 'end' : 'middle') +
      '" class="ph-axis">' +
      new Date(v).toLocaleDateString(TH, { month: 'short', year: '2-digit' }) +
      '</text>';
  }
  ph = { P, x0, x1, L, Rm, W, X, day };
  return (
    // width and height as ATTRIBUTES, not only a viewBox: the stylesheet overrides both on screen
    // (.phwrap svg), but on paper they are the intrinsic size the chart falls back to. Without them Chrome
    // lays an `height: auto` inline SVG out at no height at all when printing, and the dialog comes out of
    // the printer with the table and a blank space where the chart was.
    '<div class="phwrap"><svg width="' +
    W +
    '" height="' +
    H +
    '" viewBox="0 0 ' +
    W +
    ' ' +
    H +
    '" role="img" aria-label="กราฟราคาอ้างอิง ' +
    esc(t.name) +
    ' ปัจจุบัน ' +
    fmt(lp.price) +
    ' บาท/กก. ปรับ ' +
    (P.length - 1) +
    ' ครั้ง" onpointermove="App.priceHover(event)" onpointerleave="App.priceHide()">' +
    g +
    '<path d="' +
    area +
    '" fill="' +
    c +
    '" fill-opacity=".1"/><path d="' +
    line +
    '" fill="none" stroke="' +
    c +
    '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><line id="phx" class="ph-x" x1="0" x2="0" y1="' +
    T +
    '" y2="' +
    Y(0) +
    '" visibility="hidden"/>' +
    pts
      .map(
        (q, i) =>
          '<circle cx="' +
          q[0] +
          '" cy="' +
          q[1] +
          '" r="5" fill="' +
          c +
          '" stroke="#fff" stroke-width="2" tabindex="0" aria-label="' +
          date(P[i].from) +
          ' ' +
          fmt(P[i].price) +
          ' บาท/กก." onfocus="App.priceAt(' +
          i +
          ')" onblur="App.priceHide()"/>',
      )
      .join('') +
    '<text x="' +
    (X(x1) + 8) +
    '" y="' +
    (Y(lp.price) + 4) +
    '" class="ph-end">' +
    fmt(lp.price) +
    ' ฿</text>' +
    xt +
    '</svg><div id="phtip" class="phtip" hidden></div></div>'
  );
}
function priceHover(e) {
  if (!ph) return;
  let r = e.currentTarget.getBoundingClientRect(),
    vx = ((e.clientX - r.left) / r.width) * ph.W,
    tm = ph.x0 + ((vx - ph.L) / (ph.W - ph.L - ph.Rm)) * (ph.x1 - ph.x0),
    i = -1;
  if (tm < ph.x0 || tm > ph.x1) return priceHide();
  ph.P.forEach((p, j) => {
    if (ph.day(p.from) <= tm) i = j;
  });
  if (i < 0) return priceHide();
  priceTip(vx, tm, i, r);
}
function priceAt(i) {
  let s = document.querySelector('#detailbody svg');
  if (s && ph) priceTip(ph.X(ph.day(ph.P[i].from)), ph.day(ph.P[i].from), i, s.getBoundingClientRect());
}
function priceTip(vx, tm, i, r) {
  let x = $('phx'),
    tip = $('phtip'),
    p = ph.P[i],
    b = document.createElement('b'),
    d = document.createElement('div'),
    m = document.createElement('small'),
    px = (vx / ph.W) * r.width;
  x.setAttribute('x1', vx);
  x.setAttribute('x2', vx);
  x.setAttribute('visibility', 'visible');
  b.textContent = fmt(p.price) + ' บาท/กก.';
  d.textContent = new Date(tm).toLocaleDateString(TH, { day: 'numeric', month: 'short', year: 'numeric' });
  m.textContent = 'ใช้ตั้งแต่ ' + date(p.from);
  tip.replaceChildren(b, d, m);
  tip.hidden = false;
  let flip = px > r.width / 2;
  tip.style.left = flip ? '' : px + 12 + 'px';
  tip.style.right = flip ? r.width - px + 12 + 'px' : '';
}
function priceHide() {
  let x = $('phx'),
    t = $('phtip');
  if (x?.setAttribute) x.setAttribute('visibility', 'hidden');
  if (t) t.hidden = true;
}
function exportReport() {
  csv(
    'report_' + be(per.report.from) + '_' + be(per.report.to) + '.csv',
    noAdj([
      'ประเภท',
      'ยกมากก.',
      'รับฝากกก.',
      'ขายรร.ชั่งกก.',
      'แก้ยอดชั่งจริงกก.',
      'คงเหลือยกไปกก.',
      'ร้านชั่งกก.',
      'ต่างกันกก.',
      'รายรับบาท',
      'ราคาอ้างอิง',
      'มูลค่าคงเหลือบาท',
    ]),
    reportRows().map(r =>
      noAdj([
        r.ty.name,
        r.open,
        r.m.in,
        r.m.out,
        r.m.adj,
        r.close,
        r.m.buyer,
        round(r.m.buyer - r.m.out),
        r.m.money,
        r.p,
        r.val,
      ]),
    ),
  );
}
const handlers = { drill, exportReport, flowTip, priceAt, priceHide, priceHover, priceModal };
export { render, handlers };
App.registerPage('report', { render, handlers });
