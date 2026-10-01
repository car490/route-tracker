// announce/src/idleScreen.js
//
// The one rule for showing the idle screen: never while the sign is showing.
// #onboard-idle is drawn on top of #onboard-sign (onboard.html/onboard.css),
// so showing it during a trip covers what passengers need to see — found live
// on a Solo, 2026-10-01 ("This stop is …" covered mid-trip; the terminus
// message covered seconds after the last stop). Only a journey end, which
// hides the sign first (onboard.js's onJourneyEnd), brings the idle screen
// back. The next-departure line and the logo can still be updated behind the
// sign; they show when it ends.
//
// Takes the three elements (anything with a `hidden` property), so it is
// tested without a DOM. Returns whether the idle screen is now showing.
export function showIdleUnlessSignShowing({ idle, sign, brand }) {
  if (!sign.hidden) return false;
  idle.hidden = false;
  brand.hidden = false; // undo showSleepScreen()'s hide, if it ran
  return true;
}
