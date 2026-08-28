<!--
    ScormViewer.vue - the "host window" for a SCORM session.

    This component is opened in its own browser tab (window.open from the
    launcher) and does the real work of the cross-domain story:

      1. Resolve the SCORM asset code for the module (from the API).
      2. Embed sp_sco_loader.html in an iframe, fetched from the API's own
         origin through YARP - i.e. a DIFFERENT origin than this page (which
         runs on the Vue dev server at 8080).
      3. Once that iframe loads, boot the session server-side (startScorm,
         recordAttempt) and post USER_INIT_DATA into the loader.
      4. Answer the loader's TOKEN_REQUEST / TOKEN_RESPONSE handshake so the
         engine can attach an Authorization header to its API calls.

    All cross-frame traffic is window.postMessage: neither frame can touch the
    other's DOM because they are different origins. The two domain chips in the
    UI make that difference visible.
-->
<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
// :moduleId comes from the route, e.g. /scormViewer/demo-001
const moduleId = route.params.moduleId

const scormLoaderUrl = ref('')     // iframe src (thru YARP on the API origin)
const isIframeReady = ref(false)   // true once we have a URL for the iframe
const loading = ref(true)          // overlay spinner toggle
const scormRunning = ref(false)    // set once the session is started
const error = ref(null)            // fatal errors surface in the UI bar
const iframeOrigin = ref('')       // origin of the loader iframe (the "other domain")
const browserDomain = window.location.origin  // THIS window's origin (the app domain)

// Direct API origin. In the real product this comes from app config/env; the
// demo hard-codes it. The viewer calls the API directly (not via the Vite
// proxy), which is why the API CORS policy lists 8080.
const API_BASE = 'https://localhost:5001'

onMounted(async () => {
  try {
    // Ask the API what to load + how. getLaunchDetails returns ScormUrl - a
    // YARP-proxied path like /assets/scorm/disk/demo-course/sp_sco_loader.html.
    const launchResp = await fetch(`${API_BASE}/api/module/${moduleId}/getLaunchDetails?preview=0`)
    const launchData = await launchResp.json()
    const scormUrl = launchData.scormUrl

    // Harvest the assetCode out of that URL: the segment before the loader
    // file name. Asking the API each time keeps the demo flexible to which
    // package is configured.
    const parts = scormUrl.split('/').filter(Boolean)
    const assetCode = parts.length >= 2 ? parts[parts.length - 2] : 'demo-course'

    // The iframe src is the loader served THROUGH the API (its own origin,
    // https://localhost:5001) - deliberately different from where this page
    // runs. That is the "content on another domain" half of the demo.
    scormLoaderUrl.value = `${API_BASE}/assets/scorm/disk/${assetCode}/sp_sco_loader.html`
    // Remember the loader's origin; it is the target AND validator for all
    // postMessage traffic below.
    iframeOrigin.value = new URL(scormLoaderUrl.value).origin

    isIframeReady.value = true
    scormRunning.value = true
    loading.value = false

    // Start listening for the engine's token requests (arrives once the
    // course boots inside the loader iframe).
    window.addEventListener('message', handleTokenRequest)
  } catch (e) {
    error.value = e.message
    loading.value = false
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('message', handleTokenRequest)
})

// Child -> parent half of the handshake. The engine (cross-origin) asks for a
// bearer token with TOKEN_REQUEST; we answer TOKEN_RESPONSE, posting back to
// the loader's origin only. In the real product this token comes from the app
// session store; the demo returns a fixed value the API does not verify.
function handleTokenRequest(event) {
  if (event.data && event.data.msgtype === 'TOKEN_REQUEST') {
    const iframe = document.getElementById('frmContent')
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage({
        msgtype: 'TOKEN_RESPONSE',
        msgdata: { token: 'demo-session-token' }
      }, iframeOrigin.value)
    }
  }
}

