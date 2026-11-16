'use strict';
// What the shell and every page share: the db, the stock functions bound to it, the constants, the small markup
// helpers, and the UI state that used to be loose variables of the one big file (S). The state is ONE object that is
// only ever mutated, so every module sees the same page, draft and last-used values.
import { esc, fmt, round, today as todayNow } from './lib/fmt.js';
import { makeStock } from './lib/stock.js';
import * as Store from './store.js';
import { per, monthPer, yearPer } from './lib/table.js';

export const db = Store.db;
export const today = todayNow(),
  $ = id => document.getElementById(id),
  TH = 'th-TH-u-ca-buddhist';
export const COLORS = ['#0B7A55', '#3F78A8', '#C99A45', '#8C9692', '#7A4FB0', '#54866D'],
  SRCCOLORS = ['#2F6F9F', '#B5653A', '#6A5ACD', '#2E8B8B', '#A04A6B', '#7D8B2E', '#C27C0E', '#5B6B7A'];
export const { active, sold, adjusted, lines, moved, stockAt, stock, refPrice, type, source } = makeStock(() => db);
const ICONS = {
  stock: '<path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M12 11v10"/>',
  deposit: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  sell: '<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  report: '<path d="M4 20V11M10 20V5M16 20v-6M21 20H3"/>',
  settings:
    '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  count: '<path d="M12 3v18M6 21h12M5 7h14M5 7l-3 7a3 3 0 0 0 6 0L5 7zM19 7l-3 7a3 3 0 0 0 6 0l-3-7z"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
};
export const icon = (k, s = 22) =>
  '<svg aria-hidden="true" width="' +
  s +
  '" height="' +
  s +
  '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
  ICONS[k] +
  '</svg>';
// page: the screen on show. draft: the sale slip being typed (survives a refresh and a sign-in as the same person).
// cur: the signed-in name, for display only; it is never sent to the database. brand: the default logo markup.
export const S = {
  page: 'stock',
  draft: [],
  // Last used, within this visit only: it saves retyping while a teacher works through a stack of slips, and it
  // is gone on the next load, because a form that opens on a choice nobody made this time is a form that lies.
  lastSource: '',
  lastDepositor: '',
  lastReceiver: '',
  accOpen: 0,
  cur: '',
  brand: '',
  refreshMs: 12000,
  splashMs: 2000,
  // How long the app may sit untouched before it signs itself out (app.js). Counted only while the app is
  // open: time with the browser closed is the remembered-device deadline's business, not this one's. A field
  // rather than a constant so a test can shorten it, like splashMs.
  idleMs: 3600000,
};
// The period every register and the report open on: this month, the same one in all three, so moving between
// ทะเบียนใบรับฝาก, ทะเบียนใบขาย and รายงาน does not silently change which records are being looked at. Not
// remembered between visits - see Store.loadPage().
Object.assign(per, { report: monthPer(today), deposit: monthPer(today), sell: monthPer(today) });
// The ± แก้ยอด column, in a table or in a CSV, exists only where there is something to put in it: a school
// that has never had a stock count does not need a column of zeros. `i` is where that column sits in the row
// being built, which differs per screen, so every caller passes its own index. One rule, so the report and
// the stock export cannot disagree about whether the column is there.
export const adjCol = (a, i) => (adjusted().length ? a : a.filter((_, j) => j !== i));
export function signed(n) {
  n = round(n);
  return '<span class="' + (n < 0 ? 'negative' : '') + '">' + (n > 0 ? '+' : '') + fmt(n) + '</span>';
}
// The difference and what it is as a percentage are one answer, so they are wrapped as one element: inside the
// card layout a phone gets (.cardtbl), every element child of a cell is its own flex item, and two of them were
// pushed to opposite ends of the row by the cell's own justify-content.
export function varCell(sw, bw) {
  return (
    '<span class="varcell">' +
    signed(bw - sw) +
    (sw > 0 ? ' <small>(' + fmt(((bw - sw) / sw) * 100, 1) + '%)</small>' : '') +
    '</span>'
  );
}
export function chip(name, c) {
  return '<span class="badge tchip" style="--c:' + c + '">' + esc(name) + '</span>';
}
export function tchip(id) {
  let t = type(id);
  return chip(t.name, t.color || '#8C9692');
}
export function schip(id) {
  let s = db.sources.find(x => x.id === id);
  return '<span class="badge">' + (s ? esc(s.name) : 'ไม่ระบุ') + '</span>';
}
// The default mark, as index.html paints it before any script runs. Kept here as well so a printed header has
// one even on a project that has uploaded no logo (tests/js/print_head.test.js pins the two copies together).
export const MARK =
  '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 19c0-8 6-14 15-14 0 9-6 15-14 15H5v-1z"/><path d="M5 19l8-8"/></svg>';
