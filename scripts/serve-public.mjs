import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const host = option('--host', '127.0.0.1');
const port = Number(option('--port', '4173'));
const root = join(process.cwd(), 'public');
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };

createServer((request, response) => {
  const requested = decodeURIComponent(new URL(request.url ?? '/', 'http://local').pathname);
  const relative = requested === '/' ? 'index.html' : requested.replace(/^\/+/, '');
  const safePath = normalize(relative).replace(/^(\.\.(\/|\\|$))+/, '');
  let filePath = join(root, safePath);

  if (!filePath.startsWith(root) || !existsSync(filePath)) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }

  if (statSync(filePath).isDirectory()) filePath = join(filePath, 'index.html');
  response.writeHead(200, { 'content-type': mime[extname(filePath)] ?? 'application/octet-stream' });
  createReadStream(filePath).pipe(response);
}).listen(port, host, () => {
  process.stdout.write(`ProjectMind landing page: http://${host}:${port}\n`);
});
