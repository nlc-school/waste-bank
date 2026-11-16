'use strict';
// The shell: the router, render, notify, askReason, the sign-in dialog and the App namespace that inline handlers
// resolve through. The screens are pages/*.js; each registers itself with App.registerPage(name, {render, handlers,
// after}) and main.js imports them, so nothing here knows what a deposit or a sale is. The list machinery is
// lib/table.js, the shared helpers and state are ui.js, every database write is api.js.
import { esc, beCaption } from './lib/fmt.js';
import { setCsvNotify } from './lib/csv.js';
import * as Auth from './auth.js';
import * as Api from './api.js';
import * as Store from './store.js';
import { thaiError } from './errors.js';
import { db, S, $, today, TH, icon, MARK } from './ui.js';
import { setupGaps } from './lib/setup.js';
import * as Tbl from './lib/table.js';
setCsvNotify(notify);
Tbl.configure({ db, today, render, beHints });
const pages = [
  ['stock', 'ขยะคงคลัง', 'คงคลัง'],
  ['deposit', 'รับฝากขยะ', 'รับฝาก'],
  ['sell', 'ขายขยะ', 'ขาย'],
  ['report', 'รายงาน', 'รายงาน'],
  ['settings', 'ตั้งค่า', 'ตั้งค่า'],
];
// One sentence, one place. แก้ไขไม่ได้ is dropped from it: a viewer is never offered a write control, so saying what
// is missing is explaining a button nobody can see.
const VIEWER_NOTE = 'บัญชีนี้ดูข้อมูลได้เท่านั้น';
// The avatar is a person, not an initial. S.cur is a full name when the profile carries one and an email
// address when it does not, so the first character was as often the `k` of a login as the first letter of
// anybody's name - a letter that identifies nothing, in a bank with two accounts. What is worth telling
// apart at a glance is which account this is, so the colour carries the role: the accent for an admin, grey
// for a viewer. It is never the only place that is said - the menu says it in words underneath - so the
// mark itself is hidden from a screen reader, which reads the address beside it instead.
const UAVATAR =
  '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-1.6A4.4 4.4 0 0 0 14.6 15H9.4A4.4 4.4 0 0 0 5 19.4V21"/><circle cx="12" cy="8" r="3.6"/></svg>';
function user() {
  return S.cur;
}
function setUser(v) {
  S.cur = v;
  renderUser();
}
// เข้าสู่ระบบในชื่อ / the address / what this account may do: three lines of one answer, in the menu that answers
// "who am I signed in as". It used to be a band across the top of every screen, which spent 40px of a phone's
// height on a sentence that does not change while anyone reads it; a viewer learns the limit the moment a
// write control is missing, and the menu is where they go to check why.
function renderUser() {
  let b = $('userbox');
  if (!b) return;
  b.innerHTML = S.cur
    ? '<button type="button" class="userbtn" aria-haspopup="menu" onclick="App.toggleUserMenu(event)"><span class="uav ' +
      (Auth.isAdmin() ? 'adm' : 'vw') +
      '" aria-hidden="true">' +
      UAVATAR +
      '</span><span class="uname">' +
      esc(S.cur) +
      '</span><svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></button><div class="umenu" id="umenu" role="menu" hidden><div class="umhead"><small>เข้าสู่ระบบในชื่อ</small><b>' +
      esc(S.cur) +
      '</b>' +
      (Auth.role() === 'viewer' ? '<small class="umrole">' + VIEWER_NOTE + '</small>' : '') +
      '</div><button type="button" role="menuitem" onclick="App.logout()">ออกจากระบบ</button></div>'
    : '<button type="button" class="userbtn" onclick="App.showLogin()"><span class="uname">เข้าสู่ระบบ</span></button>';
}
function toggleUserMenu(e) {
  e.stopPropagation();
  let m = $('umenu');
  if (m) m.hidden = !m.hidden;
}
// The setup gate: until ตั้งค่า holds the minimum a deposit or a sale needs (lib/setup.js), ตั้งค่า is the
// only screen that opens. Only a signed-in session is gated - before a sign-in the store is empty and the
// shell is hidden behind the dialog anyway, and an empty store is not the same thing as a project that
// nobody has set up yet.
function gaps() {
  // Auth.role(), not user(): the question is whether a usable profile is signed in, and S.cur is a display
  // name the shell sets a moment later.
  return Auth.role() ? setupGaps(db) : [];
}
const locked = p => p !== 'settings' && gaps().length > 0;
// Shown once per sign-in, not on every redraw: the settings screen carries the same list permanently, so
// repeating it after every save would be nagging. An admin is told to fill it in, a viewer that somebody
// else has to. Returns whether it was shown.
function setupNotice() {
  const g = gaps(),
    d = $('setup');
  if (!g.length || !d) return false;
  $('setupbody').innerHTML =
    '<p>' +
    (Auth.isAdmin()
      ? 'ยังตั้งค่าไม่ครบ เมนูอื่นจะเปิดใช้งานเมื่อตั้งค่าครบแล้ว'
      : 'ยังตั้งค่าไม่ครบ กรุณาแจ้งผู้ดูแลระบบให้ตั้งค่าให้ครบก่อน') +
    '</p><ul class="gaplist">' +
    g.map(x => '<li>' + esc(x.label) + '<small class="muted">' + esc(x.panel) + '</small></li>').join('') +
    '</ul>';
  if (!d.open) d.showModal();
  return true;
}

