<template>
  <div class="ma-app">
    <nav class="ma-nav">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="ma-nav-btn"
        :class="{ 'ma-nav-btn--active': activeTab === tab.id }"
        @click="switchTab(tab.id)"
      >{{ tab.label }}</button>
    </nav>

    <div v-if="!authed && activeTab !== 'settings'" class="ma-status-screen">
      <span v-if="maError" class="ma-err">{{ maError }}</span>
      <span v-else class="ma-connecting-msg">{{ connected ? 'Authenticating…' : 'Connecting…' }}</span>
    </div>

    <div v-if="authed || activeTab === 'settings'" class="ma-content">

      <!-- ── HOME ─────────────────────────────────────────────────────────────── -->
      <div v-if="activeTab === 'home'" class="home-panel">
        <div class="ma-card" :style="accentBg ? { background: accentBg } : {}">
          <!-- background art -->
          <img v-if="artUrl" :src="artUrl" class="ma-bg-art" alt="" />

          <!-- player name -->
          <div class="ma-player-name" :style="{ color: accentFg }">
            <svg viewBox="0 0 24 24" class="ma-player-icon"><path :d="mdiSpeaker" fill="currentColor" /></svg>
            {{ activePlayer?.display_name || activePlayer?.name || '—' }}
          </div>

          <!-- track info -->
          <div class="ma-info">
            <div class="ma-track" :style="{ color: accentFg }">{{ trackName }}</div>
            <div class="ma-artist" :style="{ color: accentFg }">{{ artist }}</div>
            <div v-if="album" class="ma-album" :style="{ color: accentFg, opacity: 0.7 }">{{ album }}</div>
          </div>

          <!-- controls -->
          <div class="ma-controls">
            <div class="ma-btns">
              <button class="ma-btn" :style="{ color: accentFg }" @click="maApi?.previous(activePlayerId)">
                <svg viewBox="0 0 24 24"><path :d="mdiSkipPrevious" fill="currentColor" /></svg>
              </button>
              <button class="ma-btn ma-btn-play" :style="{ color: accentFg }" @click="maApi?.playPause(activePlayerId)">
                <svg viewBox="0 0 24 24"><path :d="isPlaying ? mdiPause : mdiPlay" fill="currentColor" /></svg>
              </button>
              <button class="ma-btn" :style="{ color: accentFg }" @click="maApi?.next(activePlayerId)">
                <svg viewBox="0 0 24 24"><path :d="mdiSkipNext" fill="currentColor" /></svg>
              </button>
              <button class="ma-btn ma-btn-sm" :class="{ active: shuffleEnabled }" :style="{ color: accentFg }" @click="toggleShuffle">
                <svg viewBox="0 0 24 24"><path :d="mdiShuffle" fill="currentColor" /></svg>
              </button>
              <button class="ma-btn ma-btn-sm" :class="{ active: repeatMode !== 'off' }" :style="{ color: accentFg }" @click="cycleRepeat">
                <svg viewBox="0 0 24 24"><path :d="repeatMode === 'one' ? mdiRepeatOnce : mdiRepeat" fill="currentColor" /></svg>
              </button>
              <button class="ma-btn ma-btn-sm" :style="{ color: accentFg }" @click="switchTab('queue')">
                <svg viewBox="0 0 24 24"><path :d="mdiFormatListBulleted" fill="currentColor" /></svg>
              </button>
            </div>
          </div>

          <!-- progress bar pinned to bottom -->
          <div class="ma-progress-row">
            <span class="ma-time" :style="{ color: accentFg }">{{ fmtTime(localElapsed) }}</span>
            <div class="ma-progress-track" @click="onSeek">
              <div class="ma-progress-fill" :style="{ width: progressPct + '%', background: accentFg }"></div>
            </div>
            <span class="ma-time ma-time--remaining" :style="{ color: accentFg }">-{{ fmtTime(Math.max(0, duration - localElapsed)) }}</span>
          </div>
        </div>
      </div>

      <!-- ── QUEUE ─────────────────────────────────────────────────────────────── -->
      <div v-else-if="activeTab === 'queue'" class="tab-panel tab-panel--nospace">
        <div v-if="queueLoading" class="empty-msg">Loading…</div>
        <div v-else-if="!queueItems.length" class="empty-msg">Queue is empty</div>
        <div v-else class="list-card">
          <div
            v-for="(item, idx) in queueItems"
            :key="item.queue_item_id || idx"
            :ref="el => { if (item.queue_item_id === activeQueue?.current_item?.queue_item_id) currentQueueEl = el }"
            class="queue-row"
            :class="{ 'queue-row--current': item.queue_item_id === activeQueue?.current_item?.queue_item_id }"
          >
            <span class="queue-idx">{{ idx + 1 }}</span>
            <img v-if="queueItemArt(item)" :src="queueItemArt(item)" class="queue-art" alt="" />
            <div v-else class="queue-art queue-art--empty"></div>
            <div class="queue-info">
              <div class="queue-name">{{ item.name }}</div>
              <div class="queue-sub">{{ queueItemArtist(item) }}</div>
            </div>
            <span class="queue-dur">{{ fmtTime(item.duration) }}</span>
          </div>
        </div>
      </div>

      <!-- ── PLAYER ─────────────────────────────────────────────────────────────── -->
      <div v-else-if="activeTab === 'player'" class="tab-panel">
        <div class="section-title">Players</div>
        <div class="list-card">
          <div
            v-for="p in visiblePlayers"
            :key="p.player_id"
            class="list-row"
            :class="{ 'list-row--active': p.player_id === selectedPlayerId }"
            @click="selectPlayer(p.player_id); switchTab('home')"
          >
            <svg class="list-icon" viewBox="0 0 24 24"><path :d="mdiSpeaker" fill="currentColor" /></svg>
            <div class="list-info">
              <div class="list-name">{{ p.display_name || p.name }}</div>
              <div class="list-sub">{{ p.volume_level != null ? `vol ${p.volume_level}%` : '' }}</div>
            </div>
            <span class="list-badge" :class="`state-${p.state}`">{{ p.state }}</span>
          </div>
        </div>
      </div>

      <!-- ── BROWSE ─────────────────────────────────────────────────────────────── -->
      <div v-else-if="activeTab === 'browse'" class="tab-panel tab-panel--nospace">
        <!-- breadcrumb / back bar -->
        <div class="browse-bar">
          <button v-if="browsePath.length" class="browse-back-btn" @click="browseBack">
            <svg viewBox="0 0 24 24"><path :d="mdiChevronLeft" fill="currentColor" /></svg>
          </button>
          <span class="browse-crumb">{{ browsePath.length ? browsePath[browsePath.length-1].name : 'Browse' }}</span>
        </div>

        <div v-if="browseLoading" class="empty-msg">Loading…</div>
        <div v-else-if="!browseItems.length" class="empty-msg">Empty</div>
        <div v-else class="list-card">
          <div
            v-for="item in browseItems"
            :key="item.uri || item.item_id"
            class="list-row"
            @click="item.media_type !== 'folder' && browseClick(item)"
          >
            <svg v-if="item.media_type === 'folder'" class="list-icon" viewBox="0 0 24 24"
              @click.stop="browseEnter(item)">
              <path :d="mdiFolder" fill="currentColor" />
            </svg>
            <svg v-else-if="item.media_type === 'artist'" class="list-icon" viewBox="0 0 24 24">
              <path :d="mdiAccountMusic" fill="currentColor" />
            </svg>
            <svg v-else-if="item.media_type === 'album'" class="list-icon" viewBox="0 0 24 24">
              <path :d="mdiAlbum" fill="currentColor" />
            </svg>
            <svg v-else class="list-icon" viewBox="0 0 24 24">
              <path :d="mdiMusicNote" fill="currentColor" />
            </svg>
            <div class="list-info" @click.stop="item.media_type === 'folder' ? browsePlay(item) : browseClick(item)">
              <div class="list-name">{{ item.name }}</div>
              <div class="list-sub">{{ browseItemSub(item) }}</div>
            </div>
            <svg v-if="item.media_type === 'folder'" class="browse-chevron" viewBox="0 0 24 24"
              @click.stop="browseEnter(item)">
              <path :d="mdiChevronRight" fill="currentColor" />
            </svg>
            <span v-else-if="item.duration" class="list-dur">{{ fmtTime(item.duration) }}</span>
          </div>
        </div>
      </div>

      <!-- ── RADIO ─────────────────────────────────────────────────────────────── -->
      <div v-else-if="activeTab === 'radio'" class="tab-panel tab-panel--nospace">
        <div v-if="radioLoading" class="empty-msg">Loading…</div>
        <div v-else-if="!radioStations.length" class="empty-msg">No radio stations found</div>
        <div v-else class="list-card">
          <div
            v-for="station in radioStations"
            :key="station.item_id"
            class="list-row"
            @click="playRadio(station)"
          >
            <img v-if="radioArt(station)" :src="radioArt(station)" class="radio-art" alt="" />
            <div v-else class="radio-art radio-art--empty">
              <svg viewBox="0 0 24 24"><path :d="mdiRadio" fill="currentColor" /></svg>
            </div>
            <div class="list-info">
              <div class="list-name">{{ station.name }}</div>
              <div class="list-sub">{{ station.metadata?.description || '' }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- ── SETTINGS ─────────────────────────────────────────────────────────────── -->
      <div v-else-if="activeTab === 'settings'" class="tab-panel">
        <div class="settings-panel">
          <div class="setting-row">
            <label class="setting-label">Music Assistant URL</label>
            <input class="setting-input" v-model="settingsUrl" autocapitalize="none" autocorrect="off" />
          </div>
          <div class="setting-row">
            <label class="setting-label">Token</label>
            <input class="setting-input" v-model="settingsToken" autocapitalize="none" autocorrect="off" autocomplete="off" spellcheck="false" />
            <span class="setting-hint" v-if="settingsToken">{{ settingsToken.length }} chars stored</span>
            <span class="setting-hint setting-hint--warn" v-else>No token set</span>
          </div>
          <button class="setting-save-btn" @click="saveSettings">Save & Reconnect</button>
          <div class="setting-status">
            Status:
            <span :class="authed ? 'status-ok' : 'status-err'">
              {{ authed ? 'Connected' : connected ? 'Authenticating…' : 'Disconnected' }}
            </span>
          </div>
          <div class="setting-row setting-row--toggle">
            <div class="setting-toggle-info">
              <label class="setting-label">Listen on this device</label>
              <span class="setting-hint">
                <span v-if="sendspinEnabled && sendspinConnected" class="status-ok">● Active{{ sendspinPlaying ? ' · Playing' : '' }}</span>
                <span v-else-if="sendspinEnabled && sendspinError" class="status-err">{{ sendspinError }}</span>
                <span v-else-if="sendspinEnabled" class="status-warn">Connecting…</span>
                <span v-else class="setting-hint--muted">Off — enables Sendspin audio streaming</span>
              </span>
            </div>
            <button class="setting-toggle-btn" :class="{ active: sendspinEnabled }" @click="toggleSendspin">
              <span class="setting-toggle-knob"></span>
            </button>
          </div>
          <div class="setting-row" v-if="visiblePlayers.length > 1">
            <label class="setting-label">Active Player</label>
            <select class="setting-input" v-model="selectedPlayerId">
              <option v-for="p in visiblePlayers" :key="p.player_id" :value="p.player_id">
                {{ p.display_name || p.name }}
              </option>
            </select>
          </div>
        </div>
      </div>

    </div>
  </div>
  <audio ref="sendspinAudioEl" playsinline style="display:none"></audio>
</template>

<script setup>
import { ref, shallowRef, computed, watch, onMounted, onUnmounted } from 'vue';
import { useMusicAssistant } from './composables/useMusicAssistant.js';
import { startSendspin, stopSendspin, primeAudioContext, sendspinConnected, sendspinPlaying, sendspinError } from './composables/useSendspin.js';
import {
  mdiPlay, mdiPause, mdiSkipNext, mdiSkipPrevious,
  mdiShuffle, mdiRepeat, mdiRepeatOnce, mdiSpeaker, mdiMusicNote,
  mdiFormatListBulleted, mdiRadio,
  mdiFolder, mdiAccountMusic, mdiAlbum, mdiChevronLeft, mdiChevronRight,
} from '@mdi/js';

// ── Tabs ──────────────────────────────────────────────────────────────────────
const tabs = [
  { id: 'home',     label: 'Home'     },
  { id: 'queue',    label: 'Queue'    },
  { id: 'player',   label: 'Player'   },
  { id: 'browse',   label: 'Browse'   },
  { id: 'radio',    label: 'Radio'    },
  { id: 'settings', label: 'Settings' },
];
const activeTab = ref('home');

// ── Settings ──────────────────────────────────────────────────────────────────
const settingsUrl   = ref(localStorage.getItem('ma_url') || '');
const settingsToken = ref(localStorage.getItem('ma_token') || '');

function saveSettings() {
  localStorage.setItem('ma_url',   settingsUrl.value.trim());
  localStorage.setItem('ma_token', settingsToken.value.trim());
  window.location.reload();
}

// ── Sendspin (listen on this device) ─────────────────────────────────────────
const sendspinEnabled = ref(localStorage.getItem('ma_sendspin') === '1');

async function toggleSendspin() {
  sendspinEnabled.value = !sendspinEnabled.value;
  localStorage.setItem('ma_sendspin', sendspinEnabled.value ? '1' : '0');
  if (sendspinEnabled.value) {
    // Create/resume the keep-alive AudioContext now, while we have a user gesture.
    // iOS requires a gesture to unlock AudioContext; this prevents JS timer throttling
    // when the iPhone screen turns off with CarPlay active (gaps every ~1 s).
    primeAudioContext();
    const url   = localStorage.getItem('ma_url')   || maUrl.value;
    const token = localStorage.getItem('ma_token') || '';
    if (url) await startSendspin(url, token, sendspinAudioEl.value);
  } else {
    stopSendspin();
  }
}

// ── MA instance ───────────────────────────────────────────────────────────────
const maApi  = shallowRef(null);
const maUrl  = ref('');

const authed    = computed(() => maApi.value?.authed?.value    ?? false);
const connected = computed(() => maApi.value?.connected?.value ?? false);
const maError   = computed(() => maApi.value?.error?.value     ?? '');
const players   = computed(() => maApi.value?.players?.value   ?? []);
const queues    = computed(() => maApi.value?.queues?.value    ?? {});

onMounted(async () => {
  let url   = localStorage.getItem('ma_url');
  let token = localStorage.getItem('ma_token') || '';

  if (!url) {
    try {
      const res = await fetch('/api/pages');
      const pages = await res.json();
      for (const page of pages) {
        const card = page.cards?.find(c => c.type === 'musicassistant');
        if (card?.ma_url) { url = card.ma_url; token = card.ma_token || ''; break; }
      }
    } catch { /* ignore */ }
    url = url || 'http://192.168.0.20:8095';
  }

  maUrl.value         = url;
  settingsUrl.value   = settingsUrl.value   || url;
  settingsToken.value = settingsToken.value || token;
  maApi.value         = useMusicAssistant(url, token);

  if (sendspinEnabled.value) startSendspin(url, token, sendspinAudioEl.value);
});

// ── Player selection ──────────────────────────────────────────────────────────
const visiblePlayers   = computed(() => players.value.filter(p => p.enabled));
const selectedPlayerId = ref(localStorage.getItem('ma_player') || '');

function selectPlayer(id) {
  selectedPlayerId.value = id;
  localStorage.setItem('ma_player', id);
}

watch(visiblePlayers, (ps) => {
  if (!ps.length) return;
  // Keep saved player if it's still available
  if (selectedPlayerId.value && ps.find(p => p.player_id === selectedPlayerId.value)) return;
  // Otherwise pick a playing player or the first one
  const playing = ps.find(p => p.state === 'playing');
  selectPlayer((playing ?? ps[0]).player_id);
}, { immediate: true });

const activePlayerId = computed(() => selectedPlayerId.value);
const activePlayer   = computed(() => players.value.find(p => p.player_id === activePlayerId.value));
const activeQueue    = computed(() => queues.value[activePlayerId.value]);
const isPlaying      = computed(() => activePlayer.value?.state === 'playing');

// ── Track info ────────────────────────────────────────────────────────────────
const currentTrack = computed(() =>
  activeQueue.value?.current_item?.media_item ?? activeQueue.value?.current_item
);
const currentMedia = computed(() => activePlayer.value?.current_media);

const trackName = computed(() =>
  currentTrack.value?.name || currentMedia.value?.title || '—'
);
const artist = computed(() => {
  const t = currentTrack.value;
  if (t?.artists?.length) return t.artists.map(a => a.name).join(', ');
  if (t?.artist_str) return t.artist_str;
  return currentMedia.value?.artist ?? '';
});
const album = computed(() =>
  currentTrack.value?.album?.name || currentMedia.value?.album || ''
);
const elapsed  = computed(() => activeQueue.value?.elapsed_time ?? 0);
const duration = computed(() =>
  currentTrack.value?.duration ?? activeQueue.value?.current_item?.duration ?? 0
);

// ── Progress ticker ───────────────────────────────────────────────────────────
const localElapsed = ref(0);
let ticker = null;

watch(elapsed, v => { localElapsed.value = v; }, { immediate: true });
watch(isPlaying, playing => {
  clearInterval(ticker);
  if (playing) {
    ticker = setInterval(() => {
      localElapsed.value = Math.min(localElapsed.value + 1, duration.value || Infinity);
    }, 1000);
  }
}, { immediate: true });
onUnmounted(() => clearInterval(ticker));

const sendspinAudioEl = ref(null);

// Update car display / stalk-button state when playback changes.
// Only set 'paused' when we are still connected (explicit user pause).
// On network dropout sendspinConnected is false — leave state as-is so the
// car receiver doesn't go into a dead/locked state while we reconnect.
watch(sendspinPlaying, (playing) => {
  if (!('mediaSession' in navigator)) return;
  if (playing) {
    navigator.mediaSession.playbackState = 'playing';
  } else if (sendspinConnected.value) {
    navigator.mediaSession.playbackState = 'paused';
  }
});

const progressPct = computed(() =>
  duration.value ? Math.min(100, (localElapsed.value / duration.value) * 100) : 0
);

// ── Seek ──────────────────────────────────────────────────────────────────────
function onSeek(e) {
  if (!duration.value) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  const pos  = pct * duration.value;
  localElapsed.value = pos;
  maApi.value?.seek(activePlayerId.value, pos);
}

// ── Volume / Shuffle / Repeat ─────────────────────────────────────────────────
const volume        = computed(() => activePlayer.value?.volume_level ?? 50);
const shuffleEnabled = computed(() => activeQueue.value?.shuffle_enabled ?? false);
const repeatMode     = computed(() => activeQueue.value?.repeat_mode ?? 'off');

function onVolume(e) { maApi.value?.setVolume(activePlayerId.value, Number(e.target.value)); }

function toggleShuffle() { maApi.value?.setShuffle(activePlayerId.value, !shuffleEnabled.value); }
function cycleRepeat() {
  const modes = ['off', 'all', 'one'];
  const next = modes[(modes.indexOf(repeatMode.value) + 1) % modes.length];
  maApi.value?.setRepeat(activePlayerId.value, next);
}

// ── Album art ─────────────────────────────────────────────────────────────────
const maArtUrl = computed(() => {
  const item = currentTrack.value;
  const base = (maUrl.value || 'http://192.168.0.20:8095').replace(/\/$/, '');
  if (item) {
    const imgObj = item.metadata?.images?.[0] || item.album?.metadata?.images?.[0];
    if (imgObj?.path) return `${base}/imageproxy?path=${encodeURIComponent(encodeURIComponent(imgObj.path))}&provider=${encodeURIComponent(imgObj.provider)}&checksum=&size=256`;
  }
  // Fallback: radio / ICY stream image from current_media
  const imgUrl = currentMedia.value?.image_url;
  if (imgUrl) return imgUrl.startsWith('http') ? imgUrl : `${base}${imgUrl}`;
  return '';
});
const artUrl = computed(() =>
  maArtUrl.value ? `/api/imageproxy?url=${encodeURIComponent(maArtUrl.value)}` : ''
);

// ── MediaSession — tells CarPlay / BT display what's playing ─────────────────
watch([trackName, artist, artUrl], ([title, artistStr, art]) => {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title:  title  || 'Music Assistant',
    artist: artistStr || '',
    artwork: art ? [{ src: art, sizes: '512x512', type: 'image/jpeg' }] : [],
  });
});

