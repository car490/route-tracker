// pi-server/announceRelay.test.js
//
// Exercises the real `ws` library end-to-end against a real (ephemeral-port)
// http.createServer + attachAnnounceRelay — see announceRelay.mjs's header
// comment for the protocol. Co-located under pi-server/ per its own
// convention; picked up by the same vitest run as src/**/*.test.js (see
// vitest.config.js).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import WebSocket from 'ws';
import { attachAnnounceRelay } from './announceRelay.mjs';

const TOKEN = 'test-token';

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => { res.writeHead(404); res.end(); });
    attachAnnounceRelay(server, { token: TOKEN });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function waitFor(emitter, event) {
  return new Promise((resolve, reject) => {
    emitter.once(event, resolve);
    emitter.once('error', reject);
  });
}

describe('announceRelay', () => {
  let server;
  let port;
  const sockets = [];

  beforeEach(async () => {
    server = await startServer();
    port = server.address().port;
  });

  afterEach(async () => {
    for (const ws of sockets) ws.close();
    sockets.length = 0;
    await new Promise((resolve) => server.close(resolve));
  });

  function connect(path, token) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}?token=${token}`);
    sockets.push(ws);
    return ws;
  }

  it('rejects a connection with a missing/wrong token', async () => {
    const ws = connect('/sign-feed', 'wrong');
    const status = await new Promise((resolve) => {
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode));
      ws.on('error', () => {}); // the client also emits a generic error on the same rejection — ignored, asserted via unexpected-response instead
    });
    expect(status).toBe(401);
  });

  it('relays a driver-pushed state message to a connected sign-feed client', async () => {
    const driver = connect('/driver-push', TOKEN);
    await waitFor(driver, 'open');
    const sign = connect('/sign-feed', TOKEN);
    await waitFor(sign, 'open');

    const received = new Promise((resolve) => sign.once('message', (data) => resolve(JSON.parse(data.toString()))));
    driver.send(JSON.stringify({ type: 'state', journeyId: 'j1', nextStopIndex: 2 }));

    const msg = await received;
    expect(msg.journeyId).toBe('j1');
    expect(msg.nextStopIndex).toBe(2);
  });

  it('sends the latest known state immediately to a newly-connected sign-feed client', async () => {
    const driver = connect('/driver-push', TOKEN);
    await waitFor(driver, 'open');
    driver.send(JSON.stringify({ type: 'state', journeyId: 'j2', nextStopIndex: 1 }));
    // Give the relay a tick to process the message before the new subscriber connects.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const sign = connect('/sign-feed', TOKEN);
    const msg = await new Promise((resolve) => sign.once('message', (data) => resolve(JSON.parse(data.toString()))));
    expect(msg.journeyId).toBe('j2');
  });

  it('a sign-feed client with nothing pushed yet gets no message (not an empty/garbage one)', async () => {
    const sign = connect('/sign-feed', TOKEN);
    await waitFor(sign, 'open');
    let received = false;
    sign.once('message', () => { received = true; });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(received).toBe(false);
  });

  it('ignores malformed JSON from a driver connection without dropping the connection', async () => {
    const driver = connect('/driver-push', TOKEN);
    await waitFor(driver, 'open');
    driver.send('not json');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(driver.readyState).toBe(WebSocket.OPEN);
  });

  it('ignores a message with an unrecognized type', async () => {
    const driver = connect('/driver-push', TOKEN);
    await waitFor(driver, 'open');
    const sign = connect('/sign-feed', TOKEN);
    await waitFor(sign, 'open');

    let received = false;
    sign.once('message', () => { received = true; });
    driver.send(JSON.stringify({ type: 'ping' }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(received).toBe(false);
  });
});
