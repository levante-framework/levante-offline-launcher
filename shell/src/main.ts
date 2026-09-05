import { createApp } from 'vue';
import { registerSW } from 'virtual:pwa-register';
import App from './App.vue';
import './offline/debugStore';
import { initSentry } from './offline/sentry';
import './style.css';

registerSW({ immediate: true });

const app = createApp(App);
initSentry(app);
app.mount('#app');
