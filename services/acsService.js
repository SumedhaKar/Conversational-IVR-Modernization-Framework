const axios = require("axios");
const config = require("../config");
const { logger } = require('../middlewares/logger');

// One HTTP client for every ACS operation, so timeout, logging and fallback
// behaviour are identical across intents rather than reimplemented per call.
const ACS_TIMEOUT_MS = Number(process.env.ACS_TIMEOUT_MS || 5000);

// Used when ACS is unreachable or deliberately mocked. Keyed by the same
// intent names handlers/intentHandler.js produces, so there is no translation
// layer between detecting an intent and dispatching it.
const FALLBACK_TEXT = {
  ACS_BALANCE: "Your account balance is ₹500.",
  ACS_RECHARGE: "Recharge successful for ₹100.",
  ACS_REPORT_LOST_CARD:
    "Thank you. Your card has been blocked immediately. A customer service agent will call you shortly to confirm.",
  ACS_ACTIVATE_CARD:
    "To activate your new card, please enter the 16-digit card number followed by the hash key.",
  ACS_UPDATE_CONTACT:
    "A secure link to update your contact details has been sent to your registered mobile number.",
  ACS_REPORT_SUSPICIOUS:
    "Thank you for reporting this. A temporary hold has been placed on your account. Our fraud protection team will contact you within the next hour.",
  // Functions where the documented response embeds request values, so the
  // /acs/* routes return exactly what the README specifies when ACS is unset.
  ACS_START_CALL: (sessionId) => `Call started successfully (mocked) for ${sessionId}`,
  ACS_STOP_CALL: (sessionId) => `Call stopped successfully (mocked) for ${sessionId}`,
  ACS_SEND_DTMF: (sessionId, params = {}) =>
    `DTMF '${params.digit ?? ''}' sent successfully (mocked) for ${sessionId}`
};

const fallback = (intent, sessionId, reason, params) => {
  logger.info(`ACS ${intent} served from mock for session ${sessionId} (${reason})`);
  const text = FALLBACK_TEXT[intent];
  return {
    sessionId,
    intent,
    responseText: typeof text === 'function' ? text(sessionId, params) : text,
    source: 'mock'
  };
};

/**
 * Calls the ACS service for one intent.
 *
 * Mirrors bapService.callBap: any failure — no URL configured, mocks forced,
 * network error, timeout, non-2xx, or a 2xx with no usable body — degrades to
 * synthetic text rather than propagating, because a caller losing a card
 * blocking request to a downstream outage is worse than a stale answer. The
 * `source` field records which path produced the result.
 */
async function callAcs(intent, sessionId, params) {
  if (!FALLBACK_TEXT[intent]) {
    logger.warn(`ACS asked for unknown intent ${intent} on session ${sessionId}`);
    return { sessionId, intent, success: false, error: { message: "Unable to map query to ACS action." } };
  }

  if (config.USE_ACS_MOCK) return fallback(intent, sessionId, 'USE_ACS_MOCK is set', params);
  if (!config.acsApiUrl) return fallback(intent, sessionId, 'no ACS_API_URL configured', params);

  try {
    const response = await axios.post(
      config.acsApiUrl,
      { sessionId, intent, params },
      { timeout: ACS_TIMEOUT_MS }
    );

    const body = response.data;
    if (!body || !body.responseText) {
      return fallback(intent, sessionId, 'ACS returned no responseText', params);
    }

    logger.info(`ACS ${intent} answered for session ${sessionId}`);
    return { ...body, source: 'acs' };
  } catch (error) {
    const detail = error.response ? `HTTP ${error.response.status}` : error.code || error.message;
    logger.warn(`ACS ${intent} failed for session ${sessionId}: ${detail}`);
    return fallback(intent, sessionId, detail, params);
  }
}

/**
 * Dispatches an already-detected intent.
 *
 * Takes the intent rather than the raw query on purpose. The previous version
 * re-ran its own keyword matching over the query, duplicating detectIntent and
 * requiring the two matchers to stay in sync by hand — they drifted, and
 * lost-card queries were detected and then rejected here as unmappable.
 * intentHandler already knows the intent, so it simply passes it along.
 */
async function handleQuery(sessionId, intent, params) {
  if (!intent) {
    return { success: false, sessionId, error: { message: "Query or intent is required." } };
  }

  const result = await callAcs(intent, sessionId, params);
  if (result.success === false) return result;

  // Shape intentHandler expects.
  return { success: true, sessionId, data: { message: result.responseText }, source: result.source };
}

const startCall = (sessionId) => callAcs('ACS_START_CALL', sessionId);
const stopCall = (sessionId) => callAcs('ACS_STOP_CALL', sessionId);
const sendDTMF = (sessionId, digit) => callAcs('ACS_SEND_DTMF', sessionId, { digit });
const getBalance = (sessionId) => callAcs('ACS_BALANCE', sessionId);
const recharge = (sessionId, amount) => callAcs('ACS_RECHARGE', sessionId, { amount });
const reportLostCard = (sessionId) => callAcs('ACS_REPORT_LOST_CARD', sessionId);
const activateNewCard = (sessionId) => callAcs('ACS_ACTIVATE_CARD', sessionId);
const updateContactDetails = (sessionId) => callAcs('ACS_UPDATE_CONTACT', sessionId);
const reportSuspiciousTransaction = (sessionId) => callAcs('ACS_REPORT_SUSPICIOUS', sessionId);

module.exports = {
  callAcs,
  startCall,
  stopCall,
  sendDTMF,
  getBalance,
  recharge,
  reportLostCard,
  activateNewCard,
  updateContactDetails,
  reportSuspiciousTransaction,
  handleQuery
};
