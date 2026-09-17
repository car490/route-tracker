// Zero-dependency dev server. Run: node server.js
const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.mp3':  'audio/mpeg',
};

function handleRequest(req, res) {
  const [reqPath, queryString] = req.url.split('?');

  // A same-URL rewrite (serving driver/index.html's bytes while the browser
  // still shows '/') breaks every relative asset reference in that file --
  // <script src="src/main.js"> etc. resolve against the visible URL, not
  // the file's real directory, so main.js 404s and nothing ever renders
  // beyond the static HTML. A real redirect changes the URL bar to
  // /driver/ first, so relative paths resolve correctly. Query string
  // (e.g. ?debug) must survive the redirect -- see CLAUDE.md.
  if (reqPath === '/') {
    res.writeHead(302, { Location: '/driver/' + (queryString ? `?${queryString}` : '') });
    res.end();
    return;
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(reqPath);
  } catch (_) {
    res.writeHead(400); res.end('Bad request'); return;
  }

  const urlPath = decodedPath.endsWith('/') ? `${decodedPath}index.html` : decodedPath;
  const filePath = path.join(__dirname, urlPath);

  // Guard against path traversal escaping this directory. The `+ path.sep`
  // matters: a plain `filePath.startsWith(root)` would also wrongly allow
  // escaping into a sibling directory whose name happens to start with the
  // root's own name (e.g. root /app vs /app-secret).
  const root = path.resolve(__dirname);
  if (!path.resolve(filePath).startsWith(root + path.sep)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const mime = MIME[path.extname(filePath)] ?? 'text/plain';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
}

if (require.main === module) {
  http.createServer(handleRequest).listen(PORT, () =>
    console.log(`Route Tracker running → http://localhost:${PORT}/`)
  );
}

module.exports = { handleRequest };
