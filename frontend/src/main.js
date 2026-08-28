import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import router from './router'

// Bootstrap the Vue app with the router wired in. Router mode is HTML5
// history (createWebHistory) so /scormViewer/:moduleId is a real URL the
// viewer can be deep-linked to.
createApp(App).use(router).mount('#app')
