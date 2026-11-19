// Standalone BAP (Banking Application Platform) service.
//
// This is a separate process from the IVR middleware and speaks to it only
// over HTTP, so the middleware performs a genuine network integration rather
// than calling in-process stubs. The data it returns is synthetic, but the
// transport, contract, error handling and failure modes are real.
//
// Run with: npm run bap
const express = require('express');

const app = express();
const PORT = process.env.BAP_PORT || process.env.PORT || 4001;

// Artificial latency, so timeout handling in the middleware is exercisable.
// Set BAP_LATENCY_MS high to watch the middleware fall back.
const LATENCY_MS = Number(process.env.BAP_LATENCY_MS || 0);

app.use(express.json());

/**
 * Derives stable pseudo-account data from a session id, so repeated calls for
 * the same session agree with each other and different sessions look
 * different. A constant would make the integration impossible to tell apart
 * from a hardcoded string.
 */
function accountFor(sessionId) {
  let hash = 0;
  for (const ch of String(sessionId)) {
    hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  }
  const balance = 1000 + (hash % 9000) + (hash % 100) / 100;
  return {
    accountNumber: `XXXX${String(hash % 10000).padStart(4, '0')}`,
    balance: Number(balance.toFixed(2)),
    emi: 250 + (hash % 500),
    emiDueDay: 1 + (hash % 28),
    outstanding: 5000 + (hash % 20000)
  };
}

const inr = (n) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const INTENTS = {
  GetBalance: (sessionId) => {
    const a = accountFor(sessionId);
    return {
      responseText: `Your account balance is ${inr(a.balance)}.`,
      data: { accountNumber: a.accountNumber, balance: a.balance, currency: 'INR' }
    };
  },

  GetMiniStatement: (sessionId) => {
    const a = accountFor(sessionId);
    const txns = [
      { type: 'debit', amount: 50 + (a.balance % 50), description: 'UPI payment' },
      { type: 'credit', amount: 200, description: 'Salary credit' },
      { type: 'debit', amount: 25, description: 'Card purchase' },
      { type: 'debit', amount: 10, description: 'ATM withdrawal' },
      { type: 'credit', amount: 500, description: 'Refund' }
    ].map((t) => ({ ...t, amount: Number(t.amount.toFixed(2)) }));

    const summary = txns
      .map((t) => `a ${t.type} of ${inr(t.amount)}`)
      .join(', ')
      .replace(/, ([^,]*)$/, ', and $1');

    return {
      responseText: `Your last five transactions are: ${summary}.`,
      data: { accountNumber: a.accountNumber, transactions: txns }
    };
  },

  PayUtilityBill: (sessionId, params = {}) => {
    if (params.customerId) {
      return {
        responseText: `Your utility bill for customer ID ${params.customerId} has been scheduled for payment.`,
        data: { customerId: params.customerId, status: 'scheduled' }
      };
    }
    return {
      responseText: 'Please say or enter your 10-digit customer ID for your utility provider.',
      data: { status: 'awaiting_customer_id' }
    };
  },

  GetLoanDetails: (sessionId) => {
    const a = accountFor(sessionId);
    return {
      responseText:
        `For your personal loan, your next EMI of ${inr(a.emi)} is due on the ${a.emiDueDay}th ` +
        `of this month. Your outstanding balance is ${inr(a.outstanding)}.`,
      data: { emi: a.emi, dueDay: a.emiDueDay, outstanding: a.outstanding }
    };
  },

  RequestEStatement: (sessionId) => {
    const a = accountFor(sessionId);
    return {
      responseText:
        'Your e-statement for the last 3 months has been sent to your registered email address. ' +
        'Please check your inbox.',
      data: { accountNumber: a.accountNumber, periodMonths: 3, delivery: 'email' }
    };
  },

  AgentConnect: () => ({
    responseText: 'You are now connected to a customer service agent.',
    data: { queue: 'general', waitSeconds: 0 }
  })
};

app.get('/health', (req, res) => {
  res.json({ service: 'bap', status: 'ok', intents: Object.keys(INTENTS) });
});

app.post('/bap/intent', async (req, res) => {
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

  const result = handler(sessionId, params);
  return res.json({ sessionId, intent, ...result });
});

app.use((err, req, res, next) => {
  console.error('BAP error:', err);
  res.status(500).json({ error: 'internal_error', message: 'Internal server error' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`✅ BAP service listening on http://localhost:${PORT}`);
    console.log(`   POST /bap/intent   intents: ${Object.keys(INTENTS).join(', ')}`);
  });
}

module.exports = app;