// Wire car stalk buttons → MA controls
onMounted(() => {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.setActionHandler('play',          () => maApi.value?.playPause(activePlayerId.value));
  navigator.mediaSession.setActionHandler('pause',         () => maApi.value?.playPause(activePlayerId.value));
  navigator.mediaSession.setActionHandler('nexttrack',     () => maApi.value?.next(activePlayerId.value));
  navigator.mediaSession.setActionHandler('previoustrack', () => maApi.value?.previous(activePlayerId.value));
});

// ── Color palette (colorthief-style) ─────────────────────────────────────────
const accentBg = ref('');
const accentFg = ref('#e8eaf0');

// WCAG relative luminance for an sRGB channel value 0-255
function srgbLum(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
function relativeLuminance([r, g, b]) {
  return 0.2126 * srgbLum(r) + 0.7152 * srgbLum(g) + 0.0722 * srgbLum(b);
}
function contrastRatio(l1, l2) {
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}
function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

function extractPalette(url, count = 6) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const SIZE = 64;
      const canvas = document.createElement('canvas');
      canvas.width = SIZE; canvas.height = SIZE;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, SIZE, SIZE);
      try {
        const { data } = ctx.getImageData(0, 0, SIZE, SIZE);
        // Bucket into a 32×32×32 color space (quantize each channel to 8 levels)
        const STEP = 8;
        const buckets = new Map();
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 128) continue;
          const r = Math.round(data[i]   / STEP) * STEP;
          const g = Math.round(data[i+1] / STEP) * STEP;
          const b = Math.round(data[i+2] / STEP) * STEP;
          const key = (r << 16) | (g << 8) | b;
          buckets.set(key, (buckets.get(key) || 0) + 1);
        }
        // Top N most frequent colors
        const top = [...buckets.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, count)
          .map(([key]) => [(key >> 16) & 255, (key >> 8) & 255, key & 255]);
        resolve(top);
      } catch { resolve([]); }
    };
    img.onerror = () => resolve([]);
    img.src = url;
  });
}

