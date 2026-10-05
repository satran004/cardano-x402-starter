# Learn x402 payments on Cardano

This starter demonstrates how an HTTP request becomes a Cardano payment. A browser asks for an educational answer, receives HTTP 402, signs a transaction through its wallet, and receives the answer after the facilitator verifies and confirms the payment.

Use these docs to understand standard x402 messages, Cardano payment methods, and the application code that controls access. Choose a Spring Boot or JavaScript resource server; both work with the same frontend and Cardano Foundation facilitator.

![HTTP request, wallet signature, facilitator settlement, and paid answer](images/payment-flow.svg)

## Start learning

| Guide | What you will learn |
| --- | --- |
| [Tutorial](tutorial.md) | Follow each HTTP exchange; distinguish x402 standards, Cardano semantics, and demo choices; learn direct, Masumi, and script payments. |
| [HTTP messages and encoding](wire-format.md) | Inspect complete 402 challenges, signed-payment envelopes, facilitator JSON, pending responses, and paid answers; decode Base64 and CBOR. |
| [JavaScript resource server](../resource-server-js/README.md) | Use the official x402 core and Cardano server packages with Node.js and Express. |
| [Architecture](architecture.md) | Understand persisted quotes, transaction ownership, retries, credentials, and implementation limits. |
| [Validation](validation.md) | See which builds, SDK tests, database checks, and live HTTP checks passed, and which wallet check remains. |

## Run the example locally

Clone [the repository](https://github.com/satran004/cardano-x402-starter), start Docker Desktop, and configure a private preprod Blockfrost project ID as described in the tutorial. Then run:

```bash
./scripts/setup.sh
./scripts/start.sh java  # Default Spring Boot server
# Or: ./scripts/start.sh js
./scripts/check.sh
```

Open `http://localhost:5174` in a browser with your CIP-30 wallet installed. Select preprod and fund the payer with test ADA. The default price is 2 tADA plus the network fee. The [tutorial](tutorial.md#prepare-your-environment) covers wallet preparation and each payment step.

This GitHub Pages site publishes documentation only. The paid API, wallet frontend, database, and facilitator run locally; they are not hosted on GitHub Pages.

## Read the implementation

| Component | Source |
| --- | --- |
| Spring Boot paid request gate | [PaidAnswers.java](https://github.com/satran004/cardano-x402-starter/blob/main/resource-server/src/main/java/demo/x402/PaidAnswers.java) |
| Official JavaScript SDK registration | [sdk.mjs](https://github.com/satran004/cardano-x402-starter/blob/main/resource-server-js/src/sdk.mjs) |
| JavaScript paid request gate | [answers.mjs](https://github.com/satran004/cardano-x402-starter/blob/main/resource-server-js/src/answers.mjs) |
| Browser wallet and transaction builder | [payment.ts](https://github.com/satran004/cardano-x402-starter/blob/main/frontend/src/payment.ts) |
| Cardano Foundation facilitator | [Pinned upstream source](https://github.com/cardano-foundation/cardano-x402-facilitator/tree/97add9f) |

## How documentation is published

The documentation workflow checks and builds this site on documentation pull requests. Pushes to main deploy it through GitHub Actions to GitHub Pages. The build renders only the selected guides and their illustrations into a separate artifact; it needs no Blockfrost project ID or wallet credentials.

For local preview and validation:

```bash
python3 scripts/render-tutorial.py --site-dir _site
python3 scripts/check-docs.py _site
python3 -m http.server 8000 --directory _site
```

Open `http://localhost:8000`. Running `python3 scripts/render-tutorial.py` without arguments also refreshes the documentation embedded in the local frontend.