// A mark at the top left of anything that gets printed: the report's header and both slip heads. The school's own
// when one has been uploaded (ตั้งค่า), the app's otherwise - a page on paper has no app around it, so a letterhead
// with nothing in its corner reads as a page from nowhere.
export function printLogo() {
  return (
    '<span class="plogo">' +
    (db.schoolLogo ? '<img src="' + esc(db.schoolLogo) + '" alt="โลโก้ ' + esc(db.school) + '">' : MARK) +
    '</span>'
  );
}
// Fills one line of the detail dialog's header and hides it when there is nothing to say. Always assigned,
// never skipped: the dialog is reused by every opener, so a line left as the last one wrote it is the previous
// modal's title sitting above this one's content.
function dhead(id, text) {
  let e = $(id);
  if (!e) return;
  e.textContent = text;
  e.hidden = !text;
}
// The one dialog a slip, the price chart and the column explanations all open in (#detail in index.html).
// EVERY opener goes through here rather than writing #detailbody itself, because the header and the footer
// belong to whatever is open now: the price chart opened straight after the two-scales explanation used to
// carry that explanation's title and lose its own พิมพ์ button.
// `title` and `sub` fill the header, for the things that are not documents: a slip carries its own printed
// head, an explanation and the price chart have none, and the chart's second line is what to do with it.
// `print` is whether the footer still offers พิมพ์: a slip and a chart are printed, an explanation is not.
export function detail(body, { title = '', sub = '', print = true } = {}) {
  $('detailbody').innerHTML = body;
  dhead('detailtitle', title);
  dhead('detailsub', sub);
  let p = $('detailprint');
  if (p) p.hidden = !print;
  // Only when it is not already open: calling detail() again is how what is in it is redrawn in place (the
  // price history turning its page), and showModal() on an open dialog throws.
  let d = $('detail');
  if (!d.open) d.showModal();
}
// ---- one row per waste type ------------------------------------------------------------------------------
// รับฝาก and ขาย are the same table with different columns, the way ทะเบียนใบรับฝาก and ทะเบียนใบขาย already are.
// Every type the screen knows about is a row, always in the same order, so a type is found in the same place on
// both screens and the row count does not change as stock comes and goes. The column labels live in the one head
// row and come back into each row on a phone (.mlab in style.css), which is what lets a row be a line instead of
// a card.
export function lhead(kind, cols) {
  return (
    '<div class="lhead ' + kind + '" aria-hidden="true">' + cols.map(c => '<span>' + c + '</span>').join('') + '</div>'
  );
}
const INFO =
  '<svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.6v.2"/></svg>';
// Every info icon in the app is this button: the same 22px target, the same mark, and one contract - a click
// opens a bubble at the icon (App.info, app.js) and nothing else happens. No `title`: a native tooltip appears
// on hover only, so it answers a mouse and never a phone, and two explanations of the same thing - one that
// follows the pointer, one that waits for a click - is one too many. A database value goes in data-arg, escaped
// as an attribute and read back as data by the one delegated listener, never into an on*= string.
export const infoBtn = (act, label, arg = '') =>
  '<button type="button" class="linfo" data-act="' +
  act +
  (arg ? '" data-arg="' + esc(arg) : '') +
  '" aria-label="' +
  esc(label) +
  '">' +
  INFO +
  '</button>';