function extractVividHue(data) {
  const BUCKETS = 36;
  const hueWeights = new Float32Array(BUCKETS);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    const l = (max + min) / 2;
    if (l < 0.06 || l > 0.94 || d < 0.1) continue;
    const s = d / (1 - Math.abs(2 * l - 1));
    if (s < 0.15) continue;
    let h;
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    hueWeights[Math.floor((h / 6) * BUCKETS) % BUCKETS] += s * s;
  }
  const total = hueWeights.reduce((a, b) => a + b, 0);
  if (!total) return -1;
  const smoothed = hueWeights.map((v, i) =>
    v * 0.5 + hueWeights[(i + 1) % BUCKETS] * 0.25 + hueWeights[(i - 1 + BUCKETS) % BUCKETS] * 0.25
  );
  return Math.round((smoothed.indexOf(Math.max(...smoothed)) / BUCKETS) * 360);
}

async function updateColors(url) {
  if (!url) { accentBg.value = ''; accentFg.value = '#e8eaf0'; return; }

  const SIZE = 64;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE; canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  const img = new Image();
  await new Promise(r => { img.onload = r; img.onerror = r; img.src = url; });
  ctx.drawImage(img, 0, 0, SIZE, SIZE);
  let data;
  try { data = ctx.getImageData(0, 0, SIZE, SIZE).data; } catch { return; }

  // Background: actual darkest dominant color from palette
  const palette = await extractPalette(url);
  let bestBg = null, bestBgContrast = 0;
  for (const rgb of palette) {
    const cr = contrastRatio(1, relativeLuminance(rgb));
    if (cr > bestBgContrast) { bestBgContrast = cr; bestBg = rgb; }
  }
  accentBg.value = bestBg ? rgbToHex(bestBg) : '';

  // Foreground: vivid hue from saturation-weighted extraction → bright HSL
  const hue = extractVividHue(data);
  accentFg.value = hue >= 0 ? `hsl(${hue}, 80%, 65%)` : '#e8eaf0';
}

