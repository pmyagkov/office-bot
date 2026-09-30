import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
export async function fakeServer() {
  const calls: { method: string; payload: Record<string, unknown> }[] = [];
  const responses: unknown[] = [];
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += String(chunk);
    calls.push({ method: req.url!.split('/').at(-1)!, payload: JSON.parse(body || '{}') });
    const response = responses.shift();
    if (response === 'disconnect') { req.socket.destroy(); return; }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(response ?? { ok: true, result: [] }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return { calls, responses, apiRoot: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }) };
}
