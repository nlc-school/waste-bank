'use strict';
// Entry point. Importing app.js builds the shell and registers window.App; this file only boots it.
import { App, shell } from './app.js';
import './pages/stock.js';
import './pages/deposit.js';
import './pages/sell.js';
import './pages/report.js';
import './pages/settings.js';
import * as Auth from './auth.js';
import * as Store from './store.js';

// The loading bar must never be a dead end: if the boot below hangs (a stored session whose profile fetch
// never answers) drop it anyway, rather than leave the bar turning for ever.
setTimeout(shell.hideSplash, 9000);

// The bar is up from the markup, so it is the first thing on screen whoever opens the app. What follows it
// depends on who is signed in: a stored session keeps it up while that session's data arrives, then lands on
// the first tab; with nobody signed in there is nothing to load, so the bar drops and the sign-in dialog
// opens over an empty screen. The load that follows a sign-in raises the bar again (doLogin in app.js).
try {
  await Auth.init();
} catch {}
// The sign-in dialog names the school and wears its mark, and both come from the project itself rather than
// from config.js (app.js loadBrand, through the one function `anon` may call). Started here so it travels
// while the splash is still up, and awaited only on the path that opens that dialog; a restored session gets
// the same two values from the store a moment later, through applyBrand.
const brand = shell.loadBrand().catch(() => {});
shell.setCurrent(Auth.initialUser(Auth.mode(), { name: Auth.fullName(), hasSession: !!Auth.session() }));
const restoring = !!shell.user();
if (restoring) {
  try {
    await Store.loadAll();
  } catch {
    App.notify('โหลดข้อมูลไม่สำเร็จ ระบบจะลองใหม่เมื่อกลับมาที่หน้านี้');
  }
  // A reload lands back on the screen this session was last on, which is the one thing the app remembers between
  // loads. It happens AFTER the data is in: the setup gate decides whether that screen is open at all, and it can
  // only decide once it can see what the project holds. A sign-in starts on the first screen instead (app.js).
  shell.restorePage();
}
App.render();
shell.renderUser();
shell.tick();
setInterval(shell.tick, 15000);
// The idle clock and the remembered-device deadline (app.js sessionCheck). Every minute is fine for both: a
// minute late on an hour is nothing, and the check costs two comparisons.
setInterval(shell.sessionCheck, 60000);
document.addEventListener('click', e => {
  let m = App.$('umenu');
  if (m) m.hidden = true;
  // The icon's own click is what opened the bubble, and app.js's delegated listener runs before this one.
  if (!e?.target?.closest?.('.linfo')) shell.hideTip();
});
// performance.now() counts from navigation, so settleSplash(0) holds the bar for S.splashMs from the moment
// the page opened rather than from the moment the data landed. A restore does not await it: the rest of the
// wait is cosmetic. A sign-in does, so the dialog opens after the bar has gone rather than over it.
if (restoring) shell.settleSplash(0).then(shell.setupNotice);
else {
  await shell.settleSplash(0);
  await brand;
  App.showLogin();
}
