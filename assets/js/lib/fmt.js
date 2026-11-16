// Pure formatting and date helpers, lifted verbatim from the prototype's app.js. No DOM access.
// Anything that reads the clock is pinned to Asia/Bangkok.
export const esc = v =>
  String(v ?? '').replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export const fmt = (n, d = 2) =>
  Number(n).toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d });
export const sum = (a, k) => a.reduce((s, r) => s + (+r[k] || 0), 0);
const TH = 'th-TH-u-ca-buddhist';
export const be = d => (d ? +d.slice(0, 4) + 543 + d.slice(4) : '');
export const dnum = d => (d ? d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + (+d.slice(0, 4) + 543) : '');
// The caption under a date box: the same date in Buddhist years, with the time when the box carries one.
// '' for anything that is not a date, so an empty or half-typed box shows no caption at all.
export const beCaption = v => {
  const s = String(v ?? ''),
    d = s.slice(0, 10),
    t = s.slice(11, 16);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d))
    ? 'วันที่ ' + date(d) + (/^\d{2}:\d{2}$/.test(t) ? ' เวลา ' + t + ' น.' : '')
    : '';
};
export const date = d =>
  new Date(d + 'T00:00:00').toLocaleDateString(TH, { day: 'numeric', month: 'short', year: 'numeric' });
export const nowTime = () =>
  new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' });
// The prototype evaluates this ONCE at load into a module-level const; app.js still does that
// (`const today = todayFn()`), so the date does not roll over mid-session. Called directly it is live.
export const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });

export function round(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function shiftDay(d, n) {
  let x = new Date(d + 'T12:00:00');
  x.setDate(x.getDate() + n);
  return x.toISOString().slice(0, 10);
}

export function bahtText(n) {
  const d = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'],
    u = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'],
    read = s => {
      s = String(+s);
      if (s.length > 6) return read(s.slice(0, -6)) + 'ล้าน' + read(s.slice(-6));
      let out = '';
      for (let i = 0; i < s.length; i++) {
        let x = +s[i],
          p = s.length - i - 1;
        if (x)
          out +=
            (p === 1 && x === 1
              ? ''
              : p === 1 && x === 2
                ? 'ยี่'
                : p === 0 && x === 1 && s.length > 1
                  ? 'เอ็ด'
                  : d[x]) + u[p];
      }
      return out;
    };
  let [b, s] = round(n).toFixed(2).split('.');
  return +b || +s ? (+b ? read(b) + 'บาท' : '') + (+s ? read(s) + 'สตางค์' : 'ถ้วน') : 'ศูนย์บาทถ้วน';
}
