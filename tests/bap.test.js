// Integration tests for the BAP service and the middleware's HTTP client for
// it. Both processes are started for real, so these cover the network hop, the
// contract between them, and what happens when the dependency misbehaves.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const BAP_PORT = 4997;
const BAP_URL = `http://localhost:${BAP_PORT}/bap/intent`;

const started = [];

/** Starts a process and waits until `readyUrl` answers, so tests never race the boot. */
async function startProcess(script, env, readyUrl) {
  const proc = spawn(process.execPath, [script], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: 'ignore'
  });
  started.push(proc);

  const deadline = Date.now() + 20000;
  for (;;) {
    try {
      if ((await fetch(readyUrl)).ok) return proc;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error(`${script} did not start within 20s`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

const startBap = (env = {}) =>
  startProcess('bap-service/server.js', { BAP_PORT: String(BAP_PORT), ...env }, `http://localhost:${BAP_PORT}/health`);

const startMiddleware = (port, env = {}) =>
  startProcess('index.js', { PORT: String(port), NODE_ENV: 'development', ...env }, `http://localhost:${port}/test`);

const ask = async (port, query, sessionId = 'test-session') => {
  const res = await fetch(`http://localhost:${port}/ivr/conversation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, query })
  });
  return (await res.json())?.data?.response;
};

const dtmfBalance = async (port, sessionId) => {
  const res = await fetch(`http://localhost:${port}/ivr/input`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, inputType: 'DTMF', inputValue: '1' })
  });
  return (await res.json())?.data?.responseText;
};

after(() => {
  for (const proc of started) proc.kill();
});

describe('BAP service contract', () => {
  before(() => startBap());

  test('reports health and the intents it supports', async () => {
    const body = await (await fetch(`http://localhost:${BAP_PORT}/health`)).json();
    assert.equal(body.status, 'ok');
    for (const intent of [
      'GetBalance',
      'GetMiniStatement',
      'PayUtilityBill',
      'GetLoanDetails',
      'RequestEStatement',
      'AgentConnect'
    ]) {
      assert.ok(body.intents.includes(intent), `missing intent: ${intent}`);
    }
  });

  test('answers every intent with responseText', async () => {
    for (const intent of [
      'GetBalance',
      'GetMiniStatement',
      'PayUtilityBill',
      'GetLoanDetails',
      'RequestEStatement',
      'AgentConnect'
    ]) {
      const res = await fetch(BAP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: 's1', intent })
      });
      assert.equal(res.status, 200, `bad status for ${intent}`);
      const body = await res.json();
      assert.ok(body.responseText, `no responseText for ${intent}`);
      assert.equal(body.intent, intent);
    }
  });

  test('derives per-session data rather than returning a constant', async () => {
    const balanceFor = async (sessionId) => {
      const res = await fetch(BAP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, intent: 'GetBalance' })
      });
      return (await res.json()).data.balance;
    };
    assert.notEqual(await balanceFor('session-a'), await balanceFor('session-b'));
    // ...but the same session is stable across calls.
    assert.equal(await balanceFor('session-a'), await balanceFor('session-a'));
  });

  test('rejects a request missing sessionId or intent', async () => {
    const res = await fetch(BAP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 's1' })
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'invalid_request');
  });

  test('404s an unknown intent and lists the supported ones', async () => {
    const res = await fetch(BAP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 's1', intent: 'LaunchRocket' })
    });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, 'unknown_intent');
    assert.ok(Array.isArray(body.supported));
  });
});

describe('middleware calls BAP over HTTP', () => {
  const PORT = 3988;
  before(() => startMiddleware(PORT, { BAP_API_URL: BAP_URL }));

  // The mock strings are dollar-denominated; the BAP service answers in
  // rupees, which makes the two trivially distinguishable.
  test('BAP-backed intents return service data, not mock text', async () => {
    const cases = [
      ['show my mini statement', /transactions/i],
      ['loan details', /EMI/i],
      ['send my e-statement', /e-statement/i],
      ['connect me to an agent', /connected to a customer service agent/i]
    ];
    for (const [query, expected] of cases) {
      const answer = await ask(PORT, query);
      assert.match(answer, expected, `failed for: ${query}`);
      assert.ok(!answer.includes('(Mock Data)'), `served mock text for: ${query}`);
    }
  });

  test('DTMF balance reflects the calling session', async () => {
    const a = await dtmfBalance(PORT, 'session-a');
    const b = await dtmfBalance(PORT, 'session-b');
    assert.match(a, /balance is ₹/);
    assert.notEqual(a, b, 'same answer for different sessions suggests a constant');
  });
});

describe('middleware degrades gracefully when BAP misbehaves', () => {
  // Nothing is listening on this port.
  const DEAD_PORT = 3989;
  const DEAD_BAP = 'http://127.0.0.1:9/bap/intent';

  before(() => startMiddleware(DEAD_PORT, { BAP_API_URL: DEAD_BAP }));

  test('an unreachable BAP falls back to mock data, still 200', async () => {
    const res = await fetch(`http://localhost:${DEAD_PORT}/ivr/input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 's1', inputType: 'DTMF', inputValue: '1' })
    });
    assert.equal(res.status, 200, 'a downstream outage must not surface as an error');
    assert.match((await res.json()).data.responseText, /Mock Data/);
  });

  test('conversation intents also fall back rather than failing', async () => {
    const answer = await ask(DEAD_PORT, 'show my mini statement');
    assert.match(answer, /transactions/i);
  });
});

describe('USE_BAP_MOCK forces mocks even with a healthy BAP', () => {
  const PORT = 3990;
  before(() => startMiddleware(PORT, { BAP_API_URL: BAP_URL, USE_BAP_MOCK: 'true' }));

  test('skips the network call entirely', async () => {
    assert.match(await dtmfBalance(PORT, 'session-a'), /Mock Data/);
  });
});

describe('a slow BAP is treated as a failure', () => {
  const PORT = 3991;
  const SLOW_BAP_PORT = 4998;

  before(async () => {
    await startProcess(
      'bap-service/server.js',
      { BAP_PORT: String(SLOW_BAP_PORT), BAP_LATENCY_MS: '3000' },
      `http://localhost:${SLOW_BAP_PORT}/health`
    );
    await startMiddleware(PORT, {
      BAP_API_URL: `http://localhost:${SLOW_BAP_PORT}/bap/intent`,
      BAP_TIMEOUT_MS: '300'
    });
  });

  test('times out and falls back instead of hanging the caller', async () => {
    const startedAt = Date.now();
    const answer = await dtmfBalance(PORT, 'session-a');
    const elapsed = Date.now() - startedAt;
    assert.match(answer, /Mock Data/);
    assert.ok(elapsed < 2500, `took ${elapsed}ms — the timeout does not appear to be applied`);
  });
});
