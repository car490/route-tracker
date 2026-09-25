// driver/src/autostart/autoStartState.js
//
// Pure state machine for the Driver's automatic mode. No timers, no DOM,
// no network: autoStartController.js feeds it events and acts on the result.
//
//   watching --match--> countdown --tick x10 / startNow--> starting --started--> running
//      ^                   |  |                               |                    |
//      |<------cancel------+  +--change--> paused --resume----+-- startFailed      |
//      |<------------------------------------------------------journeyEnded--------+
//
// A departure the driver said "Not now" to, handed over to the manual
// picker, already ran, or the server refused is `dismissed` for the rest of
// the day, so standing at a stop never re-offers it every 5 seconds.

export const COUNTDOWN_SECONDS = 10;

export function initialAutoStartState() {
  return { phase: 'watching', candidate: null, shiftMinutes: 0, secondsLeft: 0, dismissed: [] };
}

function dismiss(state, candidate) {
  return candidate && !state.dismissed.includes(candidate.departureId)
    ? [...state.dismissed, candidate.departureId]
    : state.dismissed;
}

export function autoStartReducer(state, event) {
  switch (event.type) {
    case 'match':
      if (state.phase !== 'watching' || state.dismissed.includes(event.candidate.departureId)) return state;
      return {
        ...state,
        phase: 'countdown',
        candidate: event.candidate,
        shiftMinutes: event.shiftMinutes ?? 0,
        secondsLeft: COUNTDOWN_SECONDS,
      };

    case 'tick':
      if (state.phase !== 'countdown') return state;
      return state.secondsLeft <= 1
        ? { ...state, phase: 'starting', secondsLeft: 0 }
        : { ...state, secondsLeft: state.secondsLeft - 1 };

    case 'startNow':
      if (state.phase !== 'countdown') return state;
      return { ...state, phase: 'starting', secondsLeft: 0 };

    case 'cancel':
      if (state.phase !== 'countdown') return state;
      return { ...state, phase: 'watching', candidate: null, shiftMinutes: 0, secondsLeft: 0, dismissed: dismiss(state, state.candidate) };

    case 'change':
      if (state.phase !== 'countdown') return state;
      return { ...state, phase: 'paused', secondsLeft: 0, dismissed: dismiss(state, state.candidate) };

    case 'started':
      if (state.phase !== 'starting') return state;
      return { ...state, phase: 'running', dismissed: dismiss(state, state.candidate) };

    case 'startFailed':
      if (state.phase !== 'starting') return state;
      return { ...state, phase: 'watching', candidate: null, shiftMinutes: 0, dismissed: dismiss(state, state.candidate) };

    case 'resume':
      if (state.phase !== 'paused') return state;
      return { ...state, phase: 'watching', candidate: null, shiftMinutes: 0 };

    case 'journeyEnded':
      if (state.phase !== 'running' && state.phase !== 'paused') return state;
      return { ...state, phase: 'watching', candidate: null, shiftMinutes: 0 };

    case 'newDay':
      return { ...state, dismissed: [] };

    default:
      return state;
  }
}
