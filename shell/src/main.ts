import { createApp } from 'vue';
import { registerSW } from 'virtual:pwa-register';
import App from './App.vue';
import './offline/debugStore';
import { initSentry } from './offline/sentry';
import './style.css';

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    void updateSW(true);
  },
});

const app = createApp(App);
initSentry(app);
app.mount('#app');
