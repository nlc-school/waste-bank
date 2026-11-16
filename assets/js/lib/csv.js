// File export helpers, lifted from the prototype's app.js. The prototype's csv() ended with
// notify('ส่งออก CSV แล้ว'); notify lives in app.js (DOM), so it is injected with setCsvNotify()
// instead of imported, which keeps this module free of a cycle back into app.js.
let notifyFn = null;
export function setCsvNotify(fn) {
  notifyFn = fn;
}

export function download(name, content, mime) {
  let u = URL.createObjectURL(new Blob([content], { type: mime })),
    a = document.createElement('a');
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 5000);
}

export function csv(name, head, rows) {
  const safe = v => {
    let s = String(v ?? '');
    if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  download(name, '﻿' + [head, ...rows].map(r => r.map(safe).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
  if (notifyFn) notifyFn('ส่งออก CSV แล้ว');
}
