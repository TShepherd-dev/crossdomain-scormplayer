<script setup>
</script>

<template>
  <div id="app-container">
    <nav class="top-nav">
      <router-link to="/">SCORM Launcher</router-link>
      <span class="nav-sep">|</span>
      <span class="nav-info">Cross-Domain SCORM Content Player Demo</span>
    </nav>
    <router-view />
  </div>
</template>

<style scoped>
.top-nav {
  background: #1a202c;
  padding: 12px 24px;
  display: flex;
  align-items: center;
  gap: 12px;
}
.top-nav a {
  color: #63b3ed;
  text-decoration: none;
  font-weight: 600;
}
.top-nav a:hover {
  color: #90cdf4;
}
.nav-sep {
  color: #4a5568;
}
.nav-info {
  color: #a0aec0;
  font-size: 13px;
}
</style>
