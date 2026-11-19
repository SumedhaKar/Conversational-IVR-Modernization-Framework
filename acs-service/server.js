// Standalone ACS (Account & Card Services) service.
//
// Like bap-service, this runs as its own process and is reached over HTTP, so
// the middleware performs a genuine integration rather than calling
// in-process stubs. Data is synthetic; the transport and failure modes are
// real.
//
// Run with: npm run acs
const express = require('express');

const app = express();
const PORT = process.env.ACS_PORT || 4002;

// Artificial latency for exercising the middleware's timeout path.
const LATENCY_MS = Number(process.env.ACS_LATENCY_MS || 0);

app.use(express.json());

/** Stable pseudo card/account data per session, so sessions differ but repeat calls agree. */
function accountFor(sessionId) {
  let hash = 0;
  for (const ch of String(sessionId)) {
    hash = (hash * 37 + ch.charCodeAt(0)) >>> 0;
  }
  return {
    cardLast4: String(hash % 10000).padStart(4, '0'),
    balance: Number((500 + (hash % 4500) + (hash % 100) / 100).toFixed(2)),
    mobileLast4: String(hash % 9000 + 1000)
  };
}

const inr = (n) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Intent names match handlers/intentHandler.js exactly, so no translation
// layer is needed between detecting an intent and dispatching it.
const INTENTS = {
  ACS_BALANCE: (sessionId) => {
    const a = accountFor(sessionId);
    return {
      responseText: `Your account balance is ${inr(a.balance)}.`,
      data: { balance: a.balance, currency: 'INR', cardLast4: a.cardLast4 }
    };
  },

  ACS_RECHARGE: (sessionId, params = {}) => {
    const amount = Number(params.amount) > 0 ? Number(params.amount) : 100;
    return {
      responseText: `Recharge successful for ${inr(amount)}.`,
      data: { amount, status: 'completed' }
    };
  },

  ACS_REPORT_LOST_CARD: (sessionId) => {
    const a = accountFor(sessionId);
    return {
      responseText:
        'Thank you. Your card has been blocked immediately. A customer service agent will ' +
        'call you shortly to confirm.',
      data: { cardLast4: a.cardLast4, status: 'blocked' }
    };
  },

  ACS_ACTIVATE_CARD: () => ({
    responseText:
      'To activate your new card, please enter the 16-digit card number followed by the hash key.',
    data: { status: 'awaiting_card_number' }
  }),

  ACS_UPDATE_CONTACT: (sessionId) => {
    const a = accountFor(sessionId);
    return {
      responseText:
        'A secure link to update your contact details has been sent to your registered mobile number.',
      data: { mobileLast4: a.mobileLast4, status: 'link_sent' }
    };
  },

  ACS_REPORT_SUSPICIOUS: (sessionId) => {
    const a = accountFor(sessionId);
    return {
      responseText:
        'Thank you for reporting this. A temporary hold has been placed on your account. ' +
        'Our fraud protection team will contact you within the next hour.',
      data: { cardLast4: a.cardLast4, status: 'hold_placed' }
    };
  },

  // Call control, used by the DTMF flow.
  ACS_START_CALL: (sessionId) => ({
    responseText: `Call started successfully for ${sessionId}.`,
    data: { callId: `call-${accountFor(sessionId).cardLast4}`, status: 'started' }
  }),

  ACS_STOP_CALL: (sessionId) => ({
    responseText: `Call stopped successfully for ${sessionId}.`,
    data: { status: 'stopped' }
  }),

  ACS_SEND_DTMF: (sessionId, params = {}) => ({
    responseText: `DTMF '${params.digit ?? ''}' received for ${sessionId}.`,
    data: { digit: params.digit ?? null, status: 'received' }
  })
};

app.get('/health', (req, res) => {
  res.json({ service: 'acs', status: 'ok', intents: Object.keys(INTENTS) });
});

app.post('/acs/intent', async (req, res) => {
  const { sessionId, intent, params } = req.body || {};

  if (!sessionId || !intent) {
    return res.status(400).json({ error: 'invalid_request', message: 'sessionId and intent are required' });
  }

  const handler = INTENTS[intent];
  if (!handler) {
    return res.status(404).json({
      error: 'unknown_intent',
      message: `No handler for intent "${intent}"`,
      supported: Object.keys(INTENTS)
    });
  }

  if (LATENCY_MS > 0) {
    await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
  }

  return res.json({ sessionId, intent, ...handler(sessionId, params) });
});

app.use((err, req, res, next) => {
  console.error('ACS error:', err);
  res.status(500).json({ error: 'internal_error', message: 'Internal server error' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`✅ ACS service listening on http://localhost:${PORT}`);
    console.log(`   POST /acs/intent   intents: ${Object.keys(INTENTS).join(', ')}`);
  });
}

module.exports = app;
