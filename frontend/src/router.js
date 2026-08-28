import { createRouter, createWebHistory } from 'vue-router'
import ScormLauncher from './components/ScormLauncher.vue'
import ScormViewer from './components/ScormViewer.vue'

// App routing. The two routes reflect the two "phases" of the demo:
//   /                     -> landing page with the Launch button
//   /scormViewer/:moduleId -> the viewer that owns the iframe chain. :moduleId
//                             is what the viewer passes to the API when it
//                             fetches launch details / starts the session.
const routes = [
  { path: '/', name: 'Launcher', component: ScormLauncher },
  { path: '/scormViewer/:moduleId', name: 'Viewer', component: ScormViewer }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router
