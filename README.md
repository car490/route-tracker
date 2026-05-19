# Route Timing Tracker

A zero-dependency PWA for tracking bus routes against a timed schedule in real time. No frameworks, no build tools, no data plan needed after first load.

---

## Purpose

Drivers open the app on a phone before departure, select their service and run direction, then tap Start. The app uses the device GPS to measure distance to each upcoming stop, computes an ETA, and shows whether the run is **on time**, **early**, or **late**. Actual arrival times are recorded as each stop is passed, building a live log for the whole run.

---

## How to run the dev server

The project uses a split folder structure (`public/` for static assets, `src/` for ES modules). A zero-dependency Node server bridges both directories:

```sh
cd route-tracker
node server.js
```

Then open `http://localhost:8080` in Chrome.

> GPS and service workers require HTTPS in production. On `localhost` both work without it. To test on a phone use ngrok:
> ```sh
> ngrok http 8080
> ```
> Open the `https://…ngrok-free.app` URL in Chrome on the phone.

---

## How to install the PWA

### Android (Chrome)
1. Open the HTTPS URL in Chrome.
2. Tap **⋮ → Add to Home screen → Install**.

### iOS (Safari)
1. Open the HTTPS URL in Safari.
2. Tap the **Share** icon → **Add to Home Screen → Add**.

Once installed, the app launches from the home screen icon and runs fully offline — GPS still works as it is a hardware API that does not need network.

> **Icons:** Place `icon-192.png` and `icon-512.png` in `public/icons/` to satisfy the manifest. Without them the PWA installs but shows a browser-default icon.

---

## Using the app

### 1 — Picker screen
On launch the app shows a picker with two dropdowns:

| Field | Description |
|---|---|
| **Service** | Populated from the route keys in `schedule.json` (e.g. S125S, S116S) |
| **Run** | AM or PM — defaults to AM before noon, PM from noon onwards |

Tap **Start** to begin tracking.

### 2 — Tracker screen
The tracker screen has four sections, top to bottom:

**Route header** — service number in a dark blue badge, followed by the first and last stop of the selected run in white.

**Status card** — updates on every GPS fix:
- Next stop name
- Scheduled arrival time and computed ETA
- Delta (e.g. `+2m` or `−1m`) coloured green / amber / red
- Distance to next stop and current speed

**Progress bar** — shows position through the run from first to last stop.

**Stop list** — scrollable list of all stops with scheduled time and actual arrival time filled in as each stop is passed. The current next stop is highlighted and auto-scrolled into view.

### Status colours
| Colour | Meaning |
|---|---|
| Green border | On time (within ±2 minutes of schedule) |
| Red border | Late (more than 2 minutes behind) |
| Amber border | Early (more than 2 minutes ahead) |

### Stop advancement
The app advances to the next stop automatically when GPS places the vehicle within **30 metres** of the current next stop. No interaction needed.

### Wake lock
The app requests a screen wake lock on start so the display stays on throughout the run.

---

## File structure

```
route-tracker/
├── server.js             # Zero-dependency dev server (Node built-ins only)
├── public/
│   ├── index.html        # App shell — picker and tracker UI, SW registration
│   ├── style.css         # Dark high-contrast theme, status classes, stop list
│   ├── manifest.json     # PWA manifest
│   └── service-worker.js # Cache-first offline strategy (versioned cache)
├── src/
│   ├── schedule.json     # All routes, keyed by service number
│   ├── geo.js            # Pure haversine(lat1,lon1,lat2,lon2) → metres
│   ├── engine.js         # Pure computeTiming({…}) → {status, eta, …}
│   ├── gps.js            # navigator.geolocation wrapper; records arrivals
│   ├── ui.js             # DOM updater — status card, progress bar, stop list
│   └── main.js           # Entry point: picker logic, wake lock, GPS start
└── tests/
    └── engine.test.js    # Jest-compatible unit tests for the timing engine
```

### Data flow

```
GPS fix
  └─► gps.js  (haversine distance, 30m stop advancement, arrival timestamps)
        └─► engine.js  (pure: ETA, minutesDifference, status)
              └─► ui.js  (status card, progress bar, stop list)
```

Each module is a pure ES module with no circular imports. `gps.js` is the only layer with side effects (geolocation watch, clock reads).

---

## Schedule format

`src/schedule.json` is keyed by service number. Each service has an `am` and `pm` run:

```json
{
  "S125S": {
    "am": {
      "service": "S125S",
      "stops": [
        { "name": "Stop Name", "lat": 52.807997, "lon": -0.083951, "time": "07:27" }
      ]
    },
    "pm": {
      "service": "S125S",
      "stops": [ ... ]
    }
  }
}
```

Stop coordinates are sourced from the NaPTAN database via bustimes.org.

### Current routes

| Service | AM | PM |
|---|---|---|
| S125S | Weston → Boston College (23 stops) | Boston College → Weston (23 stops) |
| S116S | Boston Bus Station → Donington (30 stops) | Donington → Boston Bus Station (30 stops) |

---

## Adding a new route

1. Add a new key to `src/schedule.json` following the format above.
2. Look up stop coordinates from [bustimes.org](https://bustimes.org) (NaPTAN data).
3. Restart the server — the new service appears in the picker dropdown automatically.

No code changes required.

---

## How to run the tests

The tests use Jest's `describe`/`test`/`expect` API with ES modules. Jest is a dev-only tool and is not part of the app bundle.

```sh
npm init -y
npm install --save-dev jest @jest/globals

npx jest --experimental-vm-modules tests/engine.test.js
```

`engine.js` is a pure function with no browser APIs so it runs in Node without any mocking.

---

## Updating cached assets

When any source file changes, bump the cache version in `public/service-worker.js`:

```js
const CACHE_NAME = 'route-tracker-v2';  // increment on each deployment
```

The old cache is deleted automatically on the next online visit.

---

## How to extend

| Goal | Where to change |
|---|---|
| Add a new route | `src/schedule.json` — new service key with `am`/`pm` stops |
| Change late/early tolerance | `lateAllowanceMin` in `src/main.js` |
| Change stop-advance radius | The `30` metre threshold in `src/gps.js` |
| Change cache strategy | Fetch handler in `public/service-worker.js` |
| Add new UI elements | `public/index.html` + `src/ui.js` |
