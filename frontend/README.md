# Cross-Domain SCORM Content Player — Frontend

This is the **Domain A** half of the cross-domain SCORM demo. It is a Vue 3 (Composition API, `<script setup>`) + Vite single-page app that acts as the LMS page: it lets a user launch a SCORM course and hosts the player, while the actual SCORM content lives on a completely different domain (the API's, `https://localhost:5001`).

The demo solves the classic LMS problem — browsers block cross-origin DOM access, so a naive `<iframe>` with content on another host cannot be driven by the LMS page — the same way a real LMS does: a **nested iframe bridge** and a structured `window.postMessage` protocol.

## What this app does

- **Serves the landing page** that lists a demo course and exposes a **Launch** button which opens a new tab (`window.open`) to `/scormViewer/:moduleId`. The `window.open` happens synchronously inside the user gesture so popup blockers don't interfere.
- **Hosts the player**: `ScormViewer.vue` embeds the SCORM content frame in an `<iframe>` whose `src` points **through the API** at `https://localhost:5001/assets/scorm/disk/{assetCode}/sp_sco_loader.html` — that request is received by the API's YARP reverse proxy and served by the API itself, so the content is always shown under the API's origin, never this app's.
- **Acts as the cross-origin bridge**: the viewer listens for `postMessage` events from the content frame and responds, letting the SCORM engine on the other side of the bridge make its API calls.

### The iframe stack

```
Domain A: Vue SPA (http://localhost:8080)
│
│  ScormViewer.vue  ── window.open() ──>  /scormViewer/:moduleId
│
│  <iframe src="https://localhost:5001/assets/scorm/disk/demo-course/sp_sco_loader.html">
│              ▲ Domain B: the API (https://localhost:5001)
│              │
│              └── sp_sco_loader.html ──> <iframe id="sp_sco" src="...index.html">
│                                             (the actual SCORM content)
```

### Cross-domain bridge (`postMessage`)

| Direction | `msgtype` | Purpose |
|-----------|-----------|---------|
| Viewer → Loader | `USER_INIT_DATA` | Send module data, content launch URL, env settings |
| Loader → Viewer | `TOKEN_REQUEST` | Request an auth token for API calls |
| Viewer → Loader | `TOKEN_RESPONSE` | Return the token (demo: a static "demo-session-token") |

The viewer only posts to and accepts messages from the iframe's origin (`iframeOrigin`), which is validated on every received event.

## Source map

```
src/
  main.js                      app bootstrap (vue-router in HTML5 history mode)
  App.vue                      root component
  router.js                    routes: / → ScormLauncher, /scormViewer/:moduleId → ScormViewer
  components/
    ScormLauncher.vue          landing page; fetches /api/scorm/launchInfo, Launch button
    ScormViewer.vue            player host: loads getLaunchDetails + startScorm, renders the
                               content iframe, drives the postMessage (USER_INIT_DATA / TOKEN) bridge
```

## Dev proxy

`vite.config.js` serves the app on **port 8080** (strict) and proxies API/`assets`/`cdn` paths to `https://localhost:5001` so the browser sees all API and content traffic on the API's domain. `secure: false` is set because the API uses a self-signed dev certificate. This proxy is a dev-only convenience — in the architecture the frontend's domain never serves content.

## Running

Requirements: Node.js, and the API running on `https://localhost:5001` (see the root `README.md`).

```bash
npm install
npm run dev       # dev server on http://localhost:8080
npm run build     # production build to dist/
npm run preview   # serve the production build
```

Open `http://localhost:8080`, click **Launch SCORM Course**, then submit the quiz. The header badges show the two domains at play, and the score/lesson status are persisted to the API through the SCORM engine via the iframe bridge.