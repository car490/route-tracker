const fs = require('fs');
const path = require('path');
const { handleRequest } = require('../server.js');

// Calls handleRequest with a mock res and resolves with that res once the
// response has actually completed. handleRequest completes synchronously
// for the redirect / decode-error / traversal-blocked paths (res.end is
// called before handleRequest returns) and asynchronously for the
// fs.readFile-backed paths (200/404) -- so we check synchronously first and
// only fall back to waiting on res.end being invoked for the async case.
function callAndWaitForEnd(req) {
  let resolveEnd;
  const donePromise = new Promise((resolve) => { resolveEnd = resolve; });

  const res = {
    writeHead: jest.fn(),
    end: jest.fn(() => resolveEnd()),
  };

  handleRequest(req, res);

  if (res.end.mock.calls.length > 0) {
    return Promise.resolve(res);
  }
  return donePromise.then(() => res);
}

describe('server.js handleRequest', () => {
  test('redirects / to /driver/', async () => {
    const res = await callAndWaitForEnd({ url: '/' });
    expect(res.writeHead).toHaveBeenCalledWith(302, { Location: '/driver/' });
  });

  test('redirects / to /driver/ preserving query string', async () => {
    const res = await callAndWaitForEnd({ url: '/?debug' });
    expect(res.writeHead).toHaveBeenCalledWith(302, { Location: '/driver/?debug' });
  });

  test('serves a real file that exists under the root', async () => {
    const packageJsonPath = path.join(__dirname, '..', 'package.json');
    expect(fs.existsSync(packageJsonPath)).toBe(true);

    const res = await callAndWaitForEnd({ url: '/package.json' });
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.anything());
    expect(res.end).toHaveBeenCalledTimes(1);
    const body = res.end.mock.calls[0][0].toString();
    expect(body).toContain('"name": "busops"');
  });

  test('blocks raw path traversal to a real sibling file', async () => {
    const escapedPath = path.join(__dirname, '..', '..', 'package.json');
    expect(fs.existsSync(escapedPath)).toBe(true);

    const res = await callAndWaitForEnd({ url: '/../package.json' });
    expect(res.writeHead).toHaveBeenCalledWith(403);
    expect(res.writeHead).not.toHaveBeenCalledWith(200, expect.anything());
  });

  test('blocks a deeper raw path traversal attempt', async () => {
    const res = await callAndWaitForEnd({ url: '/../../../../../../etc/passwd' });
    expect(res.writeHead).toHaveBeenCalledWith(403);
  });

  test('blocks URL-encoded path traversal', async () => {
    const res = await callAndWaitForEnd({ url: '/%2e%2e/package.json' });
    expect(res.writeHead).toHaveBeenCalledWith(403);
  });

  test('returns 400 for malformed percent-encoding without throwing', async () => {
    await expect(callAndWaitForEnd({ url: '/%zz' })).resolves.toBeDefined();
    const res = await callAndWaitForEnd({ url: '/%zz' });
    expect(res.writeHead).toHaveBeenCalledWith(400);
  });

  test('returns 404 for a genuinely missing file under the root', async () => {
    const res = await callAndWaitForEnd({ url: '/does-not-exist-xyz.html' });
    expect(res.writeHead).toHaveBeenCalledWith(404);
  });
});