watch(artUrl, url => updateColors(url), { immediate: true });

// ── Queue items ───────────────────────────────────────────────────────────────
const queueItems   = ref([]);
const queueLoading = ref(false);
const currentQueueEl = ref(null);

async function fetchQueueItems() {
  if (!maApi.value || !activePlayerId.value) return;
  queueLoading.value = true;
  try {
    const items = await maApi.value.getQueueItems(activePlayerId.value);
    queueItems.value = items ?? [];
  } catch { queueItems.value = []; }
  queueLoading.value = false;
}

watch([activePlayerId, authed], ([pid, auth]) => {
  if (auth && pid) fetchQueueItems();
}, { immediate: true });

watch(activeTab, tab => {
  if (tab === 'queue') fetchQueueItems();
});

// Re-fetch when the queue content changes (new album/playlist started)
watch(() => activeQueue.value?.current_item?.queue_item_id, (newId, oldId) => {
  if (newId && newId !== oldId) fetchQueueItems();
});

function queueItemArt(item) {
  const track = item.media_item;
  if (!track) return '';
  const imgObj = track.metadata?.images?.[0] || track.album?.metadata?.images?.[0];
  if (!imgObj?.path) return '';
  const base = (maUrl.value || 'http://192.168.0.20:8095').replace(/\/$/, '');
  const maArt = `${base}/imageproxy?path=${encodeURIComponent(encodeURIComponent(imgObj.path))}&provider=${encodeURIComponent(imgObj.provider)}&checksum=&size=64`;
  return `/api/imageproxy?url=${encodeURIComponent(maArt)}`;
}