// The loader iframe has finished loading its HTML; the engine scripts inside
// are now listening for USER_INIT_DATA. Boot the session on the API side and
// push the launch envelope over postMessage.
function onIframeLoad() {
  const iframe = document.getElementById('frmContent')
  if (!iframe || !iframe.contentWindow) return

  fetch(`${API_BASE}/api/module/${moduleId}/getLaunchDetails?preview=0`)
    .then(r => r.json())
    .then(async () => {
      // Start the SCORM runtime session server-side (returns nothing useful in
      // the demo, but is where a real LMS would hand us persisted state).
      await fetch(`${API_BASE}/api/module/${moduleId}/startScorm?preview=0`)

      // Log the learner attempt (best-effort, non-fatal).
      try {
        await fetch(`${API_BASE}/api/module/${moduleId}/recordAttempt`, { method: 'POST' })
      } catch (e) {}

      // Environment settings handed to the engine so its fetch() calls know
      // where the API lives (the engine has no axios / Vite proxy available).
      const settings = { VUE_APP_API_URL: API_BASE, apiUrl: API_BASE }
      // The single message that kicks everything off in the loader: module
      // info, user id, where the real course lives, and SCORM runtime config.
      const initData = {
        msgtype: 'USER_INIT_DATA',
        msgdata: {
          ModuleId: moduleId,
          userId: 'demo-user-001',
          // The SCO entry file, again served through YARP on the API origin.
          contentLaunchUrl: `${API_BASE}/assets/scorm/disk/demo-course/index.html`,
          envSettings: settings,
          LaunchDetails: {
            ScormVersion: '12',
            CurrentDataItems: [],   // no persisted values on first launch
            ApiSettings: { ApiState: 'ready', Review: false, ApiMessage: '' },
            ScormPassedText: 'Congratulations! You have passed.',
            ScormFailedText: 'You have not passed.'
          }
        }
      }

      // Post INTO the cross-origin iframe, targeting its exact origin.
      iframe.contentWindow.postMessage(initData, iframeOrigin.value)
    })
}

function onIframeError() {
  error.value = 'Failed to load SCORM content iframe'
}
</script>

<template>
  <div class="viewer-page">
    <div class="domain-bar">
      <div class="domain-chip">
        <span class="dot app"></span>
        <span class="label">Browser window (App):</span>
        <span class="mono">{{ browserDomain }}</span>
      </div>
      <div class="domain-chip">
        <span class="dot content"></span>
        <span class="label">Content (loader iframe):</span>
        <span class="mono">{{ iframeOrigin || 'loading...' }}</span>
      </div>
    </div>
    <div v-if="loading" class="loading-overlay">
      <div class="spinner"></div>
      <p>Loading SCORM content...</p>
    </div>
    <div v-if="error" class="error-bar">
      {{ error }}
    </div>
    <div v-if="isIframeReady" class="iframe-wrapper">
      <!--
        The cross-origin iframe. sandbox still permits scripts + same-origin
        (needed for the SCORM engine and its fetch calls) but restricts
        navigation and plugins; referrerpolicy keeps the request chain clean.
      -->
      <iframe
        id="frmContent"
        :src="scormLoaderUrl"
        @load="onIframeLoad"
        @error="onIframeError"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        referrerpolicy="no-referrer"
      ></iframe>
    </div>
  </div>
</template>

<style scoped>
.viewer-page {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: white;
  display: flex;
  flex-direction: column;
}
.domain-bar {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 8px 14px;
  background: #1a202c;
  border-bottom: 2px solid #2b6cb0;
  flex: 0 0 auto;
  position: relative;
  z-index: 20;
}
.domain-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #cbd5e0;
  padding: 4px 10px;
  background: #2d3748;
  border-radius: 6px;
}
.domain-chip .dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
}
.domain-chip .dot.app { background: #38a169; }
.domain-chip .dot.content { background: #e53e3e; }
.domain-chip .label { opacity: 0.85; }
.domain-chip .mono {
  font-family: monospace;
  color: #fff;
  font-weight: 600;
}
.loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: white;
  z-index: 10;
}
.spinner {
  width: 40px;
  height: 40px;
  border: 4px solid #e2e8f0;
  border-top-color: #2b6cb0;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin-bottom: 16px;
}
@keyframes spin { to { transform: rotate(360deg); } }
.error-bar {
  background: #fed7d7;
  color: #9b2c2c;
  padding: 12px;
  text-align: center;
  font-weight: 600;
}
.iframe-wrapper {
  flex: 1 1 auto;
  width: 100%;
  min-height: 0;
}
.iframe-wrapper iframe {
  width: 100%;
  height: 100%;
  border: 0;
  padding: 0;
  margin: 0;
  display: block;
}
</style>
