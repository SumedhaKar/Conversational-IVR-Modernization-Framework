# Conversational IVR Modernization

---

## Overview

This project upgrades a traditional IVR middleware by adding **conversational AI capabilities**. Instead of relying solely on DTMF (keypad) inputs, users can now interact using natural language (typed or voice-transcribed). The middleware intelligently routes queries, making the IVR experience more intuitive and ready for future AI enhancements.

---

## Features

- **Conversational Endpoint:** `/ivr/conversation` for natural language queries.
- **Natural Language Processing and Automatic Chat History:** The middleware uses NLP to understand user queries in 4 different languages and maintains a chat history for seamless, context-aware conversations.
- **Intent Detection:** Routes requests to appropriate services (ACS or BAP).
- **Minimal User Friendly UI:**  
    The project includes a simple, intuitive web interface that allows users to interact with the IVR system using natural language. The UI is designed for ease of use, supporting both text input and voice transcription, making it accessible for a wide range of users.
- **Enhanced Mock Services:** ACS and BAP support conversational flows.
- **Fallback Handling:** Graceful responses for unsupported queries.
- **Comprehensive Testing:** Positive, negative, and fallback scenarios.

---

## Architecture

- **User** sends a query to the **Middleware**.
- **Intent Detection** module analyzes the query.
- Requests are routed to:
    - **ACS** for account-related actions (balance, recharge, card ops).
    - **BAP** for agent or transaction queries (mini statement, loans, bills).
    - **Fallback** for unsupported queries.
- **Middleware** returns the response to the user.

---

## Project Structure

```
middleware-project/
├── index.js                # Express app entry
├── package.json            # Dependencies & scripts
├── routes/
│   ├── ivrRoutes.js        # IVR & conversation routes
│   ├── acsRoutes.js        # ACS routes
├── controllers/
│   ├── ivrController.js    # IVR logic
│   ├── acsController.js    # ACS logic
├── services/
│   ├── acsService.js       # ACS mock service
│   ├── bapService.js       # BAP mock service
├── handlers/
│   └── intentHandler.js  # Intent detection
├── public/
│   ├── index.html          # Clean and Modern UI
│   ├── app.js              # All Functionalities and Hooks
│   └── styles.css
├── docs/
│   └── API.md              # API documentation
├── bap-service/
│   └── server.js           # Standalone downstream BAP service
├── tests/
│   ├── unit.test.js        # Intent, language and config tests
│   ├── api.test.js         # HTTP integration tests
│   └── bap.test.js         # BAP service + integration/resilience tests
├── .env.example            # Every setting, with defaults
└── *.postman_collection.json # Manual exploration collections
```

---

## API Endpoints

Base URL is `http://localhost:3000` by default; the port comes from the `PORT`
environment variable. Every `POST` expects `Content-Type: application/json`.
Successful responses carry a `requestId` that matches the `requestId` in the
logs, which makes a single call easy to trace.

### Health

#### `GET /test`

Confirms the server is up.

```json
{ "message": "Backend connected successfully!", "timestamp": "2025-10-09T12:00:00.000Z" }
```

### IVR

#### `POST /ivr/input`

Traditional IVR (DTMF) input.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `sessionId` | string | yes | |
| `inputType` | string | yes | `DTMF` or `SPEECH` |
| `inputValue` | string | yes | Only `1` (balance) and `2` (start call) are handled |

```json
// request
{ "sessionId": "sess-1099", "inputType": "DTMF", "inputValue": "1" }

// 200
{
  "success": true,
  "data": { "sessionId": "sess-1099", "responseText": "Your account balance is $1,234.56. (Mock Data)" },
  "requestId": "b6c71aa8-a7ba-4ad2-aef9-d23ff45eb3e8"
}
```

Any `inputValue` other than `1` or `2` returns `400 validation_error`.

#### `POST /ivr/conversation`

Natural language query. Detects intent and routes to ACS or BAP.

```json
// request
{ "sessionId": "sess-1099", "query": "what is my balance" }

// 200
{
  "success": true,
  "data": { "sessionId": "sess-1099", "response": "Your account balance is ₹500." },
  "requestId": "ad839b49-f118-463a-a248-a57091ba6e1a"
}
```

