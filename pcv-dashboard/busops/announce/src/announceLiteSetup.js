// src/announceLiteSetup.js
//
// BusOps Announce Lite — one-time device-token commissioning. Same pattern
// as announceLink.js's captureAnnounceSetup(): a kiosk device isn't
// guaranteed to be reopened with its original ?announce-device-token=<jwt>
// query string on every load (browser restart, kiosk-mode reload, etc.), so
// the token is captured once and persisted, not re-read from the URL each
// time. Storage is injectable (defaults to the real browser API), same
// pattern used throughout this app, for DOM-free unit testing.
const STORAGE_TOKEN_KEY = 'announceDeviceToken';

export function captureAnnounceDeviceSetup(params, storage = globalThis.localStorage) {
  const token = params.get('announce-device-token');
  if (token) storage.setItem(STORAGE_TOKEN_KEY, token);
}

export function getAnnounceDeviceToken(storage = globalThis.localStorage) {
  return storage.getItem(STORAGE_TOKEN_KEY);
}
