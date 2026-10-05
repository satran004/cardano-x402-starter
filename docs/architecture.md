# Architecture of the Cardano x402 demo

The demo keeps the three protocol roles separate. The React frontend is the payer client, Spring Boot owns the paid resource, and the upstream CF Java facilitator handles Cardano verification and settlement. PostgreSQL stores the facilitator journal and the resource server's question records.

![Browser wallet, resource server, facilitator, and Cardano payment flow](images/payment-flow.svg)

## Protocol and SDK choices

The facilitator snapshot is pinned at revision `97add9f` and targets x402 v2 with official SDK version 2.26.0. The frontend uses those exact core and Cardano versions, CF Connect with Wallet 0.2.22, and Evolution 0.5.16. `package-lock.json` fixes the dependency tree.

The Java application implements the v2 HTTP envelope because the official Java x402 SDK at the pinned compatibility revision documents v1. Cardano transaction construction stays in Evolution, payload construction stays in `@x402/cardano/exact/client`, header encoding stays in `@x402/core/http`, and chain verification and submission stay in the CF facilitator. The resource server uses cardano-client-lib only to derive the canonical transaction ID for payment ownership.

An optional Node.js 22 / Express resource server uses the official core resource server, HTTP facilitator client, and Cardano server scheme at the same pinned 2.26.0 versions. `./scripts/start.sh js` selects it through compose.javascript.yaml; `./scripts/start.sh java` restores Spring Boot. Only the resource-server service changes. It shares demo_quotes and adds a prepared_answer field. JavaScript prepares the local answer before settlement and publishes it after confirmation; Spring Boot currently generates it after settlement. The tutorial explains this handler-order difference from the SDK's authorization flow.

## Durable resource ownership

Each free `POST /api/quotes` call stores a UUID, question, expiration, and immutable requirements. `GET /api/answers/{id}` emits its 402 challenge. A paid retry must contain the same requirements and resource URL.

After `verify` accepts the payment, the resource server stores the canonical transaction ID and exact verified payload before calling `settle`. A unique database constraint prevents that transaction from being assigned to another question, even if its witnesses or declared nonce are changed. Recorded retries skip fresh UTxO verification, because successful submission may already have spent those inputs. They pass the original persisted payload back to `settle`.

The server stores the settlement response and releases the answer only when `success` is true, the transaction ID matches, and the receipt reports at least one newer block. A confirmed answer is cached for same-question retries. The server does not re-check chain depth for a cached answer; this is an access decision at the time of first delivery, not continuous rollback monitoring.

The resource service serializes paid calls within one JVM. This simple demonstration trades concurrency for understandable behavior. The unique transaction constraint persists across restarts, but multiple resource-server replicas require atomic per-quote ownership updates and distributed work coordination. Do not scale this service unchanged.

The JavaScript variant holds a PostgreSQL session advisory lock for each quote while reconciling it. Updates autocommit so the transaction binding survives a process failure before or during submission. This coordinates JavaScript workers while the unique transaction hash fences cross-question reuse; Spring Boot does not participate in these advisory locks, so do not run both implementations concurrently against this journal.

## Credentials and network access

The preprod Blockfrost key is held in root `.env` with file mode 600. Compose injects it into the facilitator and resource server. It is not a Vite environment variable, API response, or browser asset. The merchant recovery phrase stays in ignored `.local/merchant.json` with mode 600; no service needs it to receive payments.

The browser calls the frontend origin on host port 5174 (container port 5173). Vite proxies `/api` to the selected resource server, avoiding cross-origin payment header handling. Both servers' read-only Blockfrost proxies permit only the chain routes used for transaction construction and reject submission paths. The facilitator talks directly to hosted preprod Blockfrost.

Ports 5174, 8081, and 4022 bind to host loopback. The resource server listens on port 8080 inside Docker and is published on host port 8081; payment resource URLs use port 8081. PostgreSQL has no published port. The database's local-demo password is inside Compose. This configuration is for a local tutorial: a hosted system needs an authenticated or rate-limited chain proxy, HTTPS, appropriate account and resource access controls, and an operational database policy.

## Payment states and retries

| State | Resource response | Client action |
| --- | --- | --- |
| No signed payment | 402 and PAYMENT-REQUIRED | Inspect quote, then sign once. |
| Quote expired before payment acceptance | 410 with not_submitted and canRequestNewQuote | Discard the rejected signature and request a fresh quote. |
| Malformed or altered payment | 400 | Inspect the protocol error; no submission occurs. |
| Facilitator rejects verification | 402 with not_submitted and canRequestNewQuote | Inspect the verification verdict, then request a fresh quote after resolving it. |
| Submission may have happened, confirmation pending | 202 and PAYMENT-RESPONSE | Retry exactly the same payment. |
| Settlement HTTP result unknown | 503 | Retain the signature and retry it unchanged. |
| Same transaction presented for another question | 409 | Request a separate quote and payment for a new question. |
| Confirmed payment | 200 and PAYMENT-RESPONSE | Read the answer and explorer receipt. |

Session storage holds the signed payment in the current tab before the first paid request. The UI disables another purchase while that payment is unresolved. For a terminal settlement rejection, inspect the trace and facilitator journal before abandoning it; the demo intentionally has no automatic “pay again” action after a transaction has been signed. An operator can investigate `demo_quotes` in PostgreSQL. A production client should provide durable authenticated recovery beyond a browser tab.

An expired quote with no transaction binding never reaches verify or settle. The server provides an explicit `not_submitted` verdict so the client can clear that signature safely. A verification rejection also happens before binding and submission. A bound payment continues to use its persisted payload even after quote expiration; an unsigned probe of that record cannot advertise safe replacement. Client expiry alone never discards a saved payment whose submission outcome is uncertain.

## Illustrations and documentation

The editable SVGs are `docs/images/payment-flow.svg` for the sequence and `docs/images/http-messages.svg` for data exchanged at each stage. [HTTP messages and encoding](wire-format.md) includes full decoded JSON examples and recovery responses. The same illustrations and guides are served by the separate frontend at `/tutorial.html` and `/wire-format.html`. Run `python3 scripts/render-tutorial.py` after editing the Markdown; then rebuild the frontend container to publish those local changes. Documentation changes pushed to main also deploy automatically to [GitHub Pages](https://satran004.github.io/cardano-x402-starter/).
