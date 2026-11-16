'use strict';
// Sign-in and role awareness. Roles come from the profile table (the same rows is_admin() reads in
// the database), never from the JWT. DOM-free.
import {
  client as realClient,
  configured as realConfigured,
  configError,
  status as realStatus,
  resolveMode,
  setRemember,
  rememberExpired,
  rememberLeft,
} from './supabase.js';

const COLS = 'id,full_name,role,is_active';
let client = realClient,
  configured = realConfigured,
  status = realStatus;
let sess = null,
  prof = null,
  lastEmail = '';
let transient = false; // see initFailed()
let live = false; // true while a session exists that could still expire
let leaving = false; // signOut() in progress: its SIGNED_OUT is not an expiry
const cbs = new Set();
let unsub = null;

export { configError };
// What the sign-in dialog calls the school. The project is the ONLY source: app.js reads it at boot through
// Api.publicBrand() and sets it here, so a school that renames itself in ตั้งค่า renames itself on the dialog
// too, with nothing to redeploy. config.js used to carry a SCHOOL_NAME as a fallback and no longer does: a
// second copy of the name is a copy that goes stale, and the one state it covered - a project that answers a
// sign-in but not f_public_brand() - is the state ต้องเป็นผู้ดูแลระบบ describes, fixed by applying 005. The
// dialog then shows no name rather than a wrong one. This never reads the store either: there is no store
// before anyone signs in.
let nameOverride = null;
export const schoolName = () => nameOverride ?? '';
export function setSchoolName(n) {
  if (typeof n === 'string' && n.trim()) nameOverride = n.trim().slice(0, 150);
}
export function _useSchoolName(n) {
  nameOverride = n;
} // test seam, like _useMode / _useClient
export const isConfigured = () => configured;
// True when init() found a stored session but could not fetch its profile (network / transport error).
export const initFailed = () => transient;
// 'live' | 'blocked-unconfigured' | 'blocked-unreachable'. Only 'live' may talk to Supabase or sign anyone in.
export const mode = () => resolveMode(status);
// Who is signed in at page load: the stored session's profile name, and nobody in any other mode.
export function initialUser(m, { name, hasSession }) {
  return m === 'live' && hasSession ? name || '' : '';
}
// The sign-in dialog's decisions, as pure functions so they can be tested without a DOM (app.js only draws them).
export const LOGIN_BLOCK = {
  'blocked-unconfigured': 'ยังไม่ได้ตั้งค่าระบบ ไม่สามารถเข้าสู่ระบบได้',
  'blocked-unreachable': 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองอีกครั้ง',
};
// May anyone sign in, and what does the dialog say? Only a 'live' mode may sign in. The message is the block reason
// for a blocked mode, the connection message when init() could not reach the server, and '' otherwise.
export function loginGate(m, initFailed = false) {
  return { allowed: m === 'live', message: LOGIN_BLOCK[m] || (initFailed ? LOGIN_BLOCK['blocked-unreachable'] : '') };
}
// After a session expired, does the half-filled work in #view belong to whoever signs in next? Only the same person
// (email compared case-insensitively) keeps it; nobody has a draft to keep when no session expired.
export function draftSurvives(expiredFor, typedEmail) {
  return !!expiredFor && expiredFor.toLowerCase() === String(typedEmail).toLowerCase();
}
export function _useMode(st) {
  status = st;
}
export const session = () => sess;
export const profile = () => prof;
export const lastSignedInEmail = () => lastEmail;
// A deactivated profile is "not signed in" here, matching is_signed_in() in the database.
const usable = () => !!(sess && prof && prof.is_active === true);
export const role = () => (usable() && (prof.role === 'admin' || prof.role === 'viewer') ? prof.role : null);
export const fullName = () => (usable() ? prof.full_name : null);
export const isAdmin = () => role() === 'admin';

export function onExpired(cb) {
  cbs.add(cb);
  return () => cbs.delete(cb);
}

// Why a session ended, for the one sentence the sign-in form shows. 'server' is the ordinary case - the token
// was refused - and the other two are this app's own clocks (see endSession and supabase.js).
export const WHY = { server: 'server', idle: 'idle', deadline: 'deadline' };

// The one place that fires the callbacks. `live` makes it once per session: a burst of failing calls
// plus the SIGNED_OUT that follows must produce a single prompt, not one per call.
function expire(why = WHY.server) {
  if (!live) return;
  live = false;
  sess = null;
  prof = null;
  for (const cb of [...cbs]) {
    try {
      cb(why);
    } catch {
      /* a bad listener must not stop the others */
    }
  }
}

