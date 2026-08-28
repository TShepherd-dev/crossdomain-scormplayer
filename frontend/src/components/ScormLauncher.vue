<!--
    ScormLauncher.vue - the landing page.

    Pure metadata + a button: it fetches the launch info for the demo module
    from the API and then opens the viewer in a NEW TAB via window.open.
    Opening a new top-level browsing context is an intentional part of the
    real-product flow (keeps the learner in their own UI), and here it also
    gives the side-by-side "app domain vs content domain" demo.

    Note: the info below arrives camelCased (moduleId, moduleName, ...) because
    the API serializes DTOs with camelCase JSON - hence the camelCase property
    reads in the template.
-->
<script setup>
import { ref, onMounted } from 'vue'

const launchInfo = ref(null)   // camelCase launch metadata from /api/scorm/launchInfo
const loading = ref(true)      // spinner while launch info loads
const error = ref(null)        // any fetch failure message

onMounted(async () => {
  try {
    const resp = await fetch('/api/scorm/launchInfo')
    launchInfo.value = await resp.json()
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
})

// Hands off to the viewer tab. Kept deliberately tiny: window.open must be
// called synchronously inside the user gesture (browsers like Safari/Chrome
// block it otherwise). The router takes it from here - the viewer reads
// :moduleId from the URL.
function launchSCORM() {
  if (!launchInfo.value) return
  const viewerUrl = `/scormViewer/${launchInfo.value.moduleId}`
  window.open(viewerUrl, '_blank')
}
</script>

<template>
  <div class="launcher-page">
    <div class="card">
      <div class="card-header">
        <h1>Cross-Domain SCORM Content Player</h1>
        <p class="subtitle">Demo: SCORM content loaded in an iframe from a different domain path</p>
      </div>
      <div class="card-body">
        <div v-if="loading" class="loading">Loading launch info...</div>
        <div v-else-if="error" class="error">Error: {{ error }}</div>
        <div v-else-if="launchInfo" class="info-grid">
          <div class="info-item">
            <span class="label">Module</span>
            <span class="value">{{ launchInfo.moduleName }}</span>
          </div>
          <div class="info-item">
            <span class="label">Module ID</span>
            <span class="value">{{ launchInfo.moduleId }}</span>
          </div>
          <div class="info-item">
            <span class="label">SCORM Version</span>
            <span class="value">{{ launchInfo.scormVersion }}</span>
          </div>
          <div class="info-item">
            <span class="label">Asset Code</span>
            <span class="value">{{ launchInfo.assetCode }}</span>
          </div>
          <div class="info-item full-width">
            <span class="label">Loader URL (YARP proxied)</span>
            <span class="value mono">{{ launchInfo.loaderUrl }}</span>
          </div>
          <div class="info-item full-width">
            <span class="label">Content URL (served directly)</span>
            <span class="value mono">{{ launchInfo.launchUrl }}</span>
          </div>
        </div>
        <div class="arch-diagram">
          <h3>Architecture</h3>
          <pre>
┌──────────────────────────────────────────────────────┐
│  Vue Frontend (localhost:8080)                        │
│  ┌────────────────────────────────────────────────┐  │
│  │  ScormLauncher.vue  ──[window.open]──▶         │  │
│  │  ScormViewer.vue    ──[iframe src]──▶           │  │
│  │                   ┌─────────────────────────┐  │  │
│  │                   │ sp_sco_loader.html       │  │  │
│  │                   │ (YARP → /cdn/asset/...)  │  │  │
│  │                   │  ┌───────────────────┐   │  │  │
│  │                   │  │ index.html (SCO)  │   │  │  │
│  │                   │  │ window.API.*      │   │  │  │
│  │                   │  └───────────────────┘   │  │  │
│  │                   └─────────────────────────┘  │  │
│  └────────────────────────────────────────────────┘  │
│                        │ postMessage                 │
│  ┌─────────────────────▼──────────────────────────┐  │
│  │  .NET API (localhost:5001)                      │  │
│  │  • YARP reverse proxy (/assets/scorm/disk/...)  │  │
│  │  • SCORM endpoints (setValue, commit, etc.)     │  │
      │  │  • Content served via YARP (data/assets/scorm)  │  │
│  └─────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
          </pre>
        </div>
        <div class="action-row">
          <button class="btn-launch" @click="launchSCORM" :disabled="!launchInfo">
            Launch SCORM Course
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.launcher-page {
  display: flex;
  justify-content: center;
  padding: 40px 20px;
  min-height: calc(100vh - 48px);
  background: #f0f4f8;
}
.card {
  background: white;
  border-radius: 12px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);
  max-width: 760px;
  width: 100%;
  overflow: hidden;
}
.card-header {
  background: linear-gradient(135deg, #2b6cb0, #4299e1);
  color: white;
  padding: 32px;
}
.card-header h1 {
  font-size: 24px;
  margin-bottom: 8px;
}
.subtitle {
  opacity: 0.9;
  font-size: 14px;
}
.card-body {
  padding: 32px;
}
.loading, .error {
  padding: 16px;
  border-radius: 8px;
  text-align: center;
}
.error { background: #fed7d7; color: #9b2c2c; }
.info-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 28px;
}
.info-item {
  background: #f7fafc;
  border-radius: 8px;
  padding: 14px;
}
.info-item.full-width {
  grid-column: 1 / -1;
}
.label {
  display: block;
  font-size: 11px;
  text-transform: uppercase;
  color: #718096;
  margin-bottom: 4px;
  font-weight: 600;
  letter-spacing: 0.5px;
}
.value {
  font-size: 15px;
  color: #2d3748;
  font-weight: 500;
}
.value.mono {
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 13px;
  color: #2b6cb0;
  word-break: break-all;
}
.arch-diagram {
  margin-bottom: 24px;
}
.arch-diagram h3 {
  font-size: 14px;
  color: #4a5568;
  margin-bottom: 12px;
}
.arch-diagram pre {
  background: #1a202c;
  color: #a0aec0;
  padding: 16px;
  border-radius: 8px;
  font-size: 11px;
  line-height: 1.5;
  overflow-x: auto;
}
.action-row {
  text-align: center;
}
.btn-launch {
  background: #2b6cb0;
  color: white;
  border: none;
  padding: 14px 40px;
  border-radius: 8px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}
.btn-launch:hover { background: #2c5282; }
.btn-launch:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
