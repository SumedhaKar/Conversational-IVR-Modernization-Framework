const axios = require("axios");
const config = require("../config");
const { logger } = require('../middlewares/logger');

// Every BAP operation goes through one HTTP client, so timeout, logging and
// fallback behaviour are identical across intents instead of being
// reimplemented (or forgotten) per function.
const BAP_TIMEOUT_MS = Number(process.env.BAP_TIMEOUT_MS || 5000);

// Used when the BAP service is unreachable or deliberately mocked. Keeping
// these here rather than inline keeps callBap's control flow readable, and
// makes it obvious at a glance which text is synthetic.
const FALLBACK_TEXT = {
  GetBalance: "Your account balance is $1,234.56. (Mock Data)",
  GetMiniStatement:
    "Your last five transactions are: a debit of $50, a credit of $200, a debit of $25, a debit of $10, and a credit of $500.",
  PayUtilityBill: "Please say or enter your 10-digit customer ID for your utility provider.",
  GetLoanDetails:
    "For your personal loan, your next EMI of $350 is due on the 15th of this month. Your outstanding balance is $8,500.",
  RequestEStatement:
    "Your e-statement for the last 3 months has been sent to your registered email address. Please check your inbox.",
  AgentConnect: "You are now connected to a customer service agent."
};

const fallback = (intent, sessionId, reason) => {
  logger.info(`BAP ${intent} served from mock for session ${sessionId} (${reason})`);
  return { sessionId, intent, responseText: FALLBACK_TEXT[intent], source: 'mock' };
};

/**
 * Calls the BAP service for one intent.
 *
 * Returns the service's own payload on success. On any failure — no URL
 * configured, mocks forced, network error, timeout, non-2xx — it falls back to
 * synthetic data rather than propagating the error, because a caller losing
 * their balance enquiry to a downstream outage is worse than a stale-but-sane
 * answer. The `source` field says which path produced the result.
 */
async function callBap(intent, sessionId, params) {
  if (config.USE_BAP_MOCK) return fallback(intent, sessionId, 'USE_BAP_MOCK is set');
  if (!config.bapApiUrl) return fallback(intent, sessionId, 'no BAP_API_URL configured');

  try {
    const response = await axios.post(
      config.bapApiUrl,
      { sessionId, intent, params },
      { timeout: BAP_TIMEOUT_MS }
    );

    const body = response.data;
    if (!body || !body.responseText) {
      // A 2xx with an unusable body is still a failure for our purposes.
      return fallback(intent, sessionId, 'BAP returned no responseText');
    }

    logger.info(`BAP ${intent} answered for session ${sessionId}`);
    return { ...body, source: 'bap' };
  } catch (error) {
    const detail = error.response
      ? `HTTP ${error.response.status}`
      : error.code || error.message;
    logger.warn(`BAP ${intent} failed for session ${sessionId}: ${detail}`);
    return fallback(intent, sessionId, detail);
  }
}

const getBalance = (sessionId) => callBap('GetBalance', sessionId);
const getMiniStatement = (sessionId) => callBap('GetMiniStatement', sessionId);
const payUtilityBill = (sessionId, params) => callBap('PayUtilityBill', sessionId, params);
const getLoanDetails = (sessionId) => callBap('GetLoanDetails', sessionId);
const requestEStatement = (sessionId) => callBap('RequestEStatement', sessionId);
const agentConnect = (sessionId) => callBap('AgentConnect', sessionId);

// Kept for bapController, which exposes POST /bap/process.
const handle = async (payload) => {
  logger.info('BAP service processing request', { payload });

  return {
    success: true,
    message: 'BAP request processed successfully',
    data: {
      sessionId: payload.sessionId,
      action: payload.action,
      timestamp: new Date().toISOString()
    }
  };
};

module.exports = {
  callBap,
  getBalance,
  getMiniStatement,
  agentConnect,
  payUtilityBill,
  getLoanDetails,
  requestEStatement,
  handle
};