// The type's name, its description one tap away rather than in the way (a line of criteria under every name is a
// wall of text nobody reads twice), and under it the figure the row is read against.
export function lname(t, sub = '', badge = '') {
  return (
    '<div class="lname"><span class="nm"><b>' +
    esc(t.name) +
    '</b>' +
    badge +
    (t.note ? infoBtn('typeNote', 'คำอธิบาย ' + t.name, t.id) : '') +
    '</span>' +
    (sub ? '<span class="st">' + sub + '</span>' : '') +
    '</div>'
  );
}
// A type the screen cannot act on, as one line that keeps its place in the order: what state it is in, and what
// to do about it. A type switched off in ตั้งค่า with stock still on the books says so on both screens - the sale
// screen because that stock cannot be sold, the deposit screen because no more of it can be taken in - so the
// screens read the same way and a type never simply vanishes from a list.
// Whether this type has moved at all in the month being worked in. It is what keeps a type that has just been
// sold out and is switched off on the write screens for the rest of that month: the row does not vanish from
// under the person who sold the last of it, and nobody has to switch anything on or off for that to happen -
// the rule expires by itself when the month does. Afterwards the type is finished business and lives in
// ตั้งค่า › ประเภทขยะ (where it is switched back on) and on คงคลัง (where every type keeps a row).
export function movedThisMonth(id) {
  const m = today.slice(0, 7),
    mv = moved(id, m + '-01', m + '-31');
  return mv.in > 0 || mv.out !== 0 || mv.adj !== 0;
}
// The sale that took the last of this type, for the line a finished row shows.
export function lastSale(id) {
  return sold()
    .filter(s => s.items.some(i => i.type === id))
    .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time))[0];
}
export function loff(t, badge, why, pending = false) {
  return (
    '<div class="lrow loff" style="--c:' +
    t.color +
    '">' +
    lname(t) +
    '<span class="badge' +
    (pending ? ' pending' : '') +
    '">' +
    badge +
    '</span><span class="why">' +
    why +
    '</span></div>'
  );
}
export function field(label, html) {
  return '<div><label>' + label + '</label>' + html + '</div>';
}
export function inp(id, t = 'text', value = '', extra = '') {
  return '<input id="' + id + '" type="' + t + '" value="' + esc(value) + '" ' + extra + '>';
}
export function options(a, val, name, sel = '') {
  return a
    .map(
      r =>
        '<option value="' + esc(r[val]) + '"' + (r[val] === sel ? ' selected' : '') + '>' + esc(r[name]) + '</option>',
    )
    .join('');
}
export function heading(title, desc, buttons = '') {
  return (
    '<div class="heading"><div><h1>' +
    title +
    '</h1><p class="muted">' +
    desc +
    '</p></div><div class="actions">' +
    buttons +
    '</div></div>'
  );
}
// The write screens' furniture. One set of helpers so รับฝาก and ขาย are laid out by the same rules: a numbered
// card per step, a summary that stays in view (the rail on a wide screen, the bar above the menu on a phone),
// and the review sheet's three ways of showing what a write will do.
export function cardhead(num, title, hint = '', info = '') {
  return (
    '<div class="cardhead"><span class="cardnum" aria-hidden="true">' +
    num +
    '</span><h2>' +
    title +
    '</h2>' +
    info +
    (hint ? '<p class="cardhint">' + hint + '</p>' : '') +
    '</div>'
  );
}
// The header every printed page carries: the school's mark, who the school is, what the document is and the
// period it covers, with when and by whom it was printed on the right. Hidden on screen (style.css), so a screen
// that wants to be printable only has to include one.
export function printHead(title, period) {
  return (
    '<div class="printhead">' +
    printLogo() +
    '<div><div class="ph-sub">' +
    esc(db.school) +
    '</div><div class="ph-title">' +
    title +
    '</div><div class="ph-sub">' +
    (period ? 'ช่วง ' + period : '') +
    '</div></div><div class="ph-meta">พิมพ์เมื่อ ' +
    esc(new Date().toLocaleString(TH, { dateStyle: 'medium', timeStyle: 'short' })) +
    (S.cur ? '<br>โดย ' + esc(S.cur) : '') +
    '</div></div>'
  );
}
export function printFoot() {
  return (
    '<div class="printfoot">' +
    esc(db.school) +
    ' • ระบบธนาคารขยะ • ข้อมูล ณ เวลาที่พิมพ์ • น้ำหนักเป็นกิโลกรัม จำนวนเงินเป็นบาท</div>'
  );
}
// big: [label, value, unit]. rows: [label, value]. acts: the buttons, primary first. note: why the primary one
// is disabled, or what has not happened yet.
// `head` is the card's own numbered heading (cardhead): the summary beside the lines is step 3 of the screen,
// so it is numbered like the two cards it sits next to rather than announced by a strip above them.
export function rail(id, big, rows, acts, note = '', head = '') {
  return (
    '<aside class="rail"><section class="panel">' +
    head +
    '<div id="' +
    id +
    '">' +
    railsum(big, rows) +
    '</div><div class="railacts">' +
    acts +
    '</div>' +
    (note ? '<p class="railnote">' + note + '</p>' : '') +
    '</section></aside>'
  );
}
export function railsum(big, rows) {
  return (
    '<div class="railbig"><small>' +
    big[0] +
    '</small><b>' +
    big[1] +
    (big[2] ? '<span>' + big[2] + '</span>' : '') +
    '</b></div>' +
    rows.map(r => '<div class="railrow">' + r[0] + '<b>' + r[1] + '</b></div>').join('')
  );
}
// The phone's copy of the rail: the same total and the same one button, over the menu bar.
export function savebar(id, label, value, button) {
  return (
    '<div class="savebar"><div class="sbtot" id="' +
    id +
    '"><small>' +
    label +
    '</small><b>' +
    value +
    '</b></div>' +
    button +
    '</div>'
  );
}
// rows: [label, value] and optionally ['total', label, value] for the line the eye should land on.
export function kv(rows) {
  return (
    '<div class="kv">' +
    rows
      .map(r =>
        r[0] === 'total'
          ? '<div class="kvtot"><span>' + r[1] + '</span><b>' + r[2] + '</b></div>'
          : '<div><span>' + r[0] + '</span><b>' + r[1] + '</b></div>',
      )
      .join('') +
    '</div>'
  );
}
// rows: [label, old, new]. An unchanged field says so rather than showing the same value twice.
export function diff(rows) {
  return (
    '<div class="diff">' +
    rows
      .map(
        r =>
          '<div class="diffrow"><span>' +
          r[0] +
          '</span><div class="diffval">' +
          (String(r[1]) === String(r[2])
            ? '<span class="muted">ไม่เปลี่ยน</span>'
            : '<span class="diffold">' + r[1] + '</span>→<span class="diffnew">' + r[2] + '</span>') +
          '</div></div>',
      )
      .join('') +
    '</div>'
  );
}
// What the write changes beyond the record itself: the stock it moves, the slips it unlocks, the money it books.
// tone: 'ok' a gain, '' something to read twice, 'bad' something that cannot be undone.
//
// The callers write one consequence per clause, separated by ' · ', and each clause becomes its own bullet: three
// consequences in a row wrap into each other and the figure at the end of one reads as the start of the next,
// which is exactly where a reader has to be careful. A single clause stays a plain line - a list of one is a list
// nobody needed.
export function impact(title, text, tone = '') {
  const parts = String(text)
    .split(' · ')
    .map(s => s.trim())
    .filter(Boolean);
  return (
    '<div class="impact ' +
    tone +
    '"><b>' +
    title +
    '</b>' +
    (parts.length > 1 ? '<ul>' + parts.map(s => '<li>' + s + '</li>').join('') + '</ul>' : text) +
    '</div>'
  );
}
export function stats(a) {
  return (
    '<div class="stats">' +
    a
      .map(
        r =>
          '<div class="stat"><small>' +
          r[0] +
          '</small><div class="num">' +
          r[1] +
          '<span class="unit">' +
          r[2] +
          '</span></div><small>' +
          r[3] +
          '</small></div>',
      )
      .join('') +
    '</div>'
  );
}
