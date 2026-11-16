// Stock arithmetic over the in-memory db, lifted verbatim from the prototype's app.js. DOM-free.
// A factory so app.js can bind the returned members as its own globals and keep its ~160 call
// sites (`stock(id)`, `moved(id, from, to)`) unchanged.
// `db` may be the db object or a function returning the current one (a getter survives anything that
// replaces the object; today the store updates one db object in place).
import { round, sum } from './fmt.js';

export function makeStock(dbOrGetter) {
  const D = typeof dbOrGetter === 'function' ? dbOrGetter : () => dbOrGetter;
  function active() {
    return D().deposits.filter(r => !r.void);
  }
  function sold() {
    return D().sales.filter(r => !r.void);
  }
  function adjusted() {
    return D().adjustments.filter(r => !r.void);
  }
  function lines() {
    return sold().flatMap(s => s.items.map(i => ({ ...i, date: s.date })));
  }
  function moved(id, from = '', to = '9999') {
    const f = r => r.type === id && r.date >= from && r.date <= to,
      L = lines().filter(f);
    return {
      in: round(sum(active().filter(f), 'weight')),
      out: round(sum(L, 'stockWeight')),
      buyer: round(sum(L, 'buyerWeight')),
      adj: round(sum(adjusted().filter(f), 'diff')),
      money: round(sum(L, 'total')),
    };
  }
  function stockAt(id, to = '9999') {
    let m = moved(id, '', to);
    return round(m.in - m.out + m.adj);
  }
  function stock(id) {
    return stockAt(id);
  }
  function refPrice(t, d = '9999') {
    let p = (t.prices || []).slice().sort((a, b) => a.from.localeCompare(b.from)),
      hit = p.filter(x => x.from <= d).pop() || p[0];
    return hit ? hit.price : 0;
  }
  function type(id) {
    return D().types.find(t => t.id === id) || { name: 'ไม่ทราบประเภท', color: '#999' };
  }
  function source(id) {
    return D().sources.find(s => s.id === id) || { name: 'ไม่ระบุ' };
  }
  return { active, sold, adjusted, lines, moved, stockAt, stock, refPrice, type, source };
}