function queueItemArtist(item) {
  const t = item.media_item;
  if (!t) return '';
  if (t.artists?.length) return t.artists.map(a => a.name).join(', ');
  return t.artist_str ?? '';
}

// ── Browse ────────────────────────────────────────────────────────────────────
const browseItems   = ref([]);
const browseLoading = ref(false);
// Stack of { name, path } — empty = at root
const browsePath    = ref([]);

async function browseLoad(path) {
  if (!maApi.value) return;
  browseLoading.value = true;
  try {
    const items = await maApi.value.browse(path) ?? [];
    // At root: auto-jump into the local filesystem provider
    if (!path) {
      const fs = items.find(i =>
        /filesystem|local.?disk|local.?file/i.test(i.name) ||
        /filesystem/i.test(i.uri ?? i.path ?? '')
      );
      if (fs) {
        browsePath.value = [{ name: fs.name, path: fs.path ?? fs.uri }];
        browseItems.value = await maApi.value.browse(fs.path ?? fs.uri) ?? [];
        browseLoading.value = false;
        return;
      }
    }
    browseItems.value = items;
  } catch { browseItems.value = []; }
  browseLoading.value = false;
}

function browseEnter(item) {
  browsePath.value = [...browsePath.value, { name: item.name, path: item.path ?? item.uri }];
  browseLoad(item.path ?? item.uri);
}

