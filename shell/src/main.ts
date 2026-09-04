import { createApp } from 'vue';
import { registerSW } from 'virtual:pwa-register';
import App from './App.vue';
import './offline/debugStore';
import './style.css';

registerSW({ immediate: true });

createApp(App).mount('#app');
