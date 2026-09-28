// driver/src/autostart/autoStartOverlay.js
//
// The countdown panel shown when automatic mode matches a departure
// (index.html #autostart-overlay, style.css "Automatic start"). Plain
// English, large buttons, text only: every value is set with textContent,
// never innerHTML, since service and stop names come from the database.

export const OVERLAY_IDS = Object.freeze([
  'autostart-overlay', 'as-title', 'as-service', 'as-detail', 'as-countdown', 'as-message',
  'as-start-now', 'as-change', 'as-cancel',
]);

const BUTTONS = ['as-start-now', 'as-change', 'as-cancel'];

export function createAutoStartOverlay(doc = globalThis.document) {
  const el = Object.fromEntries(OVERLAY_IDS.map((id) => [id, doc.getElementById(id)]));
  let handlers = {};
  let showingError = false;

  function reset() {
    showingError = false;
    el['as-title'].textContent = 'Starting automatically';
    el['as-countdown'].hidden = false;
    el['as-message'].hidden = true;
    el['as-message'].textContent = '';
    el['as-start-now'].hidden = false;
    el['as-change'].hidden = false;
    el['as-cancel'].textContent = 'Not now';
    for (const id of BUTTONS) el[id].disabled = false;
  }

  function seconds(n) {
    return `Starting in ${n} ${n === 1 ? 'second' : 'seconds'}`;
  }

  el['as-start-now'].addEventListener('click', () => handlers.onStartNow?.());
  el['as-change'].addEventListener('click', () => handlers.onChange?.());
  el['as-cancel'].addEventListener('click', () => {
    if (showingError) { el['autostart-overlay'].hidden = true; reset(); return; }
    handlers.onCancel?.();
  });

  return {
    bind(next) { handlers = next; },

    showCountdown(candidate, secondsLeft) {
      reset();
      el['as-service'].textContent = `${candidate.serviceCode} · ${candidate.label}`;
      el['as-detail'].textContent = `Departs ${candidate.departureTime} from ${candidate.firstStopName}`;
      el['as-countdown'].textContent = seconds(secondsLeft);
      el['autostart-overlay'].hidden = false;
      el['as-start-now'].focus();
    },

    updateCountdown(secondsLeft) {
      el['as-countdown'].textContent = seconds(secondsLeft);
    },

    showStarting(candidate) {
      el['as-countdown'].textContent = `Starting ${candidate.serviceCode}…`;
      for (const id of BUTTONS) el[id].disabled = true;
    },

    showError(message) {
      reset();
      showingError = true;
      el['as-title'].textContent = 'Automatic start stopped';
      el['as-countdown'].hidden = true;
      el['as-message'].textContent = message;
      el['as-message'].hidden = false;
      el['as-start-now'].hidden = true;
      el['as-change'].hidden = true;
      el['as-cancel'].textContent = 'Close';
      el['autostart-overlay'].hidden = false;
    },

    hide() {
      el['autostart-overlay'].hidden = true;
      reset();
    },
  };
}
