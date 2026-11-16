'use strict';
// Every write the app makes. DOM-free.
//
// Documents (deposits, sales, voids) go through the RPC functions of db/deploy/004_functions_write.sql: each validates the
// whole payload, takes the stock locks, writes the audit row and returns what it stored. Master data and settings
// have no RPC: an admin holds INSERT/UPDATE on those tables directly (db/deploy/005_policies.sql), and the audit row for
// them is written through the log_audit() RPC.
//
// Three rules hold for every call here:
//  * It goes through Auth.guard(), so an expired session is noticed whatever the call was.
//  * It is made once. A failure is thrown to the caller, never retried: 40001 comes from
//    wb_require_read_committed() for a condition that stays true under REPEATABLE READ, so repeating can only
//    fail again, and a blind retry of a write that may have committed would book it twice.
//  * It never names the signed-in user. The server derives the operator and the actor from auth.uid().
//    `operator` in a deposit is the teacher who physically took the waste, picked from the depositor list.
import { client as realClient } from './supabase.js';
import * as Auth from './auth.js';

let client = realClient;
export function _useClient(c) {
  client = c;
}

// `make` receives the client and returns a supabase-js builder. A thunk, so a missing client throws here and
// not at import, and so the call is made exactly once.
async function call(make) {
  if (!client) throw Object.assign(new Error('not configured'), { code: '' });
  const res = await Auth.guard(make(client));
  if (res && res.error) {
    const e = res.error;
    throw Object.assign(new Error(e.message || 'request failed'), {
      code: e.code ?? '',
      details: e.details,
      hint: e.hint,
      status: res.status,
    });
  }
  return res ? res.data : null;
}
const rpc = (fn, args) => call(c => c.rpc(fn, args));

// The one read this app makes before anyone signs in: the school's name and mark, for the sign-in dialog.
// It goes through f_public_brand() (db/deploy/002_functions_read.sql), the only function `anon` may execute,
// which hands back two columns of app_setting and nothing else.
//
// Deliberately outside call(): there is no session for Auth.guard() to watch over, and nothing here may
// throw or reject, because a dialog that cannot name the school must still be a dialog that can sign someone
// in. Every failure - no client, a paused project, a policy that was not applied - comes back as null, and
// the dialog simply carries no school name.
//
// The logo is checked here rather than where it is drawn: it reaches an <img src> and the page's favicon, so
// a value that is not a data: image is dropped instead of being put in front of a browser.
export async function publicBrand() {
  if (!client) return null;
  try {
    const res = await client.rpc('f_public_brand');
    const row = Array.isArray(res?.data) ? res.data[0] : res?.data;
    if (res?.error || !row) return null;
    const txt = v => (typeof v === 'string' ? v : '');
    const logo = txt(row.school_logo);
    return {
      school: txt(row.school_name).trim().slice(0, 150),
      logo: /^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,/.test(logo) ? logo : '',
    };
  } catch {
    return null;
  }
}

// ---- documents ------------------------------------------------------------------------------
// d: {date, time, source, point, operator, note, items:[{type, weight}]}
// deposit_point is always sent, and sent as it stands: it is the point an admin typed into ตั้งค่า, with no default
// invented here. Nothing can reach this with a blank one, because the setup gate keeps the deposit screen shut until
// the point is filled in; were it blank anyway, create_deposit falls back to app_setting.deposit_point.
export function depositPayload(d) {
  return {
    deposit_date: d.date,
    deposit_time: d.time,
    source_id: d.source,
    deposit_point: String(d.point ?? '').trim(),
    operator_name: d.operator,
    note: d.note || '',
    items: d.items.map(i => ({ waste_type_id: i.type, weight: i.weight })),
  };
}
// Returns the slip number (text).
export const createDeposit = d => rpc('create_deposit', { payload: depositPayload(d) });

// s: {date, time, buyerId|null, buyer, ref, receiver, receiverRole, note, items:[{type, clear, stockWeight, buyerWeight, price}]}
// stockWeight on a SELL-ALL line is the school's own scale reading of the lot, or null when nobody weighed it.
// Null means "take the current stock", as it always did. A figure short of the stock the server holds books the
// difference as a stock count tied to the slip (db/deploy/004_functions_write.sql), so waste that went missing
// reads as a loss in the report's ± แก้ยอด column instead of hiding in the slip's shop-scale variance. A figure
// above the stock is refused (WB001): that is a deposit nobody recorded, and a sale may not invent stock.
export function salePayload(s) {
  return {
    sale_date: s.date,
    sale_time: s.time,
    buyer_id: s.buyerId || null,
    buyer_name: s.buyer,
    ref: s.ref || '',
    receiver_name: s.receiver || '',
    receiver_role: s.receiverRole || '',
    note: s.note || '',
    items: s.items.map(i => ({
      waste_type_id: i.type,
      is_clear: !!i.clear,
      stock_weight: i.stockWeight,
      buyer_weight: i.buyerWeight,
      price: i.price,
    })),
  };
}
// Returns the saved slip as the server stored it: the sale columns plus `items` (see Store.saleFromRpc).
export const createSale = s => rpc('create_sale', { payload: salePayload(s) });

