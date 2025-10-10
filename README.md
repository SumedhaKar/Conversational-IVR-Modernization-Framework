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

![System Architecture Diagram](middleware-project/docs/architecture.png)

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
├──  public 
|    ├──index.html         # Clean and Modern UI
|    ├──app.js             # All Functionalities and Hooks
|    ├──style.css
├── docs/
│   ├── API.md              # API documentation
│   └── architecture.png    # Architecture diagram
└── tests/
        └── postman_collection.json # Test cases
```

---

## API Endpoints

- `POST /ivr`  
    Traditional IVR (DTMF) input.

- `POST /acs/start`  
- `POST /acs/stop`  
- `POST /acs/sendDTMF`  
    ACS operations.

- `POST /ivr/conversation`  
    Accepts natural language queries, routes to ACS/BAP, returns structured JSON.

---

## Testing

- **Postman Collection:** Automated tests for all endpoints.
    - **Positive:** Valid account and agent queries.
    - **Negative:** Missing/invalid fields, empty requests.
    - **Fallback:** Unsupported queries (e.g., “play music”).

---

## Test Case Summary

- **Positive:** ACS (balance, recharge, card ops), BAP (mini statement, bills, loans).
- **Negative:** Missing `sessionId`, missing `query`, empty body.
- **Fallback:** Unknown queries handled with polite error messages.

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
