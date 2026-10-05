# JavaScript Cardano x402 resource server

This optional Node.js 22 and Express server uses official `@x402/core` and `@x402/cardano` 2.26.0 server APIs. It sells the same local educational answers as Spring Boot for 2 tADA on Cardano preprod. The CF Java facilitator and existing wallet frontend remain in use.

## Run with Docker

From the repository root, run setup once if needed, then choose JavaScript:

```bash
./scripts/setup.sh
./scripts/start.sh js
./scripts/check.sh
```

Open `http://localhost:5174`. The API remains at `http://localhost:8081`. This command uses compose.javascript.yaml to replace the resource-server service, rather than run a second server on the same port. Use `./scripts/start.sh java` to rebuild and restore Spring Boot. `docker compose stop` stops either configuration and preserves data.

## What the official packages do

src/sdk.mjs registers `ExactCardanoScheme` from `@x402/cardano/exact/server` with `x402ResourceServer` and `HTTPFacilitatorClient` from `@x402/core/server`. Startup queries facilitator capabilities. src/answers.mjs uses `buildPaymentRequirements`, `createPaymentRequiredResponse`, `verifyPayment`, and `settlePayment`. HTTP header codecs and canonical transaction decoding also come from the official packages.

The application owns the HTTP routes, the price and question, quote expiry, and payment-to-question binding. Express calls the core server API explicitly rather than installing generic payment middleware, because a durable retry must reconcile the stored payment without freshly verifying its spent inputs. This is an official SDK integration with application-specific persistence, not a separate Cardano verification implementation.

## Persistence and retries

The server shares Spring Boot's demo_quotes table and adds the optional prepared_answer column. Existing quotes and transaction bindings remain readable when switching servers. Resolve a payment before switching when possible, and run only one implementation at a time. PostgreSQL session advisory locks serialize JavaScript requests for a quote; a unique transaction hash prevents reuse for another question. Binding and prepared answer are committed before facilitator submission, so an interrupted HTTP response can be retried with the same signature.

The handler prepares its pure local answer after successful verification and before settlement, following Cardano's authorization flow. It releases the answer only after matching transaction evidence with at least one newer block. Core performs one identical-payload retry for a transaction-carrying pending response. Our route returns 202 if it remains pending, and the browser retains the signature. An explicit unsubmitted expiry or verification rejection permits a fresh quote.

The SDK omits the default transfer-method selector in requirements. The frontend accepts this and Spring Boot's explicit default value. Both the frontend adapter and resource server are limited to direct lovelace payments on preprod; other Cardano SDK methods need additional application code. See [the tutorial](../docs/tutorial.md) for the standard-versus-demo distinction and supported Cardano payment types.

## Test without spending

```bash
docker run --rm -v "$PWD:/workspace" -w /workspace/resource-server-js node:22-bookworm-slim sh -c 'npm ci --no-audit --no-fund && npm test'
```

Run this from the repository root. Tests use a public offline transaction vector and a fake HTTP facilitator with the real SDK transport and scheme. They never broadcast. The PostgreSQL persistence test runs only when TEST_DATABASE_URL names a disposable test database; it checks restart recovery, concurrent retries, and unique transaction ownership. The live no-spend smoke script works with either server. A funded wallet-to-chain settlement remains a separate manual check.

## Run outside Docker

Install Node.js 22, run npm ci in this directory, and provide DATABASE_URL, FACILITATOR_URL, PAY_TO, PAYMENT_AMOUNT, BLOCKFROST_PROJECT_ID, PUBLIC_RESOURCE_URL, and PORT through your environment. A standalone instance can listen on PORT=8081 with PUBLIC_RESOURCE_URL=http://localhost:8081. The database and facilitator must already be reachable. The Docker override supplies these values from the same private root .env configuration; it does not send the Blockfrost key to the browser.
