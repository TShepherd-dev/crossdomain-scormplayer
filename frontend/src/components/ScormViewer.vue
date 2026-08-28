<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const moduleId = route.params.moduleId

const scormLoaderUrl = ref('')
const isIframeReady = ref(false)
const loading = ref(true)
const scormRunning = ref(false)
const error = ref(null)
const iframeOrigin = ref('')
const browserDomain = window.location.origin

const API_BASE = 'https://localhost:5001'

onMounted(async () => {
  try {
    const launchResp = await fetch(`${API_BASE}/api/module/${moduleId}/getLaunchDetails?preview=0`)
    const launchData = await launchResp.json()
    const scormUrl = launchData.scormUrl

    const parts = scormUrl.split('/').filter(Boolean)
    const assetCode = parts.length >= 2 ? parts[parts.length - 2] : 'demo-course'

    scormLoaderUrl.value = `${API_BASE}/assets/scorm/disk/${assetCode}/ap_sco_loader.html`
    iframeOrigin.value = new URL(scormLoaderUrl.value).origin

    isIframeReady.value = true
    scormRunning.value = true
    loading.value = false

    window.addEventListener('message', handleTokenRequest)
  } catch (e) {
    error.value = e.message
    loading.value = false
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('message', handleTokenRequest)
})

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

function onIframeLoad() {
  const iframe = document.getElementById('frmContent')
  if (!iframe || !iframe.contentWindow) return

  fetch(`${API_BASE}/api/module/${moduleId}/getLaunchDetails?preview=0`)
    .then(r => r.json())
    .then(async () => {
      await fetch(`${API_BASE}/api/module/${moduleId}/startScorm?preview=0`)

      try {
        await fetch(`${API_BASE}/api/module/${moduleId}/recordAttempt`, { method: 'POST' })
      } catch (e) {}

      const settings = { VUE_APP_API_URL: API_BASE, apiUrl: API_BASE }
      const initData = {
        msgtype: 'USER_INIT_DATA',
        msgdata: {
          ModuleId: moduleId,
          userId: 'demo-user-001',
          contentLaunchUrl: `${API_BASE}/assets/scorm/disk/demo-course/index.html`,
          envSettings: settings,
          LaunchDetails: {
            ScormVersion: '12',
            CurrentDataItems: [],
            ApiSettings: { ApiState: 'ready', Review: false, ApiMessage: '' },
            ScormPassedText: 'Congratulations! You have passed.',
            ScormFailedText: 'You have not passed.'
          }
        }
      }

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
