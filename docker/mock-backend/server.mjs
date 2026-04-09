import { createServer } from 'node:http';

const PORT = Number(process.env.PORT || 4010);

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

const server = createServer(async (req, res) => {
  const method = req.method || 'GET';
  const url = req.url || '/';

  if (method === 'GET' && url === '/health') {
    sendJson(res, 200, { ok: true, service: 'mock-backend' });
    return;
  }

  if (method === 'GET' && url === '/api/ping') {
    sendJson(res, 200, { ok: true, pong: true, at: new Date().toISOString() });
    return;
  }

  if (method === 'POST' && url === '/api/echo') {
    try {
      const body = await readJsonBody(req);
      sendJson(res, 200, { ok: true, echo: body });
    } catch (error) {
      sendJson(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
    return;
  }

  sendJson(res, 404, { ok: false, error: 'Not found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('[mock-backend] listening on port', PORT);
});

function shutdown() {
  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