function browsePlay(item) {
  maApi.value?.playMedia(activePlayerId.value, item, 'replace');
  switchTab('home');
}

function browseClick(item) {
  if (item.media_type === 'folder') {
    browseEnter(item);
  } else {
    browsePlay(item);
  }
}

function browseBack() {
  const stack = browsePath.value.slice(0, -1);
  browsePath.value = stack;
  browseLoad(stack.length ? stack[stack.length - 1].path : undefined);
}

function browseItemSub(item) {
  if (item.artists?.length) return item.artists.map(a => a.name).join(', ');
  if (item.artist_str) return item.artist_str;
  return '';
}

watch(activeTab, tab => {
  if (tab === 'browse') {
    browsePath.value = [];
    browseLoad();
  }
});
watch(authed, auth => { if (auth && activeTab.value === 'browse') browseLoad(); });

// ── Radio ─────────────────────────────────────────────────────────────────────
const radioStations = ref([]);
const radioLoading  = ref(false);

async function fetchRadioStations() {
  if (!maApi.value) return;
  radioLoading.value = true;
  try {
    radioStations.value = await maApi.value.getRadioStations() ?? [];
  } catch { radioStations.value = []; }
  radioLoading.value = false;
}

watch(activeTab, tab => { if (tab === 'radio') fetchRadioStations(); });
watch(authed, auth => { if (auth && activeTab.value === 'radio') fetchRadioStations(); });

