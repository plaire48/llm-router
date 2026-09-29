import {assertBrowserPolicy} from './browser-policy.js';
import {publicSourceURL} from './browser-public-url.js';

export function browserURL(value) {
  assertBrowserPolicy(value);
  let url; try {url = new URL(value);} catch {throw new Error('page_restricted');}
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
    url.hostname === 'auth.openai.com' || url.hostname === 'epsso.samsung.net' ||
    (url.hostname === 'aipro.sdsdev.co.kr' && url.pathname.startsWith('/auth/')) ||
    (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.pathname.startsWith('/auth'))) throw new Error('page_restricted');
  return url;
}

// Only known public resource identifiers survive display redaction. Arbitrary
// search/filter parameters can contain personal data or authentication values.
export function sourceURL(value) {
  try {return publicSourceURL(browserURL(value).href);} catch {return null;}
}

// Verification must never compare redacted display URLs: distinct resources
// can share a pathname. Keep query and fragment, and return only a boolean.
export function exactBrowserURL(expected, actual) {
  try {return browserURL(expected).href === browserURL(actual).href;} catch {return false;}
}

// Host-only comparison feedback. Never return URL values, query keys or hashes.
// The first differing component explains failure without weakening full href
// equality or letting display redaction become resource identity.
export function compareBrowserURL(expected, actual) {
  const parsed = [];
  for (const [side, value] of [['expected', expected], ['actual', actual]]) {
    try {new URL(value);} catch {return {passed: false, reason: `url_${side}_invalid`};}
    try {parsed.push(browserURL(value));} catch {return {passed: false, reason: `url_${side}_restricted`};}
  }
  const [left, right] = parsed;
  if (left.href === right.href) return {passed: true};
  const component = [['origin', 'origin'], ['path', 'pathname'], ['query', 'search'], ['fragment', 'hash']]
    .find(([, property]) => left[property] !== right[property])?.[0];
  return {passed: false, reason: `url_${component || 'identity'}_mismatch`,
    ...(sourceURL(left.href) === sourceURL(right.href) ? {redactedDifference: true} : {})};
}

// Page identity without the query or fragment. Observation URLs hide query
// values, so a model can state this honestly where url_is cannot pass. The
// result says that the query was not compared; it is never resource identity.
export function comparePageURL(expected, actual) {
  const parsed = [];
  for (const [side, value] of [['expected', expected], ['actual', actual]]) {
    try {new URL(value);} catch {return {passed: false, reason: `url_${side}_invalid`};}
    try {parsed.push(browserURL(value));} catch {return {passed: false, reason: `url_${side}_restricted`};}
  }
  const [left, right] = parsed;
  if (left.origin !== right.origin) return {passed: false, reason: 'url_origin_mismatch'};
  if (left.pathname !== right.pathname) return {passed: false, reason: 'url_path_mismatch'};
  // A public resource identifier that the display reference keeps (a video or
  // article id) is part of the page identity: two videos share one path.
  if (sourceURL(left.href) !== sourceURL(right.href)) return {passed: false, reason: 'url_identifier_mismatch'};
  return {passed: true};
}

// An observation shows a destination without its hidden query. When the
// expected value is exactly such a display reference, the link is compared as
// one and the result says that the query was not compared. An expected value
// that carries its own query or fragment is still compared exactly.
export function compareLinkURL(expected, actual) {
  const exact = compareBrowserURL(expected, actual);
  if (exact.passed || exact.redactedDifference !== true) return exact;
  let shown; try {shown = sourceURL(expected) === browserURL(expected).href;} catch {shown = false;}
  return shown ? {passed: true, matched: 'origin_path', queryCompared: false} : exact;
}

export const URL_VERIFICATION_GUIDE = 'url_page_is compares the origin, path and shown public identifier of the current top-level page and states that the rest of the query was not compared: use it when the observed URL is a redacted display reference. url_is compares the CURRENT TOP-LEVEL PAGE URL, including query and fragment, not a link destination or just origin/path. To check an observed anchor use link_destination with its current ref; do not repeat url_is for links. Observation URLs are redacted display references and can hide differences; never reconstruct missing parameters or infer exact identity from them. A URL mismatch does not prove an earlier browser action failed. Inspect the typed reason and current evidence, then correct only the verification. Preserve every original requirement: use requested visible outcomes when exact URL identity was not required, but never drop an explicitly required URL/resource condition. Do not repeat earlier writes or ask the user merely to repair a technical URL check.';

export const LINK_VERIFICATION_GUIDE = 'link_page_is compares the origin, path and shown public identifier of one freshly observed anchor ref and states that the rest of the query was not compared: use it when the observed destination is a redacted display reference. link_destination compares the exact HTTP(S) href of one freshly observed anchor ref, including query and fragment, without clicking. It does not compare the current page URL. Re-observe a changed or incompatible target and correct only the check; do not navigate or replay actions to make verification pass. Destination display hints can be redacted: never reconstruct missing parameters. Passing identifies that link only, not advertising status, result rank, destination content or final answer completeness.';
