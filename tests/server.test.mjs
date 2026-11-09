import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, copyFile, writeFile, rm } from 'node:fs/promises';

function request(port, pathname, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: pathname, method }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body }));
      response.on('error', reject);
    });
    req.setTimeout(3000, () => req.destroy(new Error('HTTP request timed out')));
    req.on('error', reject);
    req.end();
  });
}

test('static server keeps raw data private after filesystem path normalization', async t => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'matrix-server-'));
  let child;
  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
    const resolved = path.resolve(fixture);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(resolved).startsWith('matrix-server-'));
    await rm(resolved, { recursive: true, force: true });
  });
  await copyFile(new URL('../server.mjs', import.meta.url), path.join(fixture, 'server.mjs'));
  await writeFile(path.join(fixture, 'package.json'), JSON.stringify({ version: '0.2.1', type: 'module' }));
  for (const directory of ['data/raw', 'config', 'assets']) await mkdir(path.join(fixture, directory), { recursive: true });
  for (const [name, body] of [
    ['index.html', '<h1>Public page</h1>'], ['data/public.json', '{"public":true}'],
    ['config/public.json', '{}'], ['assets/public.svg', '<svg/>'],
    ['data/raw/private.json', '{"private":"raw-fixture-only"}'], ['private.txt', 'not public'],
  ]) await writeFile(path.join(fixture, name), body);

  const reservation = net.createServer();
  await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve); });
  const port = reservation.address().port;
  await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  child = spawn(process.execPath, [path.join(fixture, 'server.mjs')], {
    env: { ...process.env, MATRIX_PORT: String(port) }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server did not start')), 8000);
    let output = '';
    child.on('error', reject);
    child.stderr.on('data', chunk => { output += chunk; });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Server exited ${code}: ${output}`)); });
    child.stdout.on('data', () => { clearTimeout(timeout); resolve(); });
  });

  for (const pathname of ['/', '/data/public.json', '/config/public.json', '/assets/public.svg']) {
    assert.equal((await request(port, pathname)).status, 200, pathname);
  }
  for (const pathname of [
    '/data/raw/private.json', '/data//raw/private.json', '/data/%72aw/private.json',
    '/data/Raw/private.json', '/data/%52aw/private.json', '/data/raw%5cprivate.json',
    '/private.txt', '/server.mjs', '/package.json', '/data/%2e%2e/private.txt',
  ]) {
    for (const method of ['GET', 'HEAD']) {
      const response = await request(port, pathname, method);
      assert.equal(response.status, 404, `${method} ${pathname}`);
      assert.ok(!response.body.includes('raw-fixture-only'));
    }
  }
});