function radioArt(station) {
  const base = (maUrl.value || 'http://192.168.0.20:8095').replace(/\/$/, '');
  const imgObj = station.metadata?.images?.[0];
  if (!imgObj?.path) return '';
  const maArt = `${base}/imageproxy?path=${encodeURIComponent(encodeURIComponent(imgObj.path))}&provider=${encodeURIComponent(imgObj.provider)}&checksum=&size=64`;
  return `/api/imageproxy?url=${encodeURIComponent(maArt)}`;
}

function playRadio(station) {
  maApi.value?.playMedia(activePlayerId.value, station, 'replace');
  switchTab('home');
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtTime(sec) {
  if (!sec) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function switchTab(id) { activeTab.value = id; }
</script>

<style scoped>
.ma-app {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
  background: var(--bg-base);
  padding-top: env(safe-area-inset-top);
}

/* ── Nav ── */
.ma-nav {
  display: flex;
  overflow-x: auto;
  scrollbar-width: none;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 10;
  flex-shrink: 0;
}
.ma-nav::-webkit-scrollbar { display: none; }

.ma-nav-btn {
  flex-shrink: 0;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-secondary);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  padding: 0.65rem 1.1rem;
  white-space: nowrap;
  font-family: inherit;
  cursor: pointer;
}
.ma-nav-btn--active {
  color: var(--text-primary);
  border-bottom-color: var(--accent-blue, #3b82f6);
}

/* ── Status screen ── */
.ma-status-screen {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.875rem;
  color: var(--text-muted);
}
.ma-err { color: var(--accent-red); }

/* ── Content ── */
.ma-content {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.tab-panel {
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.tab-panel--nospace {
  padding: 0;
  gap: 0;
}

/* ── Section title ── */
.section-title {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 0 0.25rem;
}

/* ── Empty message ── */
.empty-msg {
  text-align: center;
  padding: 2.5rem 1rem;
  font-size: 0.875rem;
  color: var(--text-muted);
}

/* ── Home card (MA card style) ── */
.home-panel {
  padding: 0.75rem;
}

.ma-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 0.9rem 0.9rem 0.7rem;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  overflow: hidden;
  position: relative;
  transition: background 0.6s;
}

.ma-bg-art {
  position: absolute;
  top: 0;
  right: 0;
  height: 100%;
  width: auto;
  object-fit: cover;
  z-index: 0;
  pointer-events: none;
  border-top-right-radius: 12px;
  border-bottom-right-radius: 12px;
  -webkit-mask-image: linear-gradient(to right, transparent 0%, black 25%);
  mask-image: linear-gradient(to right, transparent 0%, black 25%);
}

.ma-player-name {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.78rem;
  font-weight: 500;
  letter-spacing: 0.04em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  position: relative;
  z-index: 2;
}
.ma-player-icon { width: 14px; height: 14px; flex-shrink: 0; }

.ma-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  position: relative;
  z-index: 2;
}
.ma-track {
  font-size: 1.5rem;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ma-artist {
  font-size: 1.1rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ma-album {
  font-size: 0.9rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ma-controls {
  position: relative;
  z-index: 2;
}
.ma-btns {
  display: flex;
  align-items: center;
  gap: 0.1rem;
}
.ma-btn {
  background: transparent;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.2rem;
  border-radius: 6px;
  transition: opacity 0.15s;
}
.ma-btn svg { width: 22px; height: 22px; }
.ma-btn:active { opacity: 0.6; }
.ma-btn-play svg { width: 26px; height: 26px; }
.ma-btn-sm { margin-left: auto; }
.ma-btn-sm svg { width: 18px; height: 18px; }
.ma-btn-sm + .ma-btn-sm { margin-left: 0; }
.ma-btn-sm.active { opacity: 1; }

.ma-progress-row {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  position: relative;
  z-index: 2;
}
.ma-time {
  font-size: 0.65rem;
  min-width: 28px;
  flex-shrink: 0;
}
.ma-time--remaining { text-align: right; }
.ma-progress-track {
  flex: 1;
  height: 3px;
  background: rgba(255,255,255,0.2);
  border-radius: 2px;
  cursor: pointer;
}
.ma-progress-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.5s linear;
}

/* ── List card ── */
.list-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
}

.list-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.7rem 0.9rem;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  transition: background 0.15s;
}
.list-row:last-child { border-bottom: none; }
.list-row:active { background: var(--bg-card-hover, rgba(255,255,255,0.04)); }
.list-row--active { outline: 2px solid var(--accent-blue, #3b82f6); outline-offset: -2px; }

.list-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  color: var(--text-muted);
}
.list-info { flex: 1; min-width: 0; }
.list-name {
  font-size: 0.875rem;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.list-sub {
  font-size: 0.75rem;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 0.1rem;
}
.list-dur {
  font-size: 0.72rem;
  color: var(--text-muted);
  flex-shrink: 0;
}
.list-badge {
  font-size: 0.68rem;
  padding: 0.15rem 0.4rem;
  border-radius: 3px;
  background: var(--bg-base);
  border: 1px solid var(--border);
  color: var(--text-muted);
  flex-shrink: 0;
}
.state-playing { color: #22c55e; border-color: #22c55e; }
.state-paused  { color: #f59e0b; border-color: #f59e0b; }

/* ── Queue rows ── */
.queue-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.55rem 0.75rem;
  border-bottom: 1px solid var(--border);
  transition: background 0.15s;
}
.queue-row:last-child { border-bottom: none; }
.queue-row--current { background: rgba(59, 130, 246, 0.08); }
.queue-row--current .queue-name { color: var(--accent-blue, #3b82f6); }

.queue-idx {
  width: 22px;
  font-size: 0.68rem;
  color: var(--text-muted);
  text-align: right;
  flex-shrink: 0;
}
.queue-art {
  width: 38px;
  height: 38px;
  border-radius: 4px;
  object-fit: cover;
  flex-shrink: 0;
  background: var(--bg-base);
}
.queue-art--empty { border: 1px solid var(--border); }
.queue-info { flex: 1; min-width: 0; }
.queue-name {
  font-size: 0.85rem;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.queue-sub {
  font-size: 0.73rem;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 0.1rem;
}
.queue-dur {
  font-size: 0.7rem;
  color: var(--text-muted);
  flex-shrink: 0;
}


/* ── Radio ── */
.radio-art {
  width: 44px;
  height: 44px;
  border-radius: 6px;
  object-fit: cover;
  flex-shrink: 0;
}
.radio-art--empty {
  width: 44px;
  height: 44px;
  border-radius: 6px;
  background: var(--bg-base);
  border: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--text-muted);
}
.radio-art--empty svg { width: 20px; height: 20px; }

/* ── Browse ── */
.browse-bar {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.5rem 0.75rem;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border);
  min-height: 44px;
  flex-shrink: 0;
}
.browse-back-btn {
  background: transparent;
  border: none;
  color: var(--accent-blue, #3b82f6);
  cursor: pointer;
  padding: 0.2rem;
  display: flex;
  align-items: center;
  flex-shrink: 0;
}
.browse-back-btn svg { width: 24px; height: 24px; }
.browse-crumb {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.browse-chevron {
  width: 18px;
  height: 18px;
  color: var(--text-muted);
  flex-shrink: 0;
}

/* ── Settings ── */
.settings-panel {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
}
.setting-row { display: flex; flex-direction: column; gap: 0.4rem; }
.setting-label { font-size: 0.78rem; color: #9aa3bc; }
.setting-hint { font-size: 0.72rem; color: var(--accent-green); }
.setting-hint--warn { color: var(--text-muted); }
.setting-input {
  background: #2a3150;
  border: 1px solid #3d4870;
  border-radius: 6px;
  color: var(--text-primary);
  font-size: 0.875rem;
  font-family: inherit;
  padding: 0.5rem 0.65rem;
  outline: none;
  width: 100%;
}
.setting-input:focus { border-color: var(--accent-blue, #3b82f6); }
.setting-save-btn {
  background: var(--accent-blue, #3b82f6);
  border: none;
  border-radius: 6px;
  color: #fff;
  font-size: 0.875rem;
  font-family: inherit;
  padding: 0.6rem 1.25rem;
  cursor: pointer;
  align-self: flex-start;
}
.setting-status {
  font-size: 0.8rem;
  color: var(--text-secondary);
}
.status-ok   { color: #22c55e; }
.status-err  { color: var(--accent-red); }
.status-warn { color: var(--text-muted); }
.setting-hint--muted { color: var(--text-muted); opacity: 0.6; }

/* ── Sendspin toggle row ── */
.setting-row--toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}
.setting-toggle-info {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.setting-toggle-btn {
  flex-shrink: 0;
  width: 46px;
  height: 26px;
  border-radius: 13px;
  border: none;
  background: var(--border);
  padding: 3px;
  cursor: pointer;
  transition: background 0.2s;
  position: relative;
}
.setting-toggle-btn.active {
  background: #22c55e;
}
.setting-toggle-knob {
  display: block;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.2s;
  position: absolute;
  top: 3px;
  left: 3px;
}
.setting-toggle-btn.active .setting-toggle-knob {
  transform: translateX(20px);
}
</style>
