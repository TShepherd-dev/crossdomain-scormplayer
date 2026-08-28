# Cross-Domain SCORM Content Player

A demo that shows how a SCORM course can be played inside a page (**domain A**) while the actual SCORM content lives on a completely different domain (**domain B**), with the content streamed through an API reverse proxy. 

While this is not a new concept in the world of Scorm Delivery, the business scenario here was to update an existing legacy player that was running into constant hurdles handling different browser/device/os combinations, increasing security concerns around 3rd party cookies and iframes, and the business to handle scorm content being served from internal storage as well as external scorm content providers.

This solution attempts to deal with the classic LMS integration problem: browsers block cross-origin DOM access, so a naive `<iframe>` with the content on another host cannot be driven by the LMS page. The demo solves it the same way a real LMS does — with a **nested iframe bridge** and a structured `window.postMessage` protocol.

## What it demonstrates

- **Two browser domains** on screen at once: the app served by Vite (`http://localhost:8080`) and the SCORM content served through the API (`https://localhost:5001`). Domain badges in the player header make the split visible.
- **SCORM content proxied "thru" the API** with YARP: the browser asks the API for `/assets/scorm/disk/{assetCode}/...` and YARP rewrites and forwards that to the API's own content endpoint. The content never comes from the frontend's domain: localhost:8080.
- **A working SCORM runtime** (1.2 and 2004 API implementations) — `window.API` / `window.API_1484_11` conforming wrappers that persist `cmi.*` data items, compute scores, and drive the `Initialize → Run → Commit → Terminate` SCORM lifecycle.
- **A real, minimal SCORM 1.2 package** (imsmanifest.xml + a 3-question quiz) that talks to the player through the standard SCORM API.

## Architecture

```
Domain A: Vue SPA (http://localhost:8080)
│
│  ScormViewer.vue  ── window.open() ──>  /scormViewer/:moduleId
│
│  <iframe src="https://localhost:5001/assets/scorm/disk/demo-course/sp_sco_loader.html">
│
Domain B: .NET 10 API + YARP (https://localhost:5001)
│
│  YARP route: /assets/scorm/disk/{assetCode}/{**filepath}
│      └─ PathRemovePrefix ──> /cdn/asset/scorm/getContentFile/{assetCode}/{filepath}
│
│  sp_sco_loader.html ──> loads engine_slim.js + engine_12.js
│
│  <iframe id="sp_sco" src="...index.html">   (the actual SCORM content)
```

### Cross-domain bridge (`postMessage`)

| Direction | `msgtype` | Purpose |
|-----------|-----------|---------|
| Viewer → Loader | `USER_INIT_DATA` | Send module data, content launch URL, env settings |
| Loader → Viewer | `TOKEN_REQUEST` | Request an auth token for API calls |
| Viewer → Loader | `TOKEN_RESPONSE` | Return the token (demo: a static "demo-session-token") |

## Repository layout

```
frontend/                      Vue 3 + Vite app (port 8080)
  src/components/ScormLauncher.vue    landing page with Launch button
  src/components/ScormViewer.vue      iframe host + postMessage bridge
src/ScormPlayer.Api/           .NET 10 Web API (ports 5000/5001)
  Controllers/ScormController.cs       demo SCORM endpoints + content file serving
  Program.cs                            YARP config, CORS, static file serving
  data/scorm/                           SCORM engine (loader, startup, engine_slim, engine_12, engine_2004 pattern)
  data/assets/scorm/demo-course/        sample SCORM 1.2 package (quiz)
startApp.bat                   convenience script (optional)
ScormPlayer.slnx               solution file
```

## Running the demo

Prerequisites: .NET 10 SDK and Node.js.

```bash
# 1. API (https://localhost:5001, http://localhost:5000)
dotnet run --project src/ScormPlayer.Api

# 2. Frontend (http://localhost:8080)
cd frontend
npm install
npm run dev
```

Open `http://localhost:8080`, click **Launch SCORM Course**, then submit the quiz. The header badges show the two domains at play, and the score/lesson status are persisted to the API through the SCORM engine via the iframe bridge.

> The API must trust the dev certificate — run `dotnet dev-certs https --trust` once if the browser warns on 5001.