// The splash is the loading bar and nothing else. It covers whatever must not be seen yet: a data load at
// boot (main.js) and after a sign-in, and the signed-in screens while they are being emptied on the way out
// (logout). It is hidden by class and never removed, so it can be raised again. Raising it takes effect in
// the same frame; only hiding it fades (see .splash.out in style.css).
function showSplash() {
  let s = $('splash');
  if (s) s.classList.remove('out');
}
function hideSplash() {
  let s = $('splash');
  if (s) s.classList.add('out');
}
// Hold the bar for at least S.splashMs measured from `since`, so a fast load does not flash it. Callers do
// not await this: the remainder of the wait is cosmetic and must not delay anything the user wants.
function settleSplash(since) {
  return new Promise(r => setTimeout(r, Math.max(0, S.splashMs - (performance.now() - since)))).then(hideSplash);
}
// Email of the session that expired. The draft in #view survives the prompt, but only for the same person.
let expiredFor = null;
function loginMsg(t) {
  let m = $('lgmsg');
  if (!m) return;
  m.textContent = t || '';
  m.hidden = !t;
}
// The school's own mark, for the one screen that is drawn before there is a store to read it from. loadBrand()
// below fetches it; until then, and whenever the project has no logo, the dialog wears the default mark.
let pubLogo = '';
// The tab's icon follows the school's logo, so a bookmark, a pinned tab and the window's own strip say which
// school this is. The default is whatever index.html painted, kept so that removing the logo in ตั้งค่า brings
// it back rather than leaving the tab blank.
let favDefault = null;
function setFavicon(src) {
  let l = $('favicon');
  if (!l) return;
  favDefault ??= l.getAttribute('href') || '';
  l.setAttribute('href', src || favDefault);
}
// Read once, at boot, before the sign-in dialog opens (main.js). Never throws: see Api.publicBrand.
async function loadBrand() {
  let b = Auth.mode() === 'live' ? await Api.publicBrand() : null;
  if (!b) return;
  Auth.setSchoolName(b.school);
  pubLogo = b.logo;
  setFavicon(b.logo); // '' is an answer too: a project with no logo wears the mark index.html painted
}
function showLogin(msg) {
  let d = $('login'),
    was = d.open,
    m = Auth.mode(),
    real = m === 'live'; // Shown before sign-in, so it never reads the store: the name and the mark come from loadBrand() (or config.js), and there is nothing else to draw.
  $('lglogo').innerHTML = pubLogo
    ? '<img src="' + esc(pubLogo) + '" alt="โลโก้ ' + esc(Auth.schoolName() || 'โรงเรียน') + '">'
    : S.brand || $('brandmark').innerHTML;
  {
    let n = Auth.schoolName();
    $('lgschool').textContent = n || '';
  }
  // Whatever is already in the form is kept: an expiry prompt must not wipe what the user was typing.
  if (real && !$('lguser').value) $('lguser').value = Auth.lastSignedInEmail();
  if (!was) {
    $('lgpass').value = '';
    // Never inherited: the tick belongs to one sign-in by one person, and the next person at a shared
    // computer must not be handed the last one's answer already ticked.
    let r = $('lgremember');
    if (r) r.checked = false;
  }
  $('lguser').form.noValidate = !real;
  let expired = typeof msg === 'string';
  if (expired) d.dataset.locked = '1';
  // At boot there is nothing on screen to protect, so the dialog is not locked - but if this browser was
  // remembering someone and that deadline has passed, the form still owes them the reason it is asking.
  if (expired || !(was && d.dataset.locked))
    loginMsg(
      expired
        ? msg
        : Auth.rememberExpired()
          ? EXPIRED_MSG[Auth.WHY.deadline]
          : Auth.loginGate(m, Auth.initFailed()).message,
    );
  if (!was) {
    d.showModal();
    $('lguser').select?.();
  }
}
async function doLogin(e) {
  e.preventDefault();
  let u = $('lguser').value.trim();
  if (!u) return notify('กรอกอีเมล');
  let g = Auth.loginGate(Auth.mode());
  if (!g.allowed) return loginMsg(g.message);
  let b = e.submitter;
  if (b) b.disabled = true;
  try {
    // The checkbox decides where this session is kept: this browser only, or remembered on this device until
    // its deadline (supabase.js). Nobody can tell a staff-room computer from a teacher's own phone, so the
    // person signing in is the one who says.
    let keep = !!$('lgremember')?.checked;
    await Auth.signIn(u, $('lgpass').value, keep);
    remembering = keep;
    touch();
    let resumed = Auth.draftSurvives(expiredFor, u);
    if (expiredFor && !resumed) S.draft = [];
    expiredFor = null;
    // The bar goes up BEFORE the dialog closes, or closing it would uncover the first tab as it stood at boot -
    // drawn, stale and not yet reloaded. The dialog then closes over a screen the bar already covers, and the
    // bar stays up while the data is fetched.
    let n = Auth.fullName() || u;
    // A sign-in always starts on the first screen: whoever just signed in did not leave the app on that other
    // screen, and the restored crumb belongs to the visit that is over (Store.loadPage).
    S.page = 'stock';
    Store.savePage('stock');
    delete $('login').dataset.locked;
    loginMsg('');
    $('lgpass').value = '';
    showSplash();
    let t0 = performance.now();
    $('login').close();
    try {
      await Store.loadAll();
    } catch {
      notify('โหลดข้อมูลไม่สำเร็จ ระบบจะลองใหม่เมื่อกลับมาที่หน้านี้');
    }
    if (!resumed) render();
    setUser(n);
    settleSplash(t0);
    notify('เข้าสู่ระบบในชื่อ ' + n);
    setupNotice();
  } catch (x) {
    loginMsg(
      x && x.code === 'INACTIVE'
        ? 'บัญชีนี้ถูกปิดการใช้งาน'
        : x && (x.name === 'AuthRetryableFetchError' || x.status >= 500)
          ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองอีกครั้ง'
          : 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
    );
  } finally {
    if (b) b.disabled = false;
  }
}
// Signing out is the same shape as booting: the bar covers the screens being emptied, then gives way to the
// sign-in dialog. Nothing signed-in is ever on screen without a session behind it.
async function logout() {
  showSplash();
  let t0 = performance.now();
  await Auth.signOut().catch(() => {});
  Store.clear();
  Store.savePage('');
  expiredFor = null;
  S.draft = [];
  render();
  setUser('');
  await settleSplash(t0);
  showLogin();
}
// What every write ends with: re-read the slices it touched (plus the audit trail, which every write extends) from the
// server and redraw. Nothing here writes; the screens call it after a write has succeeded. Resolves once redrawn.
// Bounded: the write has committed by now, so a read-back that never answers must not hold the form. After S.refreshMs the screen is
// left as it is (typed values intact), the store is marked stale for the next screen change or focus, and the toast says the
// action WAS done and must not be entered again; that toast stays 15 s. A read-back that is REJECTED (dropped link, 500, PostgREST error) lands in the same place: reload() only follows a committed write, so it never says the save failed. Resolves true when the screen was redrawn from the server, false when it was not.
function reload(slices) {
  let t,
    notDrawn = () => {
      Store.markStale();
      notify('ทำรายการสำเร็จแล้ว ไม่ต้องบันทึกซ้ำ ยังอัปเดตหน้าจอไม่ได้ รายการจะแสดงเมื่อรีเฟรชครั้งถัดไป', 15000);
      return false;
    },
    late = new Promise(r => {
      t = setTimeout(() => r('late'), S.refreshMs);
    });
  return Promise.race([Store.refresh(slices && [...slices, 'audit']).then(() => 'ok'), late])
    .then(r => {
      clearTimeout(t);
      if (r === 'ok') {
        render();
        return true;
      }
      return notDrawn();
    })
    .catch(() => {
      clearTimeout(t);
      return notDrawn();
    });
}
// A failed write: the refusal in Thai. The three stock refusals mean this screen was out of date, so the next screen
// change or window focus re-reads. Never retries (see api.js).
function fail(x, o = {}) {
  if (/^WB00[123]$/.test(x && x.code)) Store.markStale();
  notify((o.prefix || '') + (o.text || thaiError(x)));
}
// An info icon answers in one place: a bubble at the icon, where the eye already is and where a click on a
// phone looks for the answer. It is not a dialog - an explanation that has to be dismissed is a dialog
// pretending to be a hint - and it is not a toast as well: the same sentence in two places at once reads as
// two answers, and the toast belongs to things that just happened, not to things being asked about. #tip
// carries role="status", so what the bubble says is what a screen reader is told.
function info(el, msg) {
  tipAt(el, msg);
}
function tipAt(el, msg) {
  let t = $('tip');
  if (!t) return;
  t.textContent = msg;
  t.hidden = false;
  // Fixed to the viewport, measured from the icon: the bubble is never clipped by the card it sits in, and it
  // needs no positioned ancestor anywhere.
  let r = el?.getBoundingClientRect?.(),
    vw = globalThis.innerWidth || 0;
  if (r && vw) {
    let w = t.offsetWidth || 280;
    t.style.left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), vw - w - 8) + 'px';
    t.style.top = r.bottom + 8 + 'px';
  }
  clearTimeout(window.tipTimer);
  window.tipTimer = setTimeout(hideTip, 7000);
}
function hideTip() {
  let t = $('tip');
  if (t) t.hidden = true;
}
function notify(msg, ms = 3500) {
  $('toast').textContent = msg;
  $('toast').hidden = false;
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => ($('toast').hidden = true), ms);
}
// The three sheets every write goes through, in one place so รับฝาก, ขาย and ตั้งค่า cannot ask differently.
//   review()     - a new slip or an edit: what will be written, what it changes, one button that writes it.
//   askReason()  - ยกเลิก: the same sheet in red, with what it undoes, a reason, and the slip number typed back.
// Both resolve only when the dialog closes, and resolve to nothing when it is dismissed, so a caller that
// awaits them never writes without an answer.
const RVICON = {
  ok: '<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.6"/>',
  warn: '<path d="M4 20h4l10-10-4-4L4 16v4z"/><path d="M14 6l4 4"/>',
  bad: '<path d="M12 4l9 16H3l9-16z"/><path d="M12 10v4M12 17.4v.2"/>',
};
const rvsvg = k =>
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
  RVICON[k] +
  '</svg>';
// tone: 'ok' a new record, 'warn' a change to one that exists. body is the summary markup (ui.js kv()/diff()).
// Resolves true when the user confirmed, false otherwise.
function review({ title, sub = '', body = '', tone = 'ok', confirm = 'ยืนยันบันทึก', cancel = 'กลับไปแก้' }) {
  return new Promise(res => {
    let d = $('review');
    if (!d) return res(false);
    $('rvico').className = 'rvico' + (tone === 'ok' ? '' : ' ' + tone);
    $('rvico').innerHTML = rvsvg(tone);
    $('rvtitle').textContent = title;
    $('rvsub').textContent = sub;
    $('rvsub').hidden = !sub;
    $('rvbody').innerHTML = body;
    $('rvok').textContent = confirm;
    $('rvcancel').textContent = cancel;
    d.returnValue = '';
    d.onclose = () => res(d.returnValue === 'ok');
    d.showModal();
    $('rvok').focus?.();
  });
}
// The sheet every ตั้งค่า panel adds and edits through, so adding a waste type and renaming a buyer are the same
// gesture: the fields over the screen, one button that goes on, one that gives up, and - when a row is open - what
// that row can be turned into (`foot`). It only collects; the panel that opened it reads the fields back and
// confirms the write with review() as any other change to master data is confirmed. Resolves true when the user
// went on, false when the sheet was dismissed.
function form({ title, sub = '', body = '', confirm = 'บันทึก', cancel = 'ยกเลิก', foot = '' }) {
  return new Promise(res => {
    let d = $('edit');
    if (!d) return res(false);
    $('edtitle').textContent = title;
    $('edsub').textContent = sub;
    $('edsub').hidden = !sub;
    $('edbody').innerHTML = body;
    $('edok').textContent = confirm;
    $('edcancel').textContent = cancel;
    $('edfoot').innerHTML = foot;
    $('edfoot').hidden = !foot;
    d.returnValue = '';
    d.onclose = () => res(d.returnValue === 'ok');
    d.showModal();
  });
}
// A footer button (ปิดใช้งาน, ลบ) acts on the row the sheet is open on, and what it does is confirmed by its own
// sheet. Two stacked dialogs would leave the user with a form over a warning, so the form goes first.
function formHide() {
  let d = $('edit');
  if (d && d.open) {
    d.returnValue = 'cancel';
    d.close();
  }
}
// reasons are the few a school actually gives, as chips; the box underneath stays, because the real reason is
// often none of them. word is the slip number the user types back when what follows cannot be undone.
function askReason(title, { impact = '', reasons = [], word = '' } = {}) {
  return new Promise(res => {
    let d = $('ask');
    $('asktitle').textContent = title;
    $('askinput').value = '';
    let im = $('askimpact');
    if (im) {
      im.innerHTML = impact;
      im.hidden = !impact;
    }
    let rs = $('askreasons');
    if (rs) {
      rs.innerHTML = reasons
        .map(r => '<button type="button" aria-pressed="false" onclick="App.pickReason(this)">' + esc(r) + '</button>')
        .join('');
      rs.hidden = !reasons.length;
    }
    let w = $('askword');
    if (w) {
      w.innerHTML = word
        ? '<label for="askconfirm">พิมพ์เลขที่ใบเพื่อยืนยัน <code>' +
          esc(word) +
          '</code></label><input id="askconfirm" autocomplete="off" placeholder="' +
          esc(word) +
          '" data-word="' +
          esc(word) +
          '">'
        : '';
      w.hidden = !word;
    }
    d.returnValue = '';
    d.onclose = () => res((d.returnValue === 'ok' && $('askinput').value.trim()) || null);
    d.showModal();
    $('askinput').focus?.();
  });
}
// The chips write into the box rather than replacing it, so what is saved is always what is in the box.
function pickReason(b) {
  let rs = $('askreasons');
  if (rs) [...(rs.querySelectorAll?.('button') || [])].forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  let i = $('askinput');
  if (i) {
    i.value = b.textContent;
    i.focus?.();
  }
}
// The one thing HTML validation cannot check: the slip number typed back has to match the slip.
function askCheck(e) {
  // Giving up needs no confirmation of any kind: the cancel button closes the sheet and nothing is written.
  // (It carries formnovalidate for the same reason, which covers the reason box but not this check.)
  if (e && e.submitter && e.submitter.value !== 'ok') return true;
  let c = $('askconfirm');
  if (c && c.value.trim() !== c.dataset.word) {
    e.preventDefault();
    notify('พิมพ์เลขที่ใบ ' + c.dataset.word + ' ให้ตรงกันก่อน จึงจะยกเลิกได้');
    c.focus?.();
    return false;
  }
  return true;
}
function go(p) {
  if (locked(p)) return notify('ตั้งค่าระบบให้ครบก่อน จึงจะใช้เมนูนี้ได้');
  S.page = p;
  Store.savePage(p);
  S.draft = [];
  render();
  window.scrollTo(0, 0);
  refreshIfStale(true);
}
// A form with typed-in values (or a sale draft) must survive a background refresh: the focus-triggered reload only redraws when nothing would be lost.
function formDirty() {
  return (
    S.draft.length > 0 ||
    [...document.querySelectorAll('#view input,#view select,#view textarea')].some(e =>
      e.type === 'checkbox' || e.type === 'radio'
        ? e.checked !== e.defaultChecked
        : e.tagName === 'SELECT'
          ? [...e.options].some(o => o.selected !== o.defaultSelected)
          : e.value !== e.defaultValue,
    )
  );
}
function refreshIfStale(redraw) {
  if (!user()) return Promise.resolve(false);
  return Store.refreshIfStale()
    .then(r => {
      if (r && (redraw === true || !formDirty())) render();
      return r;
    })
    .catch(() => {
      notify('อัปเดตข้อมูลจากเซิร์ฟเวอร์ไม่สำเร็จ ระบบจะลองใหม่เมื่อกลับมาที่หน้านี้');
      return false;
    });
}
addEventListener('focus', () => refreshIfStale());

