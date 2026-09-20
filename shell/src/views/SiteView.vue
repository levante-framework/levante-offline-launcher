<template>
  <div class="page">
    <h1>1 · Select Site</h1>
    <p class="muted">
      Sign in as the On-site Researcher, then pick the site this browser will collect for. Needed
      when your account can see more than one site. A laptop pick does not carry over — do this
      again on the tablet (or open a pack link there).
    </p>
    <StaffNav current="site" />

    <div v-if="!backendConfigured" class="error" style="margin-top: 12px">
      This build has no backend configured (VITE_FUNCTIONS_BASE / VITE_AUTH_SIGNIN_URL).
    </div>

    <div class="card">
      <h2 style="margin-top: 0">Sign in</h2>
      <p class="muted" style="margin-top: 0">
        Use Google if that is how you sign in to the dashboard. Email and password still works.
      </p>
      <div v-if="session" class="row">
        <span>Signed in as <strong>{{ session.email }}</strong></span>
        <button type="button" @click="doSignOut">Sign out</button>
      </div>
      <div v-else-if="splash" class="spinner-overlay" role="status" aria-live="polite">
        <div class="spinner" aria-hidden="true" />
        <p class="muted">{{ splash }}</p>
      </div>
      <div v-else class="sign-in-stack">
        <button
          v-if="googleAuthConfigured"
          type="button"
          class="google-btn"
          :disabled="!online || busy"
          @click="doGoogleSignIn"
        >
          Continue with Google
        </button>
        <p v-if="googleAuthConfigured" class="muted sign-in-or">or use email and password</p>
        <form class="row" @submit.prevent="doSignIn">
          <input v-model="email" type="email" placeholder="researcher email" autocomplete="username" required />
          <input v-model="password" type="password" placeholder="password" autocomplete="current-password" required />
          <button type="submit" :disabled="!online || busy">Sign in</button>
        </form>
      </div>
    </div>

    <div class="card" v-if="session">
      <h2 style="margin-top: 0">Which site?</h2>
      <p class="muted" style="margin-top: 0">
        Packs on the next step are limited to the site you pick here.
      </p>
      <div v-if="loading" class="spinner-overlay" role="status" aria-live="polite">
        <div class="spinner" aria-hidden="true" />
        <p class="muted">Loading sites…</p>
      </div>
      <div v-else-if="sites.length" class="child-list">
        <button
          v-for="site in sites"
          :key="site.id"
          class="child"
          :class="{ selected: pickedId === site.id }"
          type="button"
          @click="chooseSite(site)"
        >
          <div><strong>{{ site.name }}</strong></div>
          <div class="muted mono">{{ site.id }}</div>
        </button>
      </div>
      <p v-else class="notice">This account has no site assignments.</p>
      <div class="row" style="margin-top: 12px" v-if="picked">
        <a href="#/provision">
          <button type="button" class="primary big" @click="confirmSite">Continue to provision</button>
        </a>
      </div>
    </div>

    <div v-if="error" class="error" style="margin-top: 12px">{{ error }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import StaffNav from '../components/StaffNav.vue';
import {
  backendConfigured,
  getSession,
  googleAuthConfigured,
  type ProctorSession,
  signIn,
  signInWithGoogle,
  signOut,
} from '../offline/auth';
import { logError } from '../offline/sentry';
import {
  getSelectedSite,
  loadSiteCatalog,
  readPackLink,
  setSelectedSite,
  type SelectedSite,
} from '../offline/site';

const session = ref<ProctorSession | null>(getSession());
const email = ref('');
const password = ref('');
const sites = ref<SelectedSite[]>([]);
const pickedId = ref<string | null>(getSelectedSite()?.id ?? null);
const busy = ref(false);
const loading = ref(false);
const error = ref('');
const online = ref(navigator.onLine);

const picked = computed(() => sites.value.find((site) => site.id === pickedId.value) ?? null);
const splash = computed(() => (busy.value && !session.value ? 'Signing in…' : ''));

onMounted(() => {
  window.addEventListener('online', () => (online.value = true));
  window.addEventListener('offline', () => (online.value = false));
  readPackLink();
});

watch(
  session,
  async (value) => {
    if (!value) {
      sites.value = [];
      return;
    }
    await loadSites();
  },
  { immediate: true },
);

async function loadSites() {
  error.value = '';
  loading.value = true;
  try {
    const catalog = await loadSiteCatalog();
    sites.value = catalog.sites;
    const link = readPackLink();
    const fromLink = link ? catalog.administrations.find((item) => item.id === link.admin)?.districts[0] : null;
    if (fromLink && catalog.sites.some((site) => site.id === fromLink)) {
      pickedId.value = fromLink;
    } else if (!pickedId.value || !catalog.sites.some((site) => site.id === pickedId.value)) {
      pickedId.value = catalog.sites.length === 1 ? catalog.sites[0].id : null;
    }
    const site = catalog.sites.find((item) => item.id === pickedId.value);
    if (site) setSelectedSite(site);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    logError('load sites failed', err);
  } finally {
    loading.value = false;
  }
}

async function doSignIn() {
  error.value = '';
  busy.value = true;
  try {
    session.value = await signIn(email.value, password.value);
    password.value = '';
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function doGoogleSignIn() {
  error.value = '';
  busy.value = true;
  try {
    session.value = await signInWithGoogle();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

function doSignOut() {
  signOut();
  session.value = null;
  sites.value = [];
  pickedId.value = null;
  setSelectedSite(null);
}

function chooseSite(site: SelectedSite) {
  pickedId.value = site.id;
  setSelectedSite(site);
}

function confirmSite() {
  if (picked.value) setSelectedSite(picked.value);
}
</script>

<style scoped>
.sign-in-stack {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
}
.sign-in-or {
  margin: 0;
}
input {
  font: inherit;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
  min-width: 200px;
}
</style>