export const voidDepositItem = (itemId, reason) => rpc('void_deposit_item', { p_item_id: itemId, p_reason: reason });
export const voidSale = (saleId, reason) => rpc('void_sale', { p_sale_id: saleId, p_reason: reason });
export const audit = action => rpc('log_audit', { p_action: action });

// ---- settings and master data (direct writes, admin only by policy) ---------------------------
const write = (table, f) => call(c => f(c.from(table)));
// Next sort_order: appended after the last one, as the prototype appended to its arrays.
async function nextSort(table) {
  const rows = await write(table, t => t.select('sort_order').order('sort_order', { ascending: false }).limit(1));
  return ((rows && rows[0] && rows[0].sort_order) || 0) + 1;
}
const SETTING = extra => ({ id: true, updated_at: new Date().toISOString(), ...extra });
// One row (id = true). An upsert, so a project whose settings row was never created still saves.
export const saveGeneral = ({ school, point }) =>
  write('app_setting', t => t.upsert(SETTING({ school_name: school, deposit_point: point }), { onConflict: 'id' }));
export const setLogo = dataUrl =>
  write('app_setting', t => t.upsert(SETTING({ school_logo: dataUrl }), { onConflict: 'id' }));
export const resetLogo = () =>
  write('app_setting', t => t.upsert(SETTING({ school_logo: null }), { onConflict: 'id' }));

// t: {id, name, note, color, active, price, from, priceChanged}. The row's own columns go in one update; the price
// is a new row effective `from`, replacing one already there. A duplicate name is refused by the unique
// constraint (23505), which errors.js reads as "ข้อมูลซ้ำกับที่มีอยู่แล้ว".
export async function saveType(t) {
  await write('waste_type', q =>
    q.update({ name: t.name, note: t.note, color: t.color, is_active: t.active }).eq('id', t.id),
  );
  if (t.priceChanged)
    await write('waste_type_price', q =>
      q.upsert(
        { waste_type_id: t.id, effective_from: t.from, price: t.price },
        { onConflict: 'waste_type_id,effective_from' },
      ),
    );
}
export async function addType(t) {
  const sort = await nextSort('waste_type');
  const row = await write('waste_type', q =>
    q.insert({ name: t.name, note: t.note, color: t.color, is_active: true, sort_order: sort }).select('id').single(),
  );
  await write('waste_type_price', q => q.insert({ waste_type_id: row.id, effective_from: t.from, price: t.price }));
}

export const setTypeActive = (id, active) => write('waste_type', q => q.update({ is_active: active }).eq('id', id));

export async function addSource(s) {
  const sort = await nextSort('waste_source');
  await write('waste_source', q => q.insert({ name: s.name, color: s.color, is_active: true, sort_order: sort }));
}
// s: {id, name, color}. The active flag has its own call, because turning a source off is its own decision.
export const saveSource = s => write('waste_source', q => q.update({ name: s.name, color: s.color }).eq('id', s.id));
export const setSourceActive = (id, active) => write('waste_source', q => q.update({ is_active: active }).eq('id', id));

export const addBuyer = v => write('buyer', q => q.insert({ ...v, is_active: true }));
export const updateBuyer = (id, v) => write('buyer', q => q.update(v).eq('id', id));
export const setBuyerActive = (id, active) => write('buyer', q => q.update({ is_active: active }).eq('id', id));

export async function addPerson(kind, p) {
  const table = kind === 'depositor' ? 'depositor' : 'receiver',
    sort = await nextSort(table);
  await write(table, q => q.insert({ name: p.name, role: p.role, sort_order: sort }));
}
const people = kind => (kind === 'depositor' ? 'depositor' : 'receiver');
export const savePerson = (kind, id, p) =>
  write(people(kind), q => q.update({ name: p.name, role: p.role }).eq('id', id));
// There is no delete: a person is switched off like every other piece of master data, and no table grants
// `authenticated` DELETE at all (db/deploy/005_policies.sql).
export const setPersonActive = (kind, id, active) =>
  write(people(kind), q => q.update({ is_active: active }).eq('id', id));
