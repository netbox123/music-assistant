import { ref } from 'vue';
import { SendspinPlayer } from '@sendspin/sendspin-js';

let player        = null;
let pendingBridge = null;   // Authenticated WS, waiting for sendspin-js to pick it up
let OriginalWS    = null;

export const sendspinConnected = ref(false);
export const sendspinPlaying   = ref(false);
export const sendspinError     = ref('');

// ── Persistent client ID ───────────────────────────────────────────────────────
function getClientId() {
  const KEY = 'sendspin_webplayer_id';
  return localStorage.getItem(KEY) ?? (() => {
    const id = Math.random().toString(36).slice(2, 10);
    localStorage.setItem(KEY, id);
    return id;
  })();
}

// ── Step 1: open a real WS to MA, authenticate, resolve with ready socket ──────
//
// MA's /sendspin endpoint works as follows:
//   1. Client connects
//   2. Client sends:  { type: "auth", token: "<ma_token>", client_id: "<id>" }
//   3. Server replies with any message (auth ack — discarded)
//   4. Sendspin protocol begins (client/hello → server/hello → …)
//
// Remember the Caddy/remote host whenever the app is loaded via HTTPS so we can
// fall back to it when the local network is unreachable (e.g. car WiFi).
const REMOTE_HOST_KEY = 'ma_remote_host';
if (window.location.protocol === 'https:') {
  localStorage.setItem(REMOTE_HOST_KEY, window.location.host);
}

function buildSessionUrl(maUrl) {
  const isHttps  = window.location.protocol === 'https:';
  const remote   = localStorage.getItem(REMOTE_HOST_KEY);

  if (isHttps) {
    // Caddy HTTPS: /ma-proxy/* is auth-exempt and proxied directly to MA
    return `wss://${window.location.host}/ma-proxy/sendspin`;
  }
  // HTTP (local): serve.js WebSocket proxy
  let maWsUrl;
  try {
    const u = new URL(maUrl);
    maWsUrl = `ws://${u.host}/sendspin`;
  } catch {
    maWsUrl = maUrl.replace(/^http/, 'ws').replace(/\/$/, '') + '/sendspin';
  }
  return `ws://${window.location.host}/sendspin?url=${encodeURIComponent(maWsUrl)}`;
}

function buildRemoteFallbackUrl() {
  const remote = localStorage.getItem(REMOTE_HOST_KEY);
  return remote ? `wss://${remote}/ma-proxy/sendspin` : null;
}

function prepareSession(maUrl, maToken, urlOverride = null) {
  return new Promise((resolve, reject) => {
    const url = urlOverride ?? buildSessionUrl(maUrl);

    let ws;
    try {
      ws = new (OriginalWS || window.WebSocket)(url);
    } catch (e) {
      reject(e);
      return;
    }
    ws.binaryType = 'arraybuffer';

    let ready = false;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'auth', token: maToken, client_id: getClientId() }));
    };

    ws.onmessage = () => {
      // First message after auth = auth ack — discard it, resolve with the ready socket
      if (!ready) {
        ready = true;
        resolve(ws);
      }
    };

    ws.onerror = () => {
      if (!ready) reject(new Error(`Cannot reach MA at ${url} — check server URL`));
    };

    ws.onclose = (e) => {
      if (!ready) {
        const reason = e.reason ? ` "${e.reason}"` : '';
        if (e.code === 4001) {
          reject(new Error(`MA rejected token (code 4001)${reason} — check token in Settings`));
        } else if (e.code === 1006) {
          reject(new Error(`No route to /sendspin (code 1006) — MA may not have Sendspin enabled`));
        } else {
          reject(new Error(`WS closed (code ${e.code})${reason}`));
        }
      }
    };

    setTimeout(() => {
      if (!ready) { ws.close(); reject(new Error('Auth timed out')); }
    }, 10000);
  });
}

// ── Step 2: wrap the authenticated socket in a bridge for sendspin-js ──────────
function makeBridge(ws) {
  const bridge = {
    _isOpen: ws.readyState === 1,
    onopen:    null,
    onmessage: null,
    onerror:   null,
    onclose:   null,
    CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3,
    get readyState() { return ws.readyState; },
    send(data)       { if (ws.readyState === 1) ws.send(data); },
    close(c, r)      { ws.close(c, r); },
    addEventListener(t, fn) {
      if (t === 'open'    && typeof fn === 'function') {
        bridge.onopen = fn;
        if (bridge._isOpen) setTimeout(() => fn(new Event('open')), 0);
      } else if (t === 'message' && typeof fn === 'function') bridge.onmessage = fn;
      else if (t === 'error'   && typeof fn === 'function') bridge.onerror   = fn;
      else if (t === 'close'   && typeof fn === 'function') bridge.onclose   = fn;
    },
    removeEventListener() {},
    dispatchEvent()       { return false; },
  };

  ws.onopen    = (e) => { bridge._isOpen = true; if (bridge.onopen)    bridge.onopen(e);    };
  ws.onmessage = (e) => {                          if (bridge.onmessage) bridge.onmessage(e); };
  ws.onerror   = (e) => {                          if (bridge.onerror)   bridge.onerror(e);   };
  ws.onclose   = (e) => {                          if (bridge.onclose)   bridge.onclose(e);   };

  return bridge;
}

