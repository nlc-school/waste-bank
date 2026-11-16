'use strict';
// The store: Supabase in, the prototype's `db` graph out. DOM-free, and read-only on purpose: the write
// paths (Task 12) go through RPCs and the server derives the operator from auth.uid(), so nothing in this
// file ever names the signed-in user.
//
// `db` is ONE object that is updated in place, never replaced, so app.js can hold `db` for the lifetime
// of the page and the ~160 call sites that read db.deposits / db.sales / ... stay synchronous.
//
//   db.deposits   FLAT, one row per deposit_item: {id (the item's), no (the slip's), date, time, source,
//                 type, weight, operator, checker, point, note, void, voidReason}
//   db.sales      header with items: {id, no, date, time, buyer, [buyerId], ref, [receiver, receiverRole],
//                 operator, note, items:[{type, clear, stockWeight, buyerWeight, price, total}], total,
//                 void, voidReason}
//   db.types      {id, name, note, color, active, prices:[{from, price}] ascending by from}
//   db.sources    {id, name, active, color}      db.buyers {id, name, contact, phone, address, note, active}
//   db.depositors / db.receivers {id, name, role, active}
//   db.adjustments {id, date, type, system, counted, diff, reason, operator, void, [saleId]}
//   db.audit      latest 200, newest first: {at, action}
//   db.school, db.schoolLogo (only when set), db.point, db.demo (always false)
import { client as realClient } from './supabase.js';
import * as Auth from './auth.js';

export const PAGE = 1000; // PostgREST's default row cap: a longer table is silently truncated
export const AUDIT_ROWS = 200;
export const STALE_MS = 30000; // see isStale()
const PAGE_KEY = 'school-waste-bank-page';

let client = realClient;
let now = () => Date.now();
export function _useClient(c) {
  client = c;
}
export function _useClock(f) {
  now = f;
}

export function emptyDb() {
  return {
    school: '',
    point: '',
    types: [],
    sources: [],
    buyers: [],
    receivers: [],
    depositors: [],
    deposits: [],
    sales: [],
    adjustments: [],
    audit: [],
    demo: false,
  };
}
export const db = emptyDb();

// ---- reading --------------------------------------------------------------------------------
// `build(opts)` returns a fresh query builder each call (a builder is single-use); the first call passes
// {count:'exact'} to select(). Completion is judged against that exact count, NOT against page length: a project
// whose max_rows is below PAGE returns short pages all the way down, and "short page = done" would truncate
// silently. The next window starts where the rows actually received end. Every page goes through Auth.guard.
// Rows are de-duplicated by `key`: offset paging can repeat a boundary row when a write lands between pages.
// If the server gives no count (a proxy stripping Content-Range, CORS not exposing it), only an EMPTY page ends the
// read: a short page proves nothing when the server's cap is unknown, an empty one does.
export async function fetchAll(build, key = r => r.id) {
  const rows = [],
    seen = new Set();
  let received = 0,
    total = null;
  for (;;) {
    const first = total === null && received === 0;
    const { data, error, count } = await Auth.guard(
      build(first ? { count: 'exact' } : undefined).range(received, received + PAGE - 1),
    );
    if (error) throw error;
    const got = data || [];
    if (first && typeof count === 'number') total = count;
    received += got.length;
    for (const r of got) {
      const k = key(r);
      if (k !== undefined) {
        if (seen.has(k)) continue;
        seen.add(k);
      }
      rows.push(r);
    }
    if (got.length === 0) return rows;
    if (total !== null && received >= total) return rows;
  }
}

// Each table is ordered on a unique key last, so two pages can never overlap or skip a row.
const Q = {
  app_setting: (c, o) => c.from('app_setting').select('*', o).order('id'),
  waste_type: (c, o) => c.from('waste_type').select('*', o).order('sort_order').order('name').order('id'),
  waste_type_price: (c, o) => c.from('waste_type_price').select('*', o).order('waste_type_id').order('effective_from'),
  waste_source: (c, o) => c.from('waste_source').select('*', o).order('sort_order').order('name').order('id'),
  buyer: (c, o) => c.from('buyer').select('*', o).order('name').order('id'),
  depositor: (c, o) => c.from('depositor').select('*', o).order('sort_order').order('name').order('id'),
  receiver: (c, o) => c.from('receiver').select('*', o).order('sort_order').order('name').order('id'),
  deposit: (c, o) => c.from('deposit').select('*', o).order('deposit_date').order('deposit_time').order('slip_no'),
  deposit_item: (c, o) => c.from('deposit_item').select('*', o).order('id'),
  sale: (c, o) => c.from('sale').select('*', o).order('sale_date').order('sale_time').order('slip_no'),
  sale_item: (c, o) => c.from('sale_item').select('*', o).order('id'),
  stock_adjustment: (c, o) => c.from('stock_adjustment').select('*', o).order('adjust_date').order('id'),
};
// The trail is one capped request, newest first: older rows are never needed by a screen.
const auditQuery = (c, o) =>
  c.from('audit_log').select('id,at,action').order('at', { ascending: false }).order('id', { ascending: false });

