import http from 'node:http';
import https from 'node:https';
// grammY/node-fetch use node:http. Fail closed before any non-loopback socket opens.
const request = http.request;
http.request = ((...args: Parameters<typeof http.request>) => {
  const target = args[0];
  const host = typeof target === 'string' ? new URL(target).hostname : target instanceof URL ? target.hostname : target.hostname ?? target.host;
  if (host !== '127.0.0.1' && host !== 'localhost') throw Error('External network forbidden in tests');
  return Reflect.apply(request, http, args);
}) as typeof http.request;
https.request = (() => { throw Error('External network forbidden in tests'); }) as typeof https.request;
