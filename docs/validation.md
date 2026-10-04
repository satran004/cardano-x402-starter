# Cardano x402 demo validation

Validation on 2 October 2026, repeated for the expiry fix on 4 October 2026, established that the applications build, the configured preprod key works, and the live services issue a correct x402 v2 challenge. Funded wallet settlement is still a separate manual check; no payment was submitted during these checks.

## Completed checks

| Check | Result | Evidence |
| --- | --- | --- |
| CF facilitator Docker image | Passed | Unmodified upstream Dockerfile built on Linux AMD64 and ran MasumiBlueprintTest and ScriptAddressConformanceTest. |
| Spring Boot application | Passed | Java 21 compile, executable JAR, and container build. |
| Server payment behavior | 11 tests passed | V2 unpaid challenge, invalid verification verdict, altered price or recipient, idempotent answer retry, pending reconciliation, cross-question replay rejection, lost settlement response, insufficient depth evidence, and expiry recovery for unsigned, unsubmitted, and already-bound payments. |
| Frontend offer policy | 7 tests passed | Expected offer accepted; altered amount, network, asset, recipient, resource URL, and mempool-only policy rejected. |
| CIP-30 adapter | 5 tests passed | Offline transaction built and cryptographically signed through a simulated CIP-30 API, accepted by the official Cardano x402 verifier; mainnet, empty-wallet, and nearly expired quotes rejected before signing; transaction validity capped to quote expiry. |
| Browser payment recovery | 12 tests passed | A saved signature is replaceable only after an explicit not-submitted response for an expired quote or invalid payment. Pending, ambiguous, and error responses retain it. |
| Frontend production bundle | Passed | TypeScript and Vite build. Dependency warnings include a large SDK bundle and ignored React use client directives. |
| Live preprod Blockfrost key | Passed | Authenticated latest-block read against hosted preprod Blockfrost. Key contents were not included in the response. |
| Live service smoke test | Passed | Readiness, supported capabilities, chain proxy, prohibited submission route, quote storage, v2 402 header, malformed-payment rejection, frontend API proxy, and tutorial HTTP response. |
| Sequence illustration | Passed | SVG rendered to PNG and visually inspected; labels and arrows fit. Both formats are in docs/images. |

`scripts/check.sh` performs no spending. The resource server tests mock the facilitator and use H2 for the quote database. The adapter test uses a public BIP-39 test mnemonic, fabricated UTxOs, and controlled protocol parameters; it never submits a transaction. The running services use PostgreSQL and real hosted Blockfrost for the no-spend smoke checks.

## Live wallet check remaining

The full browser-to-chain payment has not been claimed as completed. Browser automation rejected input because its window state changed, so visual layout of the running frontend and wallet prompts was not verified through that interface. The build, live HTTP behavior, and offline signing adapter were checked separately.

To finish the live demonstration:

1. Open `http://localhost:5174` in the browser where your CIP-30 wallet is installed.
2. Select **preprod**, fund the payer with test ADA, and connect the wallet.
3. Ask “What does the facilitator do?” and inspect the 2 tADA quote and merchant address.
4. Approve the transaction once in the wallet. Wait for inclusion plus at least one newer block, retrying the saved payment if pending.
5. Confirm the HTTP 200 answer, PAYMENT-RESPONSE receipt, and merchant output using the preprod explorer link.
6. Press another question only after the first payment has resolved. The next question requires a separate payment.

Do not close the pending tab or delete the PostgreSQL volume before resolving a payment. The browser stores its signed payload in that tab's session storage, and the resource server retains the verified payload and transaction binding in PostgreSQL.

## Repeat the automated checks

```bash
./scripts/test.sh
./scripts/check.sh
docker compose ps
```

See [the tutorial](tutorial.md) for the full flow and [architecture](architecture.md) for the local single-server limits and production adaptation points.