async function fetchTable(table) {
  if (table === 'audit_log') {
    const { data, error } = await Auth.guard(auditQuery(client).range(0, AUDIT_ROWS - 1));
    if (error) throw error;
    return data || [];
  }
  return fetchAll(
    o => Q[table](client, o),
    table === 'waste_type_price' ? r => r.waste_type_id + '|' + r.effective_from : undefined,
  );
}

// ---- assembly (pure: rows in, prototype shapes out) ------------------------------------------
const num = v => +v;
const str = v => (v == null ? '' : String(v));
const by =
  (...keys) =>
  (a, b) => {
    for (const k of keys) {
      const x = a[k],
        y = b[k];
      if (x < y) return -1;
      if (x > y) return 1;
    }
    return 0;
  };

// The collection point is whatever the settings row holds, blank included: there is no default standing in for it.
// A blank one is a project that has not been set up, which the setup gate (lib/setup.js) reports and keeps every
// screen but ตั้งค่า shut for, rather than a screen quietly stamping an invented point on a real slip.
function assembleSettings(rows) {
  const s = (rows || [])[0] || {};
  const out = { school: str(s.school_name), point: str(s.deposit_point) };
  if (s.school_logo) out.schoolLogo = s.school_logo;
  return out;
}
function assembleTypes(types, prices) {
  const ps = new Map();
  for (const p of prices || []) {
    if (!ps.has(p.waste_type_id)) ps.set(p.waste_type_id, []);
    ps.get(p.waste_type_id).push({ from: p.effective_from, price: num(p.price) });
  }
  return (types || [])
    .slice()
    .sort(by('sort_order', 'name', 'id'))
    .map(t => ({
      id: t.id,
      name: t.name,
      note: str(t.note),
      color: t.color,
      active: t.is_active,
      prices: (ps.get(t.id) || []).sort(by('from')),
    }));
}
const assembleSources = rows =>
  (rows || [])
    .slice()
    .sort(by('sort_order', 'name', 'id'))
    .map(s => ({ id: s.id, name: s.name, active: s.is_active, color: s.color }));
const assembleBuyers = rows =>
  (rows || [])
    .slice()
    .sort(by('name', 'id'))
    .map(b => ({
      id: b.id,
      name: b.name,
      contact: str(b.contact),
      phone: str(b.phone),
      address: str(b.address),
      note: str(b.note),
      active: b.is_active,
    }));
const assemblePeople = rows =>
  (rows || [])
    .slice()
    .sort(by('sort_order', 'name', 'id'))
    .map(p => ({ id: p.id, name: p.name, role: str(p.role), active: p.is_active }));

// Items inside one slip follow the order of the types list, as the deposit form lists them.
function typeRank(types) {
  const m = new Map();
  types.forEach((t, i) => m.set(t.id, i));
  return id => (m.has(id) ? m.get(id) : 1e9);
}

function assembleDeposits(deposits, items, types) {
  const rank = typeRank(types),
    slips = new Map();
  for (const d of deposits || []) slips.set(d.id, { d, items: [] });
  for (const i of items || []) {
    const s = slips.get(i.deposit_id);
    if (s) s.items.push(i);
  }
  const out = [];
  for (const { d, items: its } of [...slips.values()].sort((a, b) =>
    by('deposit_date', 'deposit_time', 'slip_no')(a.d, b.d),
  )) {
    its.sort((a, b) => rank(a.waste_type_id) - rank(b.waste_type_id) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const i of its) {
      out.push({
        id: i.id,
        no: d.slip_no,
        date: d.deposit_date,
        time: str(d.deposit_time).slice(0, 5),
        source: d.source_id,
        type: i.waste_type_id,
        weight: num(i.weight),
        operator: d.operator_name,
        checker: str(d.checker_name),
        point: str(d.deposit_point),
        note: str(d.note),
        void: !!i.is_void,
        voidReason: str(i.void_reason),
      });
    }
  }
  return out;
}

