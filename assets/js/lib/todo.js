'use strict';
// What the first screen should be telling the school to do. DOM-free and derived entirely from rows the app
// already holds, so there is no threshold to configure and nothing new in the database: a school that has
// never set anything up still gets useful warnings, and one that keeps its records gets better ones.
//
// Three rules, in the order they are worth a teacher's attention:
//   sell      - a type has enough in the store to be worth a trip to the buyer, or has been sitting too long
//   oldprice  - the reference price a type is valued at is older than half a year
//   nodeposit - nothing has been deposited for three weeks; the project has gone quiet
//
// Each rule answers with {key, tone, title, text, go, label}: `go` is the screen that fixes it, which is what
// the button on the card opens. Returning [] is a real answer and the screen says so.
import { fmt, date } from './fmt.js';

const DAY = 86400000;
// Both dates are 'YYYY-MM-DD' in Asia/Bangkok, so a plain UTC subtraction is exact.
export const daysBetween = (from, to) =>
  Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / DAY);
const newest = a => a.reduce((m, d) => (m && m > d ? m : d), '');
// The price warning names three and counts the rest: it is a prompt to go and review prices, and ตั้งค่า holds
// the whole list anyway. The sell warning names ALL of them (n = Infinity), because that line IS the list a
// teacher carries to the buyer - a type folded into และอีก 1 ประเกท is a type left in the store after the trip.
const names = (a, n = 3) =>
  a
    .slice(0, n)
    .map(x => x.t.name + ' ' + fmt(x.st) + ' กก.')
    .join(' · ') + (a.length > n ? ' และอีก ' + (a.length - n) + ' ประเภท' : '');

export const IDLE_DAYS = 60, // a type with stock nobody has sold for this long is worth a look
  QUIET_DAYS = 21, // no deposit at all for this long: the project has gone quiet
  PRICE_DAYS = 180; // a reference price older than this is probably not what the buyer pays today

// What this file watches, for the info icon on the card (pages/stock.js). One line per rule: three rules in one
// paragraph is a paragraph nobody finishes, and the bubble renders the newlines (white-space: pre-line). Built
// from the same constants the rules are, so a threshold cannot be changed in one place and left wrong on the
// screen.
export const WATCHING =
  'ระบบเตือน 3 เรื่อง:\n' +
  '· ประเภทที่ควรขาย คงคลังมากเท่ากับที่เคยขายได้ต่อใบ หรือไม่ได้ขายมาเกิน ' +
  IDLE_DAYS +
  ' วัน\n' +
  '· ราคาอ้างอิงเก่ากว่า ' +
  PRICE_DAYS +
  ' วัน บนประเภทที่ยังมีของในคลัง\n' +
  '· ไม่มีการรับฝากทั้งโรงเรียนเกิน ' +
  QUIET_DAYS +
  ' วัน นับเฉพาะประเภทที่เปิดรับฝากอยู่และมีของในคลัง';

