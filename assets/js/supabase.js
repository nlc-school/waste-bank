'use strict';
// Supabase client. Never throws at load: a missing, unreadable or placeholder config.js, or an
// unreachable CDN, leaves `client` null so the page still boots and the login dialog can say why in
// Thai. config.js and the SDK are imported dynamically for that reason (a static import of either
// would turn a missing file into a blank page). The SDK import goes through the SDK constant and the
// module uses top-level await, so the module graph waits for the CDN to answer or fail.
//
// `status` keeps "no config" apart from "config is fine but the SDK would not load":
//   'ready'       client created
//   'noconfig'    config.js missing or placeholder
//   'unreachable' valid config, SDK import failed
const SDK = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

// ---- where the session is kept, and for how long --------------------------------------------------------
// supabase-js on its own keeps the session in localStorage and refreshes it forever, so a browser that signed
// in once stays signed in as that teacher after it is closed and reopened. On a school's shared computer that
// is the exposure, and no setting in the database can see it: the token is a genuine admin's token. The free
// Supabase plan has no server-side session timeout to lean on either, so the two clocks are ours:
//
//   NOT remembered (the default)  the session lives in sessionStorage and dies with the tab. Closing the
//                                 browser on a shared computer signs that browser out, with nothing to wait for.
//   remembered                    the session lives in localStorage, with a hard deadline REMEMBER_MS after
//                                 signing in. Past it, the stored session is wiped before supabase-js is ever
//                                 given it, so the deadline cannot be extended by using the app.
//
// The deadline is from the sign-in, not from the last use: a sliding window on a lost phone never closes.
// `app.js` holds the other clock (idle while the app is open) and `auth.js` ends the session for both.
export const REMEMBER_MS = 24 * 60 * 60 * 1000;
const RK = 'school-waste-bank-remember'; // the deadline, not a token; never one of the prototype's keys
// Every access is wrapped: storage throws in a private window, and a session that cannot be stored must
// still leave a usable app (it simply does not survive the page).
const safe = (f, d = null) => {
  try {
    return f();
  } catch {
    return d;
  }
};
const ls = () => safe(() => globalThis.localStorage, null);
const ss = () => safe(() => globalThis.sessionStorage, null);
const until = () => +(safe(() => ls()?.getItem(RK)) || 0);
const remembered = () => until() > Date.now();
// True when the browser WAS remembering someone and the deadline has since passed: the one case where the
// sign-in form should explain itself rather than appear out of nowhere (app.js words it).
let deadlinePassed = false;
export const rememberExpired = () => deadlinePassed;
// Drops the stored session from both storages. Called when the deadline passes and when a sign-in says not to
// remember this device, so a tick followed by an untick leaves nothing behind in localStorage.
function wipe(store) {
  const s = store;
  if (!s) return;
  safe(() => {
    for (const k of Object.keys(s)) if (/^sb-|supabase\.auth\.token/.test(k)) s.removeItem(k);
  });
}
// Runs once, at load, before createClient: an expired deadline is cleared here, so the SDK is handed nothing.
if (until() > 0 && !remembered()) {
  deadlinePassed = true;
  safe(() => ls().removeItem(RK));
  wipe(ls());
}
// Which storage the session belongs in RIGHT NOW. Decided per call rather than once, because the answer
// changes at the moment of signing in (setRemember below) and the client is made long before that.
const pick = () => (remembered() ? ls() : ss());
export const authStorage = {
  getItem: k => {
    // A copy in localStorage outlives nothing: either this device is remembered, or that copy is the remains
    // of a deadline that has passed and is cleared here as well as at load. The invariant is worth keeping
    // exactly: a session sits in localStorage only while this device is being remembered.
    if (!remembered()) safe(() => ls()?.removeItem(k));
    return safe(() => pick()?.getItem(k) ?? null, null);
  },
  setItem: (k, v) => {
    safe(() => pick()?.setItem(k, v));
    // Never two copies: the one in the other storage would outlive this choice.
    safe(() => (remembered() ? ss() : ls())?.removeItem(k));
  },
  removeItem: k => {
    safe(() => ls()?.removeItem(k));
    safe(() => ss()?.removeItem(k));
  },
};
// Called by auth.js immediately before signInWithPassword, so the session the SDK is about to write lands in
// the storage this sign-in asked for.
export function setRemember(on) {
  deadlinePassed = false;
  if (on) safe(() => ls().setItem(RK, String(Date.now() + REMEMBER_MS)));
  else {
    safe(() => ls().removeItem(RK));
    wipe(ls());
  }
}
// How long this device may stay signed in without the password, in ms; 0 when it is not remembering anyone.
// app.js checks it on the same timer as the idle clock, so a tab left open for days still has to sign in again.
export const rememberLeft = () => Math.max(0, until() - Date.now());
// Test seam, like auth.js _useMode: the load-time decision cannot be re-run inside one process, and the
// sentence the sign-in form owes a teacher whose deadline passed while the browser was shut is worth a test.
export function _useRememberExpired(v) {
  deadlinePassed = !!v;
}

export function looksConfigured(url, key) {
  const ok = v => typeof v === 'string' && v.trim() !== '' && !/PASTE|YOUR[-_]|<|>/i.test(v);
  return ok(url) && ok(key) && /^https?:\/\/[^\s]+$/.test(url.trim()) && key.trim().length >= 20;
}

// What the UI may do. There is no offline or sample mode (spec 6.3): only a ready client can sign anyone
// in, and a missing config or an SDK failure is a hard error on every host.
export function resolveMode(status) {
  if (status === 'ready') return 'live';
  if (status === 'unreachable') return 'blocked-unreachable';
  return 'blocked-unconfigured';
}

let client = null,
  status = 'noconfig',
  configError = '';
try {
  const cfg = await import('../../config.js');
  if (looksConfigured(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY)) {
    try {
      const { createClient } = await import(SDK);
      client = createClient(cfg.SUPABASE_URL.trim(), cfg.SUPABASE_ANON_KEY.trim(), {
        auth: { storage: authStorage, persistSession: true, autoRefreshToken: true },
      });
      status = 'ready';
    } catch (e) {
      status = 'unreachable';
      configError = String((e && e.message) || e);
    }
  } else configError = 'config.js still holds placeholder values';
} catch (e) {
  configError = String((e && e.message) || e);
}
const configured = status === 'ready';
export { client, configured, configError, status };