// One sale in the prototype's shape. `its` are sale_item rows in the order they should be shown.
function saleShape(s, its) {
  const o = {
    id: s.id,
    no: s.slip_no,
    date: s.sale_date,
    time: str(s.sale_time).slice(0, 5),
    buyer: str(s.buyer_name),
  };
  if (s.buyer_id) o.buyerId = s.buyer_id;
  o.ref = str(s.ref);
  if (s.receiver_name) {
    o.receiver = s.receiver_name;
    o.receiverRole = str(s.receiver_role);
  }
  o.operator = s.operator_name;
  o.note = str(s.note);
  o.items = its.map(i => ({
    type: i.waste_type_id,
    clear: !!i.is_clear,
    stockWeight: num(i.stock_weight),
    buyerWeight: num(i.buyer_weight),
    price: num(i.price),
    total: num(i.total),
  }));
  o.total = num(s.total);
  o.void = !!s.is_void;
  o.voidReason = str(s.void_reason);
  return o;
}

function assembleSales(sales, items, types) {
  const rank = typeRank(types),
    of = new Map();
  for (const i of items || []) {
    if (!of.has(i.sale_id)) of.set(i.sale_id, []);
    of.get(i.sale_id).push(i);
  }
  return (sales || [])
    .slice()
    .sort(by('sale_date', 'sale_time', 'slip_no'))
    .map(s =>
      saleShape(
        s,
        (of.get(s.id) || []).sort(
          (a, b) => rank(a.waste_type_id) - rank(b.waste_type_id) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
        ),
      ),
    );
}

// The slip create_sale() returns ({...sale columns, items:[...]}) in the shape db.sales holds, so the slip that is
// printed is what the server kept. Items stay in the order the operator entered them, which the function preserves.
export function saleFromRpc(js) {
  const { items, ...head } = js;
  return saleShape(head, items || []);
}

const assembleAdjustments = rows =>
  (rows || [])
    .slice()
    .sort(by('adjust_date', 'id'))
    .map(a => {
      const o = {
        id: a.id,
        date: a.adjust_date,
        type: a.waste_type_id,
        system: num(a.system_weight),
        counted: num(a.counted_weight),
        diff: num(a.diff),
        reason: str(a.reason),
        operator: str(a.operator_name),
        void: !!a.is_void,
      };
      // Only when the count came out of a sell-all line: the sell screen warns, before the reason is
      // typed, that voiding the slip cancels this correction too. Absent for a count entered on its own.
      if (a.sale_id) o.saleId = a.sale_id;
      return o;
    });

const assembleAudit = rows =>
  (rows || [])
    .slice()
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : b.id - a.id))
    .slice(0, AUDIT_ROWS)
    .map(r => ({ at: r.at, action: r.action }));

// slice name -> the tables it reads and how to build its part of db. `ctx` is the types list in force
// (deposits and sales order their items by it).
export const SLICES = {
  settings: { tables: ['app_setting'], build: r => assembleSettings(r.app_setting) },
  types: {
    tables: ['waste_type', 'waste_type_price'],
    build: r => ({ types: assembleTypes(r.waste_type, r.waste_type_price) }),
  },
  sources: { tables: ['waste_source'], build: r => ({ sources: assembleSources(r.waste_source) }) },
  buyers: { tables: ['buyer'], build: r => ({ buyers: assembleBuyers(r.buyer) }) },
  depositors: { tables: ['depositor'], build: r => ({ depositors: assemblePeople(r.depositor) }) },
  receivers: { tables: ['receiver'], build: r => ({ receivers: assemblePeople(r.receiver) }) },
  deposits: {
    tables: ['deposit', 'deposit_item'],
    build: (r, types) => ({ deposits: assembleDeposits(r.deposit, r.deposit_item, types) }),
  },
  sales: { tables: ['sale', 'sale_item'], build: (r, types) => ({ sales: assembleSales(r.sale, r.sale_item, types) }) },
  adjustments: { tables: ['stock_adjustment'], build: r => ({ adjustments: assembleAdjustments(r.stock_adjustment) }) },
  audit: { tables: ['audit_log'], build: r => ({ audit: assembleAudit(r.audit_log) }) },
};
export const ALL_SLICES = Object.keys(SLICES);

// Build (part of) a graph from raw table rows. Used by refresh() and, with a dump of the real database,
// by the cross-check test. `current` supplies the types for ordering when `types` is not being rebuilt.
export function assemble(raw, slices = ALL_SLICES, current = emptyDb()) {
  const out = { demo: false };
  const names = ALL_SLICES.filter(n => slices.includes(n)); // settings/types first
  for (const n of names) Object.assign(out, SLICES[n].build(raw, out.types || current.types));
  return out;
}

