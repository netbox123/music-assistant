import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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

server.listen(PORT, () => console.log(`[MusicAssistant] Running at http://localhost:${PORT}`));
