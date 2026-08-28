import { createRouter, createWebHistory } from 'vue-router'
import ScormLauncher from './components/ScormLauncher.vue'
import ScormViewer from './components/ScormViewer.vue'

const routes = [
  { path: '/', name: 'Launcher', component: ScormLauncher },
  { path: '/scormViewer/:moduleId', name: 'Viewer', component: ScormViewer }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router