Unrecognised queries still return `200` with a fallback `response`
("Sorry, I didn't understand that. Could you rephrase?"), not an error.

#### `POST /ivr/conversation-i18n`

Same contract as `/ivr/conversation`, with a language-detection and
translation step ahead of intent routing. Takes the same `sessionId` and
`query` fields, and adds two fields to the response: `lang`, the detected
language of the query, and `responseLang`, which is always `"en"` because
replies are returned in English.

```json
// request
{ "sessionId": "sess-1099", "query": "mera balance kitne hai" }

// 200
{
  "success": true,
  "data": {
    "sessionId": "sess-1099",
    "lang": "hi-latn",
    "responseLang": "en",
    "response": "Your account balance is ₹500."
  },
  "requestId": "a0fd8c4d-c353-461f-95b5-acb24f64f39e"
}
```

Detected values are `en`, `hi-latn` (Hindi in Latin script), and script-based
codes `hi`, `ta`, `te`, `kn`, `ml`, `bn`, `gu`, `pa`, `ar`.

One current limitation: only Hinglish has real translation mappings. Other
scripts are detected and reported correctly in `lang`, but their text passes
through a placeholder translation, so they usually reach the fallback
response rather than a matched intent.

### ACS

All three take a `sessionId`; `/acs/sendDTMF` also takes a `digit` string.

| Endpoint | Body | Response `data` |
| --- | --- | --- |
| `POST /acs/start` | `{ "sessionId": "s1" }` | `{ "success": true, "sessionId": "s1", "callId": "mocked-call-123", "message": "Call started successfully (mocked) for s1" }` |
| `POST /acs/stop` | `{ "sessionId": "s1" }` | `{ "success": true, "sessionId": "s1", "message": "Call stopped successfully (mocked) for s1" }` |
| `POST /acs/sendDTMF` | `{ "sessionId": "s1", "digit": "1" }` | `{ "success": true, "sessionId": "s1", "digit": "1", "message": "DTMF '1' sent successfully (mocked) for s1" }` |

### BAP

#### `POST /bap/process`

| Field | Type | Required |
| --- | --- | --- |
| `sessionId` | string | yes |
| `action` | string | yes |
| `params` | object | no |

```json
// request
{ "sessionId": "sess-1099", "action": "GetBalance", "params": {} }

// 200
{
  "success": true,
  "data": {
    "success": true,
    "message": "BAP request processed successfully",
    "data": { "sessionId": "sess-1099", "action": "GetBalance", "timestamp": "2025-10-09T12:00:00.000Z" }
  },
  "requestId": "e295d115-0310-4bdd-9a4c-a3c29f3651aa"
}
```

### Error responses

Endpoints validated by Joi middleware (`/ivr/input`, all `/acs/*`,
`/bap/process`) report missing or invalid fields as:

```json
// 400
{ "error": "missing_fields", "missing": ["sessionId", "inputType", "inputValue"] }
```

The conversation endpoints validate inline and include a `requestId`:

```json
// 400
{ "error": "validation_error", "message": "sessionId and query are required", "requestId": "f0183c6a-..." }
```

Unhandled failures return `500` with `"message": "Internal server error"`;
internal details are logged rather than returned.

---

## Testing

```bash
npm test          # run once
npm run test:watch  # re-run on change
```

Uses the Node built-in test runner, so there is no test framework to install.
Two suites live in `tests/`:

- **`unit.test.js`** — intent detection, language detection and translation,
  and configuration parsing. No server required.
- **`api.test.js`** — boots the real server on a test port and drives it over
  HTTP, covering routing, validation status codes, the error handler and the
  CORS allowlist as they actually run.

Between them they cover the positive paths (account and agent queries),
negative paths (missing fields, empty body, unhandled DTMF digit) and the
fallback for unsupported queries such as "play music".

A **Postman collection** is also included for manual exploration.

---

## Test Case Summary

- **Positive:** ACS (balance, recharge, card ops), BAP (mini statement, bills, loans).
- **Negative:** Missing `sessionId`, missing `query`, empty body.
- **Fallback:** Unknown queries handled with polite error messages.

