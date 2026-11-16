'use strict';
// Database errors in Thai. DOM-free.
//
// The write functions of db/deploy/004_functions_write.sql raise their refusals with a SQLSTATE and an English message
// that carries the type name and the relevant weight (WB001..WB006). PostgREST passes the SQLSTATE through as
// `code` and the message through as `message`. The screens never show either: this module turns them into the
// sentences the prototype already showed for the same refusals (saveSale, voidDeposit, saveDeposit), so a
// refusal that the client-side check missed (a race, a stale screen) reads the same as one it caught.
//
// What is deliberately NOT here: a retry. 40001 is raised by wb_require_read_committed() for a condition that
// stays true under REPEATABLE READ, so repeating the call can only fail again.
import { fmt, date } from './lib/fmt.js';

export const GENERIC = 'บันทึกไม่สำเร็จ ลองอีกครั้ง';
export const MSG = {
  noAdmin: 'ต้องเป็นผู้ดูแลระบบจึงจะทำรายการนี้ได้',
  expired: 'เซสชันหมดอายุ เข้าสู่ระบบอีกครั้ง',
  offline: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองอีกครั้ง',
  isolation: 'บันทึกไม่ได้: ฐานข้อมูลตั้งค่าไม่รองรับการตัดสต็อก กรุณาแจ้งผู้ดูแลระบบ', // 40001
  invalid: 'ข้อมูลไม่ถูกต้อง ตรวจสอบรายการแล้วลองอีกครั้ง', // 22023, 23514
  gone: 'ไม่พบรายการนี้ อาจถูกเปลี่ยนแปลงไปแล้ว ลองโหลดหน้าใหม่', // P0002
  duplicate: 'ข้อมูลซ้ำกับที่มีอยู่แล้ว', // 23505
  noItemsDeposit: 'กรอกน้ำหนักอย่างน้อย 1 ประเภท', // WB004, from saveDeposit
  noItemsSale: 'เพิ่มรายการขายอย่างน้อย 1 รายการ', // WB004, from saveSale
  stockShort: 'ยกเลิกไม่ได้: น้ำหนักคงคลังไม่พอ เพราะขายไปแล้ว', // WB003, from voidDeposit
};

const num = s => fmt(+s);
// Server text is data, not instructions: it is only ever matched against, and its captures are shown as text.
const RE = {
  WB001: /^insufficient stock for (.*): available (-?[\d.]+) kg\s*$/s,
  WB002: /^cannot void: (.*) from slip (.*) was already sold in sale (.*) \((.*)\)\s*$/s,
  // Two templates, and the difference is the whole point: create_deposit refuses a type that is switched off
  // ("or inactive"), create_sale does not - stock already on the books has to be sellable. So the sentence may
  // only mention รับฝาก when the server itself did.
  WB006: /^unknown (?:or inactive )?waste type (.*)$/s,
};

export function thaiError(err) {
  if (!err) return GENERIC;
  const code = String(err.code ?? ''),
    msg = String(err.message ?? '');
  if (err.status === 401 || code === 'PGRST301' || /jwt expired/i.test(msg)) return MSG.expired;
  switch (code) {
    case 'WB001': {
      const m = RE.WB001.exec(msg);
      return m ? m[1] + ': รร.ชั่งเกินที่มีในคลัง ' + num(m[2]) + ' กก.' : 'น้ำหนักที่ขายเกินที่มีในคลัง';
    }
    case 'WB002': {
      const m = RE.WB002.exec(msg);
      if (!m) return 'ยกเลิกไม่ได้: ขยะชุดนี้ขายแล้ว ถ้าต้องการยกเลิก ให้ยกเลิกใบขายนั้นก่อน';
      const d = /^\d{4}-\d{2}-\d{2}$/.test(m[4]) ? ' (' + date(m[4]) + ')' : '';
      return 'ยกเลิกไม่ได้: ขยะชุดนี้ขายแล้วในใบ ' + m[3] + d + ' ถ้าต้องการยกเลิก ให้ยกเลิกใบขายนั้นก่อน';
    }
    case 'WB003':
      return MSG.stockShort;
    case 'WB004':
      return /^sale/i.test(msg) ? MSG.noItemsSale : MSG.noItemsDeposit;
    case 'WB005':
    case '42501':
      return MSG.noAdmin;
    case 'WB006': {
      const m = RE.WB006.exec(msg),
        tail = /inactive/.test(msg) ? 'ไม่มีในระบบหรือปิดรับฝากอยู่' : 'ไม่มีในระบบ';
      return m ? 'ประเภทขยะ “' + m[1].trim() + '” ' + tail : 'ประเภทขยะ' + tail;
    }
    case '40001':
      return MSG.isolation;
    case '22023':
    case '23514':
    case '22P02':
    case '22007':
      return MSG.invalid;
    case 'P0002':
      return MSG.gone;
    case '23505':
      return MSG.duplicate;
  }
  // No SQLSTATE at all: the request never reached the database (fetch failed, auth retry exhausted).
  if (
    !code &&
    (err.name === 'AuthRetryableFetchError' || err.name === 'TypeError' || /fetch|network|failed to/i.test(msg))
  )
    return MSG.offline;
  if (err.status >= 500) return MSG.offline;
  return GENERIC;
}
