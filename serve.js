import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createConnection } from 'net';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, 'dist');
const PORT = 3001;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
  '.woff2': 'font/woff2',
  '.woff':  'font/woff',
  '.json':  'application/json',
};

const server = http.createServer(async (req, res) => {
  const rawPath = req.url.split('?')[0];

  // Image proxy — fetches upstream URL server-side (avoids CORS, converts to JPEG for canvas)
  if (rawPath === '/api/imageproxy') {
    const params = new URLSearchParams(req.url.slice(req.url.indexOf('?') + 1));
    const url = params.get('url');
    if (!url || !url.startsWith('http')) { res.writeHead(400); res.end(); return; }
    try {
      const upstream = await fetch(url);
      if (!upstream.ok) { res.writeHead(upstream.status); res.end(); return; }
      const buf = Buffer.from(await upstream.arrayBuffer());
      const ct = upstream.headers.get('content-type') || 'image/jpeg';
      res.writeHead(200, { 'Content-Type': ct });
      res.end(buf);
    } catch { res.writeHead(502); res.end(); }
    return;
  }

  const urlPath = rawPath.replace(/^\/ma(\/|$)/, '/');
  let filePath = path.join(DIST, urlPath);

  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) filePath = path.join(filePath, 'index.html');
  } catch {
    filePath = path.join(DIST, 'index.html');
  }

  try {
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

// WebSocket proxy for Sendspin — tunnels ws://[app]/sendspin?url=ws://[ma]/sendspin
// This avoids cross-origin/Origin-header rejections from the MA server.
server.on('upgrade', (req, socket, head) => {
  const rawPath = req.url.split('?')[0];
  if (rawPath !== '/sendspin') { socket.destroy(); return; }

  const params = new URLSearchParams(req.url.slice(req.url.indexOf('?') + 1));
  const target = params.get('url');
  if (!target || !/^wss?:\/\//.test(target)) { socket.destroy(); return; }

  let u;
  try { u = new URL(target); } catch { socket.destroy(); return; }

  const port = parseInt(u.port || (u.protocol === 'wss:' ? '443' : '80'));

  const proxy = createConnection(port, u.hostname, () => {
    // Forward the HTTP upgrade request to MA, spoofing Origin to match MA's own frontend
    const maOrigin = `${u.protocol === 'wss:' ? 'https' : 'http'}://${u.host}`;
    let headers  = `GET ${u.pathname} HTTP/1.1\r\n`;
    headers += `Host: ${u.host}\r\n`;
    headers += `Origin: ${maOrigin}\r\n`;
    headers += `Upgrade: websocket\r\n`;
    headers += `Connection: Upgrade\r\n`;
    headers += `Sec-WebSocket-Key: ${req.headers['sec-websocket-key']}\r\n`;
    headers += `Sec-WebSocket-Version: ${req.headers['sec-websocket-version'] || '13'}\r\n`;
    if (req.headers['sec-websocket-extensions'])
      headers += `Sec-WebSocket-Extensions: ${req.headers['sec-websocket-extensions']}\r\n`;
    headers += '\r\n';
    proxy.write(headers);
    if (head && head.length) proxy.write(head);
  });

  proxy.on('data',  (d) => socket.write(d));
  socket.on('data', (d) => proxy.write(d));
  socket.on('end',  ()  => proxy.end());
  proxy.on('end',   ()  => socket.end());
  socket.on('error', () => proxy.destroy());
  proxy.on('error',  (e) => {
    console.error('[sendspin-proxy] error:', e.message);
    socket.destroy();
  });
});

server.listen(PORT, () => console.log(`[MusicAssistant] Running at http://localhost:${PORT}`));