// ── Step 3: intercept window.WebSocket so sendspin-js picks up the bridge ──────
//
// sendspin-js calls `new WebSocket("ws://sendspin.local/sendspin")` internally.
// We intercept URLs containing "/sendspin" and hand back the pre-authenticated bridge.
//
function installInterceptor() {
  if (OriginalWS) return;   // already installed
  OriginalWS = window.WebSocket;

  function Intercepted(url /*, protocols*/) {
    if (String(url).includes('/sendspin') && pendingBridge) {
      const b = pendingBridge;
      pendingBridge = null;

      // Return a proxy object that mirrors the bridge.
      // We need property setters so sendspin-js can do `ws.onopen = handler`.
      const proxy = {
        binaryType: 'arraybuffer',
        bufferedAmount: 0, extensions: '', protocol: '', url: '',
        CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3,
        get readyState() { return b.readyState; },
        send(data)  { b.send(data); },
        close(c, r) { b.close(c, r); },
        addEventListener:    (...a) => b.addEventListener(...a),
        removeEventListener: ()     => {},
        dispatchEvent:       ()     => false,
      };

      // Property setters so that `proxy.onopen = fn` wires into the bridge
      for (const ev of ['onopen', 'onmessage', 'onerror', 'onclose']) {
        Object.defineProperty(proxy, ev, {
          get: ()  => b[ev],
          set: (fn) => {
            b[ev] = fn;
            if (ev === 'onopen' && fn && b._isOpen) {
              setTimeout(() => fn(new Event('open')), 0);
            }
          },
          configurable: true,
        });
      }

      return proxy;
    }
    // Not a sendspin URL — use the real WebSocket
    return new OriginalWS(url);
  }

  Intercepted.CONNECTING = 0;
  Intercepted.OPEN       = 1;
  Intercepted.CLOSING    = 2;
  Intercepted.CLOSED     = 3;

  window.WebSocket = Intercepted;
}

function uninstallInterceptor() {
  if (OriginalWS) {
    window.WebSocket = OriginalWS;
    OriginalWS = null;
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────
let _lastUrl   = '';
let _lastToken = '';
let _reconnectTimer = null;

export async function startSendspin(maUrl, maToken) {
  stopSendspin();
  _lastUrl   = maUrl;
  _lastToken = maToken;
  sendspinError.value     = '';
  sendspinConnected.value = false;

  // Install interceptor first (before any WebSocket calls)
  installInterceptor();

  // Prepare authenticated session — try local path first, then remote fallback
  let ws;
  try {
    ws = await prepareSession(maUrl, maToken);
  } catch (e) {
    const fallback = buildRemoteFallbackUrl();
    if (fallback && fallback !== buildSessionUrl(maUrl)) {
      try {
        ws = await prepareSession(maUrl, maToken, fallback);
      } catch (e2) {
        sendspinError.value = `Auth failed: ${e2.message}`;
        uninstallInterceptor();
        return;
      }
    } else {
      sendspinError.value = `Auth failed: ${e.message}`;
      uninstallInterceptor();
      return;
    }
  }

  pendingBridge = makeBridge(ws);

  // Create the player — it will call `new WebSocket("ws://sendspin.local/sendspin")`
  // which our interceptor catches and hands the bridge to.
  try {
    player = new SendspinPlayer({
      baseUrl:        'http://sendspin.local',
      clientName:     'MA Mobile',
      correctionMode: 'quality-local',
      onStateChange(state) {
        sendspinConnected.value = player?.isConnected ?? false;
        sendspinPlaying.value   = state.isPlaying;
      },
    });

    await player.connect();
    sendspinConnected.value = true;
    sendspinError.value     = '';
  } catch (e) {
    sendspinError.value     = `Sendspin error: ${e?.message || e?.type || String(e)}`;
    sendspinConnected.value = false;
  }
}

export function stopSendspin() {
  clearTimeout(_reconnectTimer);
  if (player) {
    try { player.disconnect('user_request'); } catch { /* ignore */ }
    player = null;
  }
  pendingBridge = null;
  uninstallInterceptor();
  sendspinConnected.value = false;
  sendspinPlaying.value   = false;
}

// Auto-reconnect when network comes back (WiFi → cellular or vice versa)
// Retries up to 5 times with increasing delays to let the new network stabilise.
async function reconnectWithRetry(attempt = 1) {
  if (!_lastUrl) return;
  if (sendspinConnected.value) return;
  if (localStorage.getItem('ma_sendspin') !== '1') return;

  sendspinError.value = `Reconnecting… (attempt ${attempt})`;
  await startSendspin(_lastUrl, _lastToken);

  if (!sendspinConnected.value && attempt < 5) {
    const delay = attempt * 3000;   // 3s, 6s, 9s, 12s
    _reconnectTimer = setTimeout(() => reconnectWithRetry(attempt + 1), delay);
  }
}

function onNetworkOnline() {
  if (!_lastUrl) return;
  if (sendspinConnected.value) return;
  if (localStorage.getItem('ma_sendspin') !== '1') return;

  clearTimeout(_reconnectTimer);
  // Initial delay — let the new network interface settle
  _reconnectTimer = setTimeout(() => reconnectWithRetry(1), 3000);
}

window.addEventListener('online', onNetworkOnline);
