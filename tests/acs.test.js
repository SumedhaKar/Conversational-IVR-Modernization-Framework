// Integration tests for the ACS service and the middleware's HTTP client for
// it. Mirrors tests/bap.test.js: both processes run for real, so the network
// hop, the contract, and the failure modes are all covered.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ACS_PORT = 4996;
const ACS_URL = `http://localhost:${ACS_PORT}/acs/intent`;

const started = [];

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

const startAcs = (env = {}) =>
  startProcess('acs-service/server.js', { ACS_PORT: String(ACS_PORT), ...env }, `http://localhost:${ACS_PORT}/health`);

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

after(() => {
  for (const proc of started) proc.kill();
});

describe('ACS service contract', () => {
  before(() => startAcs());

  test('reports health and every supported intent', async () => {
    const body = await (await fetch(`http://localhost:${ACS_PORT}/health`)).json();
    assert.equal(body.status, 'ok');
    for (const intent of [
      'ACS_BALANCE',
      'ACS_RECHARGE',
      'ACS_REPORT_LOST_CARD',
      'ACS_ACTIVATE_CARD',
      'ACS_UPDATE_CONTACT',
      'ACS_REPORT_SUSPICIOUS',
      'ACS_START_CALL',
      'ACS_STOP_CALL',
      'ACS_SEND_DTMF'
    ]) {
      assert.ok(body.intents.includes(intent), `missing intent: ${intent}`);
    }
  });

  // Intent names are shared verbatim with detectIntent, so a rename there that
  // is not mirrored here shows up as a 404 rather than silently falling back.
  test('answers every intent detectIntent can produce', async () => {
    for (const intent of [
      'ACS_BALANCE',
      'ACS_RECHARGE',
      'ACS_REPORT_LOST_CARD',
      'ACS_ACTIVATE_CARD',
      'ACS_UPDATE_CONTACT',
      'ACS_REPORT_SUSPICIOUS'
    ]) {
      const res = await fetch(ACS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: 's1', intent })
      });
      assert.equal(res.status, 200, `bad status for ${intent}`);
      assert.ok((await res.json()).responseText, `no responseText for ${intent}`);
    }
  });

  test('honours a recharge amount when given one', async () => {
    const res = await fetch(ACS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 's1', intent: 'ACS_RECHARGE', params: { amount: 250 } })
    });
    const body = await res.json();
    assert.equal(body.data.amount, 250);
    assert.match(body.responseText, /250/);
  });

  test('derives per-session data rather than returning a constant', async () => {
    const balanceFor = async (sessionId) => {
      const res = await fetch(ACS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, intent: 'ACS_BALANCE' })
      });
      return (await res.json()).data.balance;
    };
    assert.notEqual(await balanceFor('session-a'), await balanceFor('session-b'));
    assert.equal(await balanceFor('session-a'), await balanceFor('session-a'));
  });

  test('rejects a missing intent and 404s an unknown one', async () => {
    const bad = await fetch(ACS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 's1' })
    });
    assert.equal(bad.status, 400);

    const unknown = await fetch(ACS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 's1', intent: 'ACS_MAKE_TEA' })
    });
    assert.equal(unknown.status, 404);
    assert.equal((await unknown.json()).error, 'unknown_intent');
  });
});

describe('middleware calls ACS over HTTP', () => {
  const PORT = 3992;
  before(() => startMiddleware(PORT, { ACS_API_URL: ACS_URL }));

  // Every ACS intent, driven through natural language so detection and
  // dispatch are both exercised. Previously acsService re-matched the query
  // and could reject an intent detectIntent had already resolved.
  test('routes every ACS intent end to end', async () => {
    const cases = [
      ['what is my balance', /balance is ₹/],
      ['I want to recharge', /Recharge successful/i],
      ['I lost my debit card', /blocked immediately/i],
      ['activate my new card', /16-digit card number/i],
      ['update contact details', /secure link/i],
      ['report a suspicious transaction', /temporary hold/i]
    ];
    for (const [query, expected] of cases) {
      assert.match(await ask(PORT, query), expected, `failed for: ${query}`);
    }
  });

  test('balance reflects the calling session rather than a constant', async () => {
    const a = await ask(PORT, 'what is my balance', 'session-a');
    const b = await ask(PORT, 'what is my balance', 'session-b');
    assert.match(a, /balance is ₹/);
    assert.notEqual(a, b, 'same answer for different sessions suggests a constant');
  });
});

