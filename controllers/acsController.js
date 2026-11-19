// controllers/acsController.js
//
// These routes previously built their responses inline and never touched
// acsService, so /acs/start, /acs/stop and /acs/sendDTMF stayed mocked even
// when ACS_API_URL was configured. They now go through the service like every
// other ACS operation.
//
// The response `data` shape is unchanged — success/sessionId/callId/digit/
// message — because it is documented in the README and exercised by the
// Postman collections. Only the source of the values changed.
const acsService = require('../services/acsService');

module.exports = {
  async startCall(req, res, next) {
    const { log } = req;
    try {
      const { sessionId } = req.validated;

      log.info({
        message: 'acs_start_call',
        sessionId
      });

      const svc = await acsService.startCall(sessionId);

      res.json({
        success: true,
        data: {
          success: true,
          sessionId,
          // ACS supplies a real call id; the mock fallback has none, so keep
          // the previously documented placeholder in that case.
          callId: svc.data?.callId || 'mocked-call-123',
          message: svc.responseText
        },
        requestId: req.requestId
      });

    } catch (err) {
      log.error({
        message: 'acs_start_call_error',
        error: err.message,
        sessionId: req.validated?.sessionId
      });

      err.type = err.type || 'acs_start_error';
      err.status = err.status || 500;
      next(err);
    }
  },

  async stopCall(req, res, next) {
    const { log } = req;
    try {
      const { sessionId } = req.validated;

      log.info({
        message: 'acs_stop_call',
        sessionId
      });

      const svc = await acsService.stopCall(sessionId);

      res.json({
        success: true,
        data: {
          success: true,
          sessionId,
          message: svc.responseText
        },
        requestId: req.requestId
      });

    } catch (err) {
      log.error({
        message: 'acs_stop_call_error',
        error: err.message,
        sessionId: req.validated?.sessionId
      });

      err.type = err.type || 'acs_stop_error';
      err.status = err.status || 500;
      next(err);
    }
  },

  async sendDTMF(req, res, next) {
    const { log } = req;
    try {
      const { sessionId, digit } = req.validated;

      log.info({
        message: 'acs_send_dtmf',
        sessionId,
        digit
      });

      const svc = await acsService.sendDTMF(sessionId, digit);

      res.json({
        success: true,
        data: {
          success: true,
          sessionId,
          digit,
          message: svc.responseText
        },
        requestId: req.requestId
      });

    } catch (err) {
      log.error({
        message: 'acs_send_dtmf_error',
        error: err.message,
        sessionId: req.validated?.sessionId,
        digit: req.validated?.digit
      });

      err.type = err.type || 'acs_dtmf_error';
      err.status = err.status || 500;
      next(err);
    }
  }
};