// `S` is the stock helpers bound to the same db (ui.js exports them): {stock, refPrice, sold, active}.
export function todos(db, today, S) {
  const out = [],
    live = (db.types || []).filter(t => t.active),
    held = live.map(t => ({ t, st: S.stock(t.id) })).filter(x => x.st > 0),
    sales = S.sold(),
    deposits = S.active();

  // 1. worth selling: either the store holds as much as a normal sale of that type carries, or nobody has
  //    sold it in IDLE_DAYS. The first needs history to mean anything, so it asks for two sales before it
  //    compares; the second covers a type that has never been sold at all.
  const sellable = held
    .map(x => {
      const mine = sales.filter(s => s.items.some(i => i.type === x.t.id));
      const last = newest(mine.map(s => s.date));
      const per =
        mine.length >= 2
          ? mine.reduce(
              (n, s) => n + s.items.filter(i => i.type === x.t.id).reduce((m, i) => m + (+i.buyerWeight || 0), 0),
              0,
            ) / mine.length
          : 0;
      const first = newest(deposits.filter(r => r.type === x.t.id).map(r => r.date));
      const since = last || first;
      const idle = since ? daysBetween(since, today) : 0;
      return { ...x, per, idle, sold: mine.length > 0 };
    })
    .filter(x => (x.per > 0 && x.st >= x.per) || x.idle >= IDLE_DAYS)
    .sort((a, b) => b.st - a.st);
  // The three reasons a type can be on that list, counted. One trailing phrase taken from the heaviest type was
  // wrong as soon as the list mixed reasons: it said เก็บไว้มากเท่ากับที่เคยขายได้ต่อใบ for four types when that was true
  // of one of them. A single reason keeps the plain sentence (the title already says how many); a mix is counted
  // per reason, and a group of exactly one still gets the precise figure it had before.
  const much = sellable.filter(x => x.per > 0 && x.st >= x.per),
    rest = sellable.filter(x => !(x.per > 0 && x.st >= x.per)),
    stale = rest.filter(x => x.sold),
    never = rest.filter(x => !x.sold),
    groups = [
      { n: much.length, why: 'เก็บไว้มากเท่ากับที่เคยขายได้ต่อใบ' },
      {
        n: stale.length,
        why: stale.length === 1 ? 'ไม่ได้ขายมา ' + stale[0].idle + ' วัน' : 'ไม่ได้ขายมาเกิน ' + IDLE_DAYS + ' วัน',
      },
      { n: never.length, why: never.length === 1 ? 'ยังไม่เคยขายประเภทนี้เลย' : 'ยังไม่เคยขายเลย' },
    ].filter(g => g.n);
  if (sellable.length)
    out.push({
      key: 'sell',
      tone: 'warn',
      title: sellable.length === 1 ? 'มี 1 ประเภทที่ควรขาย' : 'มี ' + sellable.length + ' ประเภทที่ควรขาย',
      text:
        names(sellable, Infinity) +
        ' · ' +
        (groups.length === 1 ? groups[0].why : groups.map(g => g.why + ' ' + g.n + ' ประเภท').join(' · ')),
      go: 'sell',
      label: 'เปิดใบขาย',
    });

  // There is deliberately NO rule about a type priced at 0. A school gives some waste away rather than
  // selling it, and 0 บาท/กก. is the true reference price for that: it values the stock at nothing and starts
  // the sale line at nothing, which is what happened. Nothing in the data tells "0 because we donate it" from
  // "0 because nobody has set it yet", so any warning here would be wrong for one of the two, and wrong every
  // single day for the type the school meant to price at zero.

  // 2. a price nobody has revisited in half a year, on a type the school is still holding for money
  const old = held
    .filter(x => S.refPrice(x.t) > 0)
    .map(x => ({ ...x, from: newest((x.t.prices || []).map(p => p.from)) }))
    .filter(x => x.from && daysBetween(x.from, today) >= PRICE_DAYS)
    .sort((a, b) => a.from.localeCompare(b.from));
  if (old.length)
    out.push({
      key: 'oldprice',
      tone: '',
      title: 'ราคาอ้างอิงเก่ากว่า 6 เดือน ' + old.length + ' ประเภท',
      text:
        names(old) + ' · ตั้งไว้ครั้งสุดท้าย ' + daysBetween(old[0].from, today) + ' วันก่อน ควรถามราคาร้านแล้วปรับ',
      go: 'settings',
      label: 'ทบทวนราคา',
    });

  // 3. nothing coming in. Said only once there is a record to be quiet after: a project on its first day is
  //    not behind on anything.
  const lastDep = newest(deposits.map(r => r.date));
  if (lastDep && daysBetween(lastDep, today) >= QUIET_DAYS)
    out.push({
      key: 'nodeposit',
      tone: '',
      title: 'ไม่มีการรับฝากมา ' + daysBetween(lastDep, today) + ' วัน',
      text: 'ใบรับฝากใบล่าสุดคือวันที่ ' + date(lastDep) + ' · ถ้าช่วงนี้ปิดเทอมก็ปกติ ถ้าไม่ใช่ ลองถามฝ่ายอาคาร',
      go: 'deposit',
      label: 'บันทึกรับฝาก',
    });

  return out;
}