// ---- when a signed-in browser signs itself out ------------------------------------------------------------
// Two clocks, because they answer two different situations and neither covers the other. The free Supabase
// plan has no server-side session timeout, so without these a browser that signed in once is that teacher for
// ever (docs/INSTALL.md section 8.1):
//
//   idle       the app is open and nobody has touched it for S.idleMs. The staff-room case: a teacher opens
//              the app, is called away to teach, and the screen stays as they left it. Counted in memory and
//              only while the page is open, so time with the browser closed does not count here.
//   deadline   this browser was told to remember the sign-in, and the deadline on that has passed
//              (supabase.js). Checked on the same timer, so a tab left open for days still has to sign in
//              again rather than ride on one refresh after another.
//
// Both end the session for real - the refresh token is revoked server-side - and both land on the sign-in form
// through the expiry path, so a half-filled slip survives for the same person.
let touched = Date.now(),
  ending = false,
  // Whether this browser is the kind that HAS a deadline: only a remembered one does. An un-remembered
  // session has no deadline to reach, which is not the same as a deadline of zero, so the two are kept apart.
  remembering = Auth.rememberLeft() > 0;
const touch = () => (touched = Date.now());
function sessionCheck() {
  if (ending || !user()) return;
  let why = '';
  if (Date.now() - touched >= S.idleMs) why = Auth.WHY.idle;
  else if (remembering && Auth.rememberLeft() === 0) why = Auth.WHY.deadline;
  if (!why) return;
  ending = true;
  Auth.endSession(why).finally(() => {
    ending = false;
  });
}
// A touch is any deliberate act on the page. Passive and capturing, so a click that a handler stops still
// counts, and throttled: this runs on every keystroke and may not do work on any of them.
for (const ev of ['pointerdown', 'keydown']) document.addEventListener(ev, touch, { capture: true, passive: true });
// Coming back to the tab is both a touch and the moment to check: a laptop that slept for two hours has not
// been touched, and the check that matters happens before anything is typed into a stale screen.
addEventListener('focus', () => {
  sessionCheck();
  touch();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    sessionCheck();
    touch();
  }
});
// The timer itself is started by main.js, not here, for the same reason `tick` is: a module that starts an
// interval the moment it is imported is a module that cannot be imported by a test without one running.
// Printing a register prints the register: the entry form above it, its column filters and its pager are tools
// rather than part of the document, and style.css hides them for as long as this flag is on. Both registers print
// the same way, so the flag and the listener that takes it off again live here, once, instead of once per screen.
function printRegister() {
  document.body.classList.add('printreg');
  window.print();
}
addEventListener('afterprint', () => document.body.classList.remove('printreg'));
// The browser's own date picker is always Gregorian - no locale or attribute changes that, and the popup is
// not ours to draw - so every date box gets a caption in Buddhist years underneath it. The box may read
// 2026-11-06; the line under it reads 6 พ.ย. 2569, which is the date the school writes on paper.
// Every date box on screen, not only the ones inside a form: the period bars of the two registers and the
// report are plain toolbars, and their two custom-range boxes are exactly where a year is misread.
function beHints() {
  document.querySelectorAll('#view input[type=date], #view input[type=datetime-local]').forEach(i => {
    let h = i.nextElementSibling;
    if (!h || !h.classList.contains('behint')) {
      h = document.createElement('small');
      h.className = 'behint';
      i.after(h);
    }
    h.textContent = beCaption(i.value);
  });
}
document.addEventListener('input', e => {
  if (e.target.type === 'date' || e.target.type === 'datetime-local') beHints();
});
const pageMods = {};
function registerPage(name, mod) {
  if (!pages.some(p => p[0] === name)) throw new Error('unknown page: ' + name);
  if (pageMods[name]) throw new Error('page registered twice: ' + name);
  pageMods[name] = mod;
  for (const [k, f] of Object.entries(mod.handlers || {})) {
    if (Object.hasOwn(App, k)) throw new Error('handler name already taken: ' + k);
    App[k] = f;
  }
}
function render() {
  // Being on a locked screen is not a state the app can be in: a waste type deactivated while the stock
  // screen is open moves the user to ตั้งค่า on the next redraw, rather than leaving a screen that cannot work.
  if (locked(S.page)) S.page = 'settings';
  let cur = pages.find(r => r[0] === S.page),
    on = r => r[0] === S.page || r[0] === cur[3],
    // A locked tab is a disabled button: there is no handler to call, and `disabled` is also what tells a
    // screen reader it is not a way out of here. The tooltip says why, because the label cannot.
    tab = (r, ic) =>
      locked(r[0])
        ? '<button type="button" class="lockedtab" disabled title="ตั้งค่าระบบให้ครบก่อน">' +
          (ic ? icon(r[0]) : '') +
          r[2] +
          '</button>'
        : '<button type="button" class="' +
          (on(r) ? 'on' : '') +
          '"' +
          (on(r) ? ' aria-current="page"' : '') +
          ' onclick="App.go(\'' +
          r[0] +
          '\')">' +
          (ic ? icon(r[0]) : '') +
          r[2] +
          '</button>',
    main = pages.filter(r => !r[3]);
  $('nav').innerHTML = main.map(r => tab(r)).join('');
  $('bnav').innerHTML = main.map(r => tab(r, true)).join('');
  $('schoolside').textContent = db.school;
  applyBrand();
  document.title = 'ระบบธนาคารขยะ • ' + cur[1];
  let pm = pageMods[S.page];
  $('view').innerHTML = pm.render();
  beHints();
  pm.after?.();
}
// Courtesy only: the database refuses a viewer's write whatever the screen shows (row level security). This only stops the screen offering what would be refused.
const ifAdmin = (html, viewerHtml = '') => (Auth.isAdmin() ? html : viewerHtml);
function tick() {
  let c = $('clock');
  if (!c) return;
  let d = new Date(),
    z = { timeZone: 'Asia/Bangkok' };
  c.innerHTML =
    '<svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg><span>' +
    d.toLocaleDateString(TH, { ...z, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) +
    '</span><b>' +
    d.toLocaleTimeString('th-TH', { ...z, hour: '2-digit', minute: '2-digit' }) +
    ' น.</b>';
  c.title = d.toLocaleDateString(TH, { ...z, dateStyle: 'full' });
}
// The default mark is the inline SVG in index.html, which S.brand captures on the first call here. A logo
// uploaded through Settings (app_setting.school_logo) replaces it, and the image-box styling (.mark.hasimg)
// applies only then, so removing the uploaded logo returns the app to the default mark.
function applyBrand() {
  let m = $('brandmark');
  if (!m) return;
  S.brand ||= m.innerHTML || MARK;
  // A store that knows nothing about the school - before the first load, and after a sign-out empties it - is
  // the ABSENCE of an answer, not the answer "this school has no logo". Signing out redraws the screens while
  // they are being emptied, and that redraw used to overwrite the mark and the tab icon that f_public_brand()
  // had supplied at boot: the sign-in dialog came back wearing the default mark instead of the school's.
  // Removing an uploaded logo in ตั้งค่า still reaches the lines below, because the name is still there.
  if (!db.school && !db.schoolLogo) return;
  m.classList.toggle('hasimg', !!db.schoolLogo);
  m.innerHTML = db.schoolLogo ? '<img src="' + esc(db.schoolLogo) + '" alt="โลโก้ ' + esc(db.school) + '">' : S.brand;
  // The tab's icon is part of the branding, so it changes in the same breath - including back to the default
  // the moment an uploaded logo is removed, which is why this is not inside the `if`.
  setFavicon(db.schoolLogo || '');
  pubLogo = db.schoolLogo || '';
}
// Handlers that carry a database value (a slip number, a row id) do not put it in an on*= string: the markup holds it
// in data-arg, escaped as an attribute, and this one listener reads it back as data. Only these names are reachable.
const DELEGATED = new Set([
  'depSlip',
  'typeNote',
  'voidDepSlip',
  'voidDeposit',
  'saleSlip',
  'voidSale',
  'toggleType',
  'toggleSource',
  'toggleBuyer',
  'editType',
  'editSource',
  'editBuyer',
  'editDepositor',
  'editReceiver',
  'toggleDepositor',
  'toggleReceiver',
  'priceModal',
  'todoHelp',
  'saleHelp',
]);
document.addEventListener('click', e => {
  let b = e.target?.closest?.('[data-act]'),
    f = b && DELEGATED.has(b.dataset.act) && App[b.dataset.act];
  if (!f) return;
  e.preventDefault();
  // The button itself goes with the value: an info icon has to know where to put its bubble, and the element
  // is the only thing that knows. Every other handler ignores it.
  f(b.dataset.arg, b);
});
// The single namespace inline handlers resolve through. per is only ever mutated, never reassigned, so it is the same object the modules use.
// The page modules add theirs through registerPage. render, notify, askReason, reload, fail and registerPage are for code, not for handlers.
const App = {
  $,
  ifAdmin,
  doLogin,
  go,
  logout,
  showLogin,
  toggleUserMenu,
  today,
  user,
  clearFilt: Tbl.clearFilt,
  monthPer: Tbl.monthPer,
  per: Tbl.per,
  pgReset: Tbl.pgReset,
  setFilt: Tbl.setFilt,
  setPer: Tbl.setPer,
  setPg: Tbl.setPg,
  setSort: Tbl.setSort,
  yearPer: Tbl.yearPer,
  render,
  notify,
  info,
  askReason,
  askCheck,
  pickReason,
  review,
  form,
  formHide,
  reload,
  fail,
  registerPage,
};
window.App = App;
// Not handler targets: the pieces main.js needs to boot the shell.
// One sentence per reason, because "why am I being asked again?" has three different answers and a teacher
// who gets the wrong one decides the app is broken. The deadline on a remembered device says only that it is
// time, not how long it was: a number on this form would be read as a promise.
const EXPIRED_MSG = {
  [Auth.WHY.idle]: 'ไม่ได้ใช้งานนาน ระบบออกจากระบบให้เพื่อความปลอดภัย เข้าสู่ระบบอีกครั้ง',
  [Auth.WHY.deadline]: 'ถึงกำหนดเข้าสู่ระบบอีกครั้งเพื่อความปลอดภัย',
  [Auth.WHY.server]: 'เซสชันหมดอายุ เข้าสู่ระบบอีกครั้ง',
};
Auth.onExpired(why => {
  Store.markStale();
  expiredFor = Auth.lastSignedInEmail() || null;
  remembering = false;
  setUser('');
  showLogin(EXPIRED_MSG[why] || EXPIRED_MSG[Auth.WHY.server]);
});
const shell = {
  setCurrent: v => {
    S.cur = v;
  },
  // Where the last visit was, if it was one of this app's screens and that screen is open to this project (the
  // setup gate can have closed it since). Anything else leaves S.page as it is, which is the first screen.
  restorePage() {
    const p = Store.loadPage();
    if (pages.some(r => r[0] === p) && !locked(p)) S.page = p;
    return S.page;
  },
  user,
  renderUser,
  hideTip,
  loadBrand,
  tick,
  sessionCheck,
  showSplash,
  hideSplash,
  settleSplash,
  setupNotice,
};
export { App, shell, printRegister };