// This app's own clocks decided the session is over: too long untouched, or the remembered device reached its
// deadline (app.js holds both). It is a real sign-out, not a hidden one - the refresh token is revoked at the
// server, so the browser cannot carry on with what is in its storage - and it then goes down the SAME path an
// expiry takes, because to whoever is at the screen it is the same event: the sign-in form over the work, the
// half-filled slip kept for the same person. `leaving` keeps supabase-js's own SIGNED_OUT from prompting
// first, so the reason below is the one that reaches the form.
export async function endSession(why = WHY.idle) {
  if (!live) return;
  leaving = true;
  try {
    if (client) await client.auth.signOut();
  } catch {
    /* no network: the local session still has to end */
  } finally {
    leaving = false;
    lastEmail = sess?.user?.email || lastEmail;
    expire(why);
  }
}

// Was this browser remembering someone whose deadline has since passed? supabase.js wipes that session before
// the SDK ever sees it; this is what lets the form say why it is asking rather than appear out of nowhere.
export { rememberExpired, rememberLeft };

export function isExpiry(err, status) {
  if (status === 401) return true;
  if (!err) return false;
  return err.status === 401 || err.code === 'PGRST301' || /jwt expired/i.test(err.message || '');
}
// Wrap any supabase-js call (awaitable returning {data,error,status}) so a 401 / PGRST301 is noticed.
export async function guard(p) {
  const res = await p;
  if (res && isExpiry(res.error, res.status)) expire();
  return res;
}

function attach() {
  if (unsub) {
    unsub();
    unsub = null;
  }
  if (!client) return;
  const { data } = client.auth.onAuthStateChange((ev, s) => {
    // No client calls in here: supabase-js deadlocks if the callback awaits another auth/db call.
    if (ev === 'SIGNED_OUT') {
      if (leaving) {
        sess = null;
        prof = null;
        live = false;
      } else expire();
    } else if (s) sess = s;
  });
  unsub = () => data.subscription.unsubscribe();
}

// Test seam: swap in a stub client and reset every piece of state.
export function _useClient(c) {
  client = c;
  configured = !!c;
  transient = false;
  status = c ? 'ready' : 'noconfig';
  sess = null;
  prof = null;
  lastEmail = '';
  live = false;
  leaving = false;
  cbs.clear();
  attach();
}

async function loadProfile(uid) {
  const { data, error, status: http } = await guard(client.from('profile').select(COLS).eq('id', uid).maybeSingle());
  // The response status is not on the PostgrestError, so judge expiry here where both are in hand. guard() has
  // already run expire(); do not rethrow it as if it were a connection problem.
  if (error && isExpiry(error, http)) {
    prof = null;
    return null;
  }
  if (error) throw error;
  prof = data || null;
  return prof;
}

// Resolve an already stored session at page load. Resolves quietly when nothing is signed in.
export async function init() {
  if (!client) return null;
  attach();
  const { data } = await client.auth.getSession();
  if (!data || !data.session) return null;
  sess = data.session;
  live = true;
  lastEmail = sess.user?.email || '';
  transient = false;
  try {
    await loadProfile(sess.user.id);
  } catch (e) {
    // An expired JWT (401) was already handled by expire() and its callbacks inside guard(); it is not a
    // connection problem and must not be reported as one. Anything else: could not ask, keep the session.
    if (!isExpiry(e, e?.status)) transient = true;
    return null;
  }
  // The profile WAS fetched and is missing or inactive: end the session rather than leave it half signed in.
  if (!live) return null; // expired while loading: expire() already prompted
  if (!usable()) {
    await signOut();
    return null;
  }
  return prof;
}

// `remember` is the sign-in form's checkbox: it decides WHERE the session about to be written is kept, so it
// has to be set before the SDK writes anything (supabase.js setRemember / authStorage).
export async function signIn(email, password, remember = false) {
  if (!client) throw new Error('not configured');
  setRemember(!!remember);
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  sess = data.session;
  lastEmail = email;
  live = true;
  transient = false;
  await loadProfile(data.user.id);
  if (!usable()) {
    // no profile row, or deactivated: the database would refuse everything anyway
    await signOut();
    const e = new Error('inactive');
    e.code = 'INACTIVE';
    throw e;
  }
  return prof;
}

export async function signOut() {
  leaving = true;
  setRemember(false); // signing out un-remembers the device: the next sign-in says so again for itself
  try {
    if (client) await client.auth.signOut();
  } finally {
    sess = null;
    prof = null;
    live = false;
    leaving = false;
  }
}
attach();
