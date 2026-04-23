import { execSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const distDir = path.join(projectRoot, 'dist');
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '127.0.0.1';
const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.ico', 'image/x-icon'],
  ['.ogg', 'audio/ogg'],
  ['.mp3', 'audio/mpeg'],
  ['.wav', 'audio/wav'],
  ['.map', 'application/json; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

function log(message) {
  console.log(`[deploy-local] ${message}`);
}

function buildApp() {
  log('Building app...');
  execSync('npm run build', {
    cwd: projectRoot,
    stdio: 'inherit',
  });
}

function startServer() {
  if (!fs.existsSync(distDir)) {
    throw new Error(`Build output not found at ${distDir}`);
  }

  const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url || '/', `http://${req.headers.host || `${host}:${port}`}`);
    const pathname = decodeURIComponent(requestUrl.pathname);
    const safePath = pathname.startsWith('/') ? pathname.slice(1) : pathname;
    const resolvedPath = path.resolve(distDir, safePath);
    const isInsideDist = resolvedPath === distDir || resolvedPath.startsWith(`${distDir}${path.sep}`);

    if (!isInsideDist) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    const candidates = [];
    if (safePath) {
      candidates.push(resolvedPath);
      if (!path.extname(resolvedPath)) {
        candidates.push(path.join(resolvedPath, 'index.html'));
      }
    }
    candidates.push(path.join(distDir, 'index.html'));

    const filePath = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());

    if (!filePath) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes.get(ext) || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });

  server.listen(port, host, () => {
    log(`Serving ${distDir}`);
    log(`Open http://${host}:${port}`);
  });
}

try {
  buildApp();
  startServer();
} catch (error) {
  console.error('[deploy-local] Failed:', error instanceof Error ? error.message : error);
  process.exit(1);
}