// ---- refreshing -----------------------------------------------------------------------------
let loadedAt = null; // when the last FULL load finished; null = never loaded / cleared
let stale = false; // set by markStale() and by any failed refresh
let chain = Promise.resolve();
let issued = 0,
  applied = 0; // a read may only apply if no newer read (or a sign-out) has applied since it started
let chainWait = 10000; // how long a refresh waits for the one ahead of it
export function _useChainWait(ms) {
  chainWait = ms;
}

// Stale means: someone said so (markStale, or a refresh that failed), or the last full load is older than
// STALE_MS. Never-loaded and signed-out (loadedAt null) is not stale: there is nothing to refresh, loadAll()
// is the way in.
export function isStale() {
  return stale || (loadedAt !== null && now() - loadedAt > STALE_MS);
}
export function markStale() {
  stale = true;
}

async function doRefresh(names, id) {
  const full = names.length === ALL_SLICES.length;
  const tables = [...new Set(names.flatMap(n => SLICES[n].tables))];
  const raw = {};
  try {
    await Promise.all(
      tables.map(async t => {
        raw[t] = await fetchTable(t);
      }),
    );
  } catch (e) {
    stale = true;
    throw e;
  }
  if (id <= applied) return db; // abandoned while it hung, and a newer read (or a sign-out) has applied since: it must not overwrite that
  applied = id;
  // Everything arrived: only now touch db, in one step, so a failure can never leave it half-replaced.
  const part = assemble(raw, names, db);
  Object.assign(db, part, { demo: false });
  // A logo removed on the server must disappear here too: assembleSettings only sets the key when there is one.
  if (names.includes('settings') && !('schoolLogo' in part)) delete db.schoolLogo;
  if (full) {
    loadedAt = now();
    stale = false;
  }
  return db;
}

// Re-read some slices (all by default). Calls are serialised, but a link that hangs is abandoned after chainWait: one stalled read
// must not stop every later refresh (the register would silently stop updating). Abandoning marks the store stale, so the next
// attempt retries, and the stalled read cannot overwrite what a later one applied.
export function refresh(slices) {
  const names = slices ? ALL_SLICES.filter(n => slices.includes(n)) : ALL_SLICES;
  const id = ++issued,
    ahead = chain;
  const run = Promise.race([
    ahead,
    new Promise(r => {
      const t = setTimeout(() => {
        stale = true;
        r();
      }, chainWait);
      ahead.then(() => clearTimeout(t));
    }),
  ]).then(() => doRefresh(names, id));
  chain = run.catch(() => {});
  return run;
}
export const loadAll = () => refresh();

// Resolves true when it reloaded, false when nothing was stale.
export async function refreshIfStale() {
  if (!isStale()) return false;
  await loadAll();
  return true;
}

// Sign-out: forget everything. The pre-auth login dialog never reads the store (school name comes from config.js).
export function clear() {
  for (const k of Object.keys(db)) delete db[k];
  Object.assign(db, emptyDb());
  loadedAt = null;
  stale = false;
  applied = issued;
  chain = Promise.resolve();
}

// ---- which screen was open (the only thing localStorage holds) ------------------------------
// A reload lands back where the user was, which is what a reload is for. Nothing else is remembered: the periods,
// the last-used source and the page sizes start from their defaults on every load, because a filter or a date
// range that outlives the visit is a filter nobody set and everybody then has to notice.
//
// This is a UI crumb, not data: it is read back as a name and the shell only uses it if it is one of its own
// screens (app.js), so whatever else a browser profile may hold under this key can do nothing.
export function loadPage() {
  try {
    const v = localStorage.getItem(PAGE_KEY);
    return typeof v === 'string' && /^[a-z]{1,20}$/.test(v) ? v : '';
  } catch {
    return ''; // storage unavailable: start where the app starts
  }
}
// '' forgets it, which is what signing out does: the next sign-in starts on the first screen.
export function savePage(name) {
  try {
    if (name) localStorage.setItem(PAGE_KEY, String(name));
    else localStorage.removeItem(PAGE_KEY);
  } catch {
    /* storage unavailable or full: the screen simply is not remembered */
  }
}

// The prototype kept the school's whole records in localStorage, which is shared per ORIGIN, not per path: the prototype and this
// app can sit on the same host. So nothing calls this automatically; it exists for a deliberate, later clean-up once the records are safe.
export const LEGACY_KEYS = [
  'school-waste-bank-v3',
  'school-waste-bank-v2',
  'school-waste-bank-v1',
  'school-waste-bank-user',
  'school-waste-bank-loggedout',
];
export function purgeLegacy() {
  for (const k of LEGACY_KEYS) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* unavailable: nothing to purge */
    }
  }
}