---

## Configuration

All settings are environment variables; every one has a working default, so
`npm start` runs with no configuration at all.

Copy `.env.example` to `.env` to set them locally:

```bash
cp .env.example .env
```

`.env` is gitignored and never committed. Variables already present in the
real environment take precedence over it, so a hosting platform's injected
configuration is never overridden by a stray local file.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on. |
| `NODE_ENV` | `development` | `production` tightens the CORS default (see below). |
| `LOG_LEVEL` | `info` | Winston log level. |
| `LOG_FILE` | `./logs/middleware.log` | Log file path. |
| `BAP_API_URL` | unset | BAP endpoint. Unset means mock responses. |
| `USE_BAP_MOCK` | `false` | Set to `true` to force mocks even when `BAP_API_URL` is set. |
| `BAP_TIMEOUT_MS` | `5000` | How long to wait for BAP before falling back to mocks. |
| `CORS_ORIGINS` | unset | Comma-separated origins allowed to call the API cross-origin. |

The BAP service reads two of its own: `BAP_PORT` (default `4001`) and
`BAP_LATENCY_MS` (default `0`, for exercising the middleware's timeout path).

### BAP service

`bap-service/` is a separate Express process representing the downstream
banking platform. The middleware reaches it over HTTP, so the integration is a
real network call rather than an in-process stub.

```bash
npm run bap     # terminal 1 — BAP service on :4001
npm start       # terminal 2 — middleware on :3000
```

With `BAP_API_URL=http://localhost:4001/bap/intent` set, balance, mini
statement, bill payment, loan details, e-statement and agent handoff are all
answered by BAP. Without it, the middleware falls back to built-in mock text,
so the app still runs standalone.

#### Contract

`POST /bap/intent`

```json
// request
{ "sessionId": "sess-1099", "intent": "GetBalance", "params": {} }

// 200
{
  "sessionId": "sess-1099",
  "intent": "GetBalance",
  "responseText": "Your account balance is ₹5,055.55.",
  "data": { "accountNumber": "XXXX5055", "balance": 5055.55, "currency": "INR" }
}
```

Intents: `GetBalance`, `GetMiniStatement`, `PayUtilityBill`, `GetLoanDetails`,
`RequestEStatement`, `AgentConnect`. A missing `sessionId` or `intent` returns
`400 invalid_request`; an unrecognised intent returns `404 unknown_intent`
along with the supported list. `GET /health` reports status and intents.

Account figures are derived from the `sessionId`, so different callers see
different balances while a single session stays consistent — a constant would
be indistinguishable from the hardcoded strings this replaced.

#### Failure handling

Every BAP call falls back to mock text rather than propagating an error: a
caller losing their balance enquiry to a downstream outage is worse than a
synthetic answer. Unreachable host, timeout, non-2xx and a 2xx with no
`responseText` are all treated as failures and logged. Responses carry a
`source` field of `bap` or `mock` saying which path produced them.

### CORS

The bundled UI is served by this same app, so it is same-origin and needs no
CORS configuration. Cross-origin callers must be listed explicitly:

```bash
CORS_ORIGINS="https://ivr.example.com,https://admin.example.com" npm start
```

Requests without an `Origin` header — curl, Postman, server-to-server — are
not subject to CORS and are unaffected. In development, any `localhost` or
`127.0.0.1` origin is also accepted so a separate frontend dev server works
without extra setup; set `NODE_ENV=production` to turn that off and rely on
`CORS_ORIGINS` alone.

---

## Dependencies

- `express`
- `body-parser`
- `nodemon` (dev)

All dependencies are listed in `package.json`.

---

## Execution

To run the middleware project locally:

1. **Install dependencies:**
    ```bash
    npm install
    ```

2. **Start the server:**
    ```bash
    npm start
    ```
    The server runs by default on `http://localhost:3000`.

3. **Access the UI:**
    Open `http://localhost:3000` in your browser to use the conversational IVR interface.

4. **Test API endpoints:**
    Use Postman or any API client to interact with endpoints as described above.
 

## License

Licensed under the **MIT** license.
