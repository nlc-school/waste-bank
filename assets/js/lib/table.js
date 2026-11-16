'use strict';
// The list machinery every register shares: the table renderer with its per-column filters, sorting and paging, the
// period bar, and the state they own (per, pg). It draws strings and never touches the data: callers hand it
// rows. What it needs from the app comes in through configure() once, at start-up: the db to read the years from,
// today, how to redraw the page, and how to save the preferences.
// The handlers in the strings it emits (App.setFilt, App.setPg, ...) are registered on App by app.js.
import { esc } from './fmt.js';
const byId = id => document.getElementById(id);
const host = { db: null, today: '', render() {}, beHints() {} };
export function configure(o) {
  Object.assign(host, o);
}
// A register that redraws only its own list (not the whole page) registers a refresher under its key.
const lists = {};
export function registerList(key, fn) {
  lists[key] = fn;
}
export function listRefresh(k) {
  if (lists[k]) lists[k]();
}
export const per = {};
function table(head, rows) {
  return (
    '<div class="tablewrap"><table><thead><tr>' +
    head.map(x => '<th>' + x + '</th>').join('') +
    '</tr></thead><tbody>' +
    (rows.length ? rows.join('') : '<tr><td class="empty" colspan="' + head.length + '">ยังไม่มีรายการ</td></tr>') +
    '</tbody></table></div>'
  );
}
// `head` is optional and only the registers pass it: with it every cell carries its column name in data-l, which
// is what a narrow screen puts in front of the value when the row is drawn as a card (.cardtbl in style.css).
function row(a, head) {
  return (
    '<tr>' +
    a
      .map((x, i) => '<td' + (head ? ' data-l="' + esc(cellText(head[i] ?? '')) + '"' : '') + '>' + x + '</td>')
      .join('') +
    '</tr>'
  );
}
const MONTHS = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
];
function monthPer(d) {
  let y = +d.slice(0, 4),
    m = +d.slice(5, 7);
  return { from: d.slice(0, 8) + '01', to: d.slice(0, 8) + String(new Date(y, m, 0).getDate()).padStart(2, '0') };
}
function yearPer(d) {
  return { from: d.slice(0, 4) + '-01-01', to: d.slice(0, 4) + '-12-31' };
}
function perKind(p) {
  let y = p.from.slice(0, 4),
    mp = monthPer(p.from);
  if (p.from === y + '-01-01' && p.to === y + '-12-31') return 'all';
  if (p.from === mp.from && p.to === mp.to) return p.from.slice(5, 7);
  return 'custom';
}
function inPer(k) {
  let p = per[k];
  return r => r.date >= p.from && r.date <= p.to;
}
function perBar(k) {
  let p = per[k],
    y = +p.from.slice(0, 4),
    kind = perKind(p),
    ys = [...host.db.deposits, ...host.db.sales, ...host.db.adjustments]
      .map(r => +String(r.date).slice(0, 4))
      .filter(Boolean),
    lo = Math.min(y, +host.today.slice(0, 4), ...ys),
    hi = Math.max(y, +host.today.slice(0, 4), ...ys),
    yo = '',
    ch = (f, v) => ' onchange="App.setPer(\'' + k + "','" + f + '\',this.value)"';
  for (let i = hi; i >= lo; i--)
    yo += '<option value="' + i + '"' + (i === y ? ' selected' : '') + '>พ.ศ. ' + (i + 543) + '</option>';
  return (
    '<select aria-label="ปี"' +
    ch('year') +
    '>' +
    yo +
    '</select><select aria-label="เดือน"' +
    ch('month') +
    '><option value="all"' +
    (kind === 'all' ? ' selected' : '') +
    '>ทั้งปี</option>' +
    MONTHS.map((n, i) => {
      let v = String(i + 1).padStart(2, '0');
      return '<option value="' + v + '"' + (kind === v ? ' selected' : '') + '>' + n + '</option>';
    }).join('') +
    (kind === 'custom' ? '<option value="custom" selected disabled>ช่วงที่กำหนดเอง</option>' : '') +
    // Each date box is wrapped on its own, so app.js can put the Buddhist-year caption under it rather than
    // beside it: this bar is one row, and a caption as a sibling would sit in the row like another control.
    '</select><span class="perlabel">หรือช่วงวันที่</span><span class="datefield"><input type="date" aria-label="ตั้งแต่วันที่" value="' +
    p.from +
    '"' +
    ch('from') +
    '></span><span class="sep">–</span><span class="datefield"><input type="date" aria-label="ถึงวันที่" value="' +
    p.to +
    '"' +
    ch('to') +
    '></span>'
  );
}
const PGSIZES = [10, 25, 50, 100];
// Every list starts at ten rows on the first page. The chosen size lives as long as the visit does and is not
// written anywhere: a register that reopens on page 4 of 100 rows is a register nobody asked for.
let pg = {};
const NUMRE = /^[−+-]?\d[\d,]*(\.\d+)?/;
function cellText(h) {
  return String(h)
    .replace(/<br\s*\/?>/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(
      /&(amp|lt|gt|quot|#39);/g,
      m => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" })[m],
    )
    .replace(/\s+/g, ' ')
    .trim();
}
function numOf(t) {
  let m = NUMRE.exec(t);
  return m ? +m[0].replace(/,/g, '').replace('−', '-') : NaN;
}
function fmatch(q, t, n, exact) {
  if (exact) return t === q;
  let m = /^(>=|<=|>|<|=)\s*(-?[\d,]*\.?\d+)$/.exec(q.trim());
  if (m && !isNaN(n)) {
    let v = +m[2].replace(/,/g, '');
    return { '>': n > v, '<': n < v, '>=': n >= v, '<=': n <= v, '=': n === v }[m[1]];
  }
  return t.toLowerCase().includes(q.trim().toLowerCase());
}
// The sort arrow belongs to the column's NAME, so it goes straight after it - not after the caption some
// headers carry under the name (report.js thd(), e.g. "ราคาอ้างอิง (บาท/กก.)" over "ณ 7 พ.ย. 69"), where it
// would read as an arrow on the date and sit on a line of its own.
const SUB = '<span class="thsub">';
function withArrow(h, arrow) {
  return h.includes(SUB) ? h.replace(SUB, arrow + SUB) : h + arrow;
}
function ptable(key, head, items, sel = []) {
  let st = (pg[key] ??= { size: 10, page: 1 });
  st.f ??= {};
  if (!items.length) return table(head, []);
  let T = items.map(r => r.c.map(cellText)),
    num = head.map((_, i) => T.every(t => t[i] === '' || NUMRE.test(t[i])) && T.some(t => t[i] !== '')),
    off = head.map((_, i) => items.some(r => r.k?.[i] === null)),
    val = (j, i) => {
      let k = items[j].k?.[i];
      return k !== undefined ? k : num[i] ? numOf(T[j][i]) : T[j][i];
    },
    ids = items
      .map((_, j) => j)
      .filter(j =>
        Object.entries(st.f).every(([i, q]) =>
          sel.includes(+i)
            ? (items[j].f?.[i] ?? [T[j][i]]).includes(q)
            : fmatch(q, T[j][i], num[i] ? numOf(T[j][i]) : NaN, false),
        ),
      );
  if (st.sort) {
    let { i, d } = st.sort;
    ids.sort((x, y) => {
      let a = val(x, i),
        b = val(y, i);
      return (
        (typeof a === 'number' && typeof b === 'number'
          ? (a || 0) - (b || 0)
          : String(a).localeCompare(String(b), 'th')) * d
      );
    });
  }
  let n = ids.length,
    pages = Math.max(1, Math.ceil(n / st.size));
  if (st.page > pages) st.page = pages;
  let a = (st.page - 1) * st.size,
    b = Math.min(a + st.size, n),
    sh = i => (st.sort?.i === i ? st.sort.d : 0),
    th = head
      .map((h, i) =>
        off[i]
          ? '<th>' + h + '</th>'
          : '<th id="s_' +
            key +
            '_' +
            i +
            '" class="sortable" tabindex="0" aria-sort="' +
            (sh(i) > 0 ? 'ascending' : sh(i) < 0 ? 'descending' : 'none') +
            '" onclick="App.setSort(\'' +
            key +
            "'," +
            i +
            ')" onkeydown="if(event.key===\'Enter\')this.click()">' +
            withArrow(h, '<span class="sarrow">' + (sh(i) > 0 ? '▲' : sh(i) < 0 ? '▼' : '↕') + '</span>') +
            '</th>',
      )
      .join(''),
    fr = head
      .map((h, i) => {
        if (off[i]) return '<th></th>';
        let id = 'f_' + key + '_' + i,
          v = st.f[i] ?? '',
          lab = ' aria-label="กรอง ' + cellText(h) + '"';
        if (sel.includes(i))
          return (
            '<th><select id="' +
            id +
            '"' +
            lab +
            ' onchange="App.setFilt(\'' +
            key +
            "'," +
            i +
            ',this.value)"><option value="">ทั้งหมด</option>' +
            [...new Set(items.flatMap((r, j) => r.f?.[i] ?? [T[j][i]]))]
              .sort((x, y) => x.localeCompare(y, 'th'))
              .map(o => '<option' + (o === v ? ' selected' : '') + '>' + esc(o) + '</option>')
              .join('') +
            '</select></th>'
          );
        return (
          '<th><input id="' +
          id +
          '"' +
          lab +
          ' value="' +
          esc(v) +
          '" placeholder="' +
          (num[i] ? 'เช่น >5' : 'ค้นหา') +
          '" oninput="if(!event.isComposing)App.setFilt(\'' +
          key +
          "'," +
          i +
          ',this.value,1)" oncompositionend="App.setFilt(\'' +
          key +
          "'," +
          i +
          ',this.value,1)"></th>'
        );
      })
      .join(''),
    body = n
      ? ids
          .map((j, x) => {
            let h = row(items[j].c, head);
            return x < a || x >= b ? h.replace('<tr>', '<tr class="pgoff">') : h;
          })
          .join('')
      : '<tr><td class="empty" colspan="' + head.length + '">ไม่พบรายการตามตัวกรอง</td></tr>';
  st.hasF = Object.keys(st.f).length > 0;
  st.total = items.length;
  return (
    '<div class="tablewrap cardtbl"><table><thead><tr>' +
    th +
    '</tr><tr class="filt">' +
    fr +
    '</tr></thead><tbody>' +
    body +
    '</tbody></table></div>' +
    (n > PGSIZES[0] || st.hasF || key === 'deposit' || key === 'sell' || key === 'report_sale' || key === 'audit'
      ? pager(key, st, pages, n, a, b)
      : '')
  );
}
let ftimer;
function setFilt(key, i, v, wait) {
  clearTimeout(ftimer);
  let go = () => {
    let st = pg[key];
    if (v.trim()) st.f[i] = v;
    else delete st.f[i];
    st.page = 1;
    pgRefresh(key);
  };
  if (wait) ftimer = setTimeout(go, 250);
  else go();
}
function clearFilt(key) {
  pg[key].f = {};
  pg[key].page = 1;
  pgRefresh(key);
}
function setSort(key, i) {
  let st = pg[key],
    o = st.sort;
  st.sort = !o || o.i !== i ? { i, d: 1 } : o.d > 0 ? { i, d: -1 } : null;
  st.page = 1;
  pgRefresh(key);
}
function pgRefresh(key) {
  let el = document.activeElement,
    id = el?.id,
    pos = el?.selectionStart;
  if (lists[key]) listRefresh(key);
  else host.render();
  let e = id && byId(id);
  if (e?.focus) {
    e.focus();
    if (pos != null)
      try {
        e.setSelectionRange(pos, pos);
      } catch {}
  }
}
// `sizes` false drops the แสดง … แถว/หน้า picker and keeps the rest. One list uses it: the price history inside
// the detail dialog, whose page is five rows because the sheet is a sheet, not a register, and PGSIZES does not
// offer five. A select that cannot show the size in force is worse than no select.
function pager(key, st, pages, n, a, b, sizes = true) {
  let go = p => ' onclick="App.setPg(\'' + key + "','page'," + p + ')"',
    lo = Math.max(1, Math.min(st.page - 2, pages - 4)),
    nums = '';
  for (let p = lo; p <= Math.min(pages, lo + 4); p++)
    nums +=
      '<button type="button" class="minibtn' +
      (p === st.page ? ' on" aria-current="page"' : '"') +
      go(p) +
      '>' +
      p +
      '</button>';
  return (
    '<div class="pager">' +
    (sizes
      ? '<label>แสดง <select onchange="App.setPg(\'' +
        key +
        "','size',+this.value)\">" +
        PGSIZES.map(x => '<option' + (x === st.size ? ' selected' : '') + '>' + x + '</option>').join('') +
        '</select> แถว/หน้า</label>'
      : '') +
    '<span class="pginfo">' +
    (n ? a + 1 + '–' + b : 0) +
    ' จาก ' +
    n +
    ' รายการ' +
    (st.hasF
      ? ' (กรองจาก ' +
        st.total +
        ') <button type="button" class="minibtn" onclick="App.clearFilt(\'' +
        key +
        '\')">ล้างตัวกรอง</button>'
      : '') +
    '</span><div class="pgnav"><button type="button" class="minibtn" aria-label="หน้าก่อนหน้า"' +
    (st.page > 1 ? go(st.page - 1) : ' disabled') +
    '>‹</button>' +
    nums +
    '<button type="button" class="minibtn" aria-label="หน้าถัดไป"' +
    (st.page < pages ? go(st.page + 1) : ' disabled') +
    '>›</button></div></div>'
  );
}
function setPg(key, f, v) {
  let st = pg[key];
  if (f === 'size') {
    st.size = v;
    st.page = 1;
  } else st.page = v;
  pgRefresh(key);
}
function pgReset(k) {
  Object.keys(pg).forEach(x => {
    if (x.startsWith(k)) pg[x].page = 1;
  });
}
function setPer(k, f, v) {
  if (!v) return;
  pgReset(k);
  let p = per[k],
    kind = perKind(p),
    whole = kind === 'all' || kind === 'custom';
  if (f === 'year') per[k] = whole ? yearPer(v + '-01-01') : monthPer(v + '-' + kind + '-01');
  else if (f === 'month') per[k] = v === 'all' ? yearPer(p.from) : monthPer(p.from.slice(0, 5) + v + '-01');
  else {
    p[f] = v;
    if (p.from > p.to) [p.from, p.to] = [p.to, p.from];
  }
  if (k === 'report') return host.render();
  byId('pb_' + k).innerHTML = perBar(k);
  host.beHints(); // the bar was replaced: its date boxes need their Buddhist-year captions back
  listRefresh(k);
}

export {
  table,
  row,
  ptable,
  pager,
  setFilt,
  clearFilt,
  setSort,
  setPg,
  pgReset,
  setPer,
  perBar,
  perKind,
  monthPer,
  yearPer,
  inPer,
  pg,
  cellText,
  numOf,
  fmatch,
  MONTHS,
  PGSIZES,
};