describe('the /acs/* routes go through acsService', () => {
  const PORT = 3996;
  const acsPost = (port, route, body) =>
    fetch(`http://localhost:${port}${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

  before(() => startMiddleware(PORT, { ACS_API_URL: ACS_URL }));

  // These three previously built their responses inline in acsController and
  // never reached acsService, so they stayed mocked even with ACS configured.
  test('call control is answered by the service', async () => {
    const start = await (await acsPost(PORT, '/acs/start', { sessionId: 'route-a' })).json();
    assert.equal(start.data.sessionId, 'route-a');
    assert.match(start.data.message, /Call started successfully/);
    assert.notEqual(start.data.callId, 'mocked-call-123', 'still returning the inline placeholder');

    const stop = await (await acsPost(PORT, '/acs/stop', { sessionId: 'route-a' })).json();
    assert.match(stop.data.message, /Call stopped successfully/);

    const dtmf = await (await acsPost(PORT, '/acs/sendDTMF', { sessionId: 'route-a', digit: '7' })).json();
    assert.equal(dtmf.data.digit, '7');
    assert.match(dtmf.data.message, /7/);
  });

  test('call ids vary by session rather than being a constant', async () => {
    const a = await (await acsPost(PORT, '/acs/start', { sessionId: 'route-a' })).json();
    const b = await (await acsPost(PORT, '/acs/start', { sessionId: 'route-b' })).json();
    assert.notEqual(a.data.callId, b.data.callId);
  });

  test('Joi validation still rejects missing fields', async () => {
    assert.equal((await acsPost(PORT, '/acs/start', {})).status, 400);
    assert.equal((await acsPost(PORT, '/acs/sendDTMF', { sessionId: 's1' })).status, 400);
  });
});

describe('the /acs/* routes keep their documented shape without ACS', () => {
  const PORT = 3997;
  before(() => startMiddleware(PORT));

  // The response shape is documented in the README and exercised by the
  // Postman collections, so routing it through the service must not change it.
  test('returns exactly the documented fields and text', async () => {
    const res = await fetch(`http://localhost:${PORT}/acs/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 's1' })
    });
    const body = await res.json();
    assert.deepEqual(body.data, {
      success: true,
      sessionId: 's1',
      callId: 'mocked-call-123',
      message: 'Call started successfully (mocked) for s1'
    });

    const dtmf = await (
      await fetch(`http://localhost:${PORT}/acs/sendDTMF`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: 's1', digit: '1' })
      })
    ).json();
    assert.equal(dtmf.data.message, "DTMF '1' sent successfully (mocked) for s1");
  });
});

describe('middleware degrades gracefully when ACS misbehaves', () => {
  const PORT = 3993;
  before(() => startMiddleware(PORT, { ACS_API_URL: 'http://127.0.0.1:9/acs/intent' }));

  test('an unreachable ACS falls back to mock text, still answering', async () => {
    assert.match(await ask(PORT, 'what is my balance'), /balance is ₹500/);
    assert.match(await ask(PORT, 'I lost my debit card'), /blocked immediately/i);
  });
});

describe('USE_ACS_MOCK forces mocks even with a healthy ACS', () => {
  const PORT = 3994;
  before(() => startMiddleware(PORT, { ACS_API_URL: ACS_URL, USE_ACS_MOCK: 'true' }));

  test('skips the network call entirely', async () => {
    assert.match(await ask(PORT, 'what is my balance'), /balance is ₹500/);
  });
});

describe('a slow ACS is treated as a failure', () => {
  const PORT = 3995;
  const SLOW_PORT = 4995;

  before(async () => {
    await startProcess(
      'acs-service/server.js',
      { ACS_PORT: String(SLOW_PORT), ACS_LATENCY_MS: '3000' },
      `http://localhost:${SLOW_PORT}/health`
    );
    await startMiddleware(PORT, {
      ACS_API_URL: `http://localhost:${SLOW_PORT}/acs/intent`,
      ACS_TIMEOUT_MS: '300'
    });
  });

  test('times out and falls back instead of hanging the caller', async () => {
    const startedAt = Date.now();
    const answer = await ask(PORT, 'what is my balance');
    const elapsed = Date.now() - startedAt;
    assert.match(answer, /balance is ₹500/);
    assert.ok(elapsed < 2500, `took ${elapsed}ms — the timeout does not appear to be applied`);
  });
});
