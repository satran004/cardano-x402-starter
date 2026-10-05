# Cardano x402 starter

[Read the documentation and illustrated tutorial](https://satran004.github.io/cardano-x402-starter/)

Run an HTTP payment handshake on Cardano preprod with three separate applications: the Cardano Foundation facilitator, a Java Spring Boot resource server, and a React frontend using CF Connect with Wallet and the official x402 Cardano SDK. The resource is a short educational answer, priced at **2 tADA plus the Cardano network fee**.

The preprod key is configured privately in `.env`. A new merchant receiving wallet is stored in `.local/merchant.json`; its recovery phrase is never exposed to the browser or facilitator. Both files are ignored by Git.

## Start the demo

Requires Docker Desktop with Linux AMD64 emulation enabled. Java and Node run inside containers.

```bash
./scripts/setup.sh
./scripts/start.sh
./scripts/check.sh
```

Open [the demo](http://localhost:5174) and [the illustrated tutorial](http://localhost:5174/tutorial.html). Install a CIP-30 browser wallet, select **preprod**, and fund it with test ADA from the [Cardano testnet faucet](https://docs.cardano.org/cardano-testnets/tools/faucet/). At least 3 tADA is convenient for this 2 tADA payment and fee.

Ask a question to inspect the HTTP 402 quote, connect the wallet, then approve the transaction. The answer appears after block inclusion and at least one newer block. If settlement is pending, press **Check the same payment again**. This reuses the saved signature; do not sign a second transaction for that question.

Quotes last 10 minutes. The UI shows the remaining time and offers **Request a fresh quote** before signing an expired quote. If signing takes too long and the server rejects the expired quote before accepting payment, it explicitly confirms `paymentStatus: not_submitted` and unlocks the fresh-quote action. Submitted or uncertain payments keep their original signature for reconciliation.

The frontend shows a live HTTP trace, decoded payment requirements, settlement evidence, and a transaction explorer link. Answers use local educational examples so the demo does not require an AI provider key.

## Applications

| Application | Location | Local endpoint |
| --- | --- | --- |
| CF facilitator | `facilitator/` | `http://localhost:4022` |
| Spring Boot resource server | `resource-server/` | `http://localhost:8081` |
| Separate React frontend | `frontend/` | `http://localhost:5174` |
| PostgreSQL settlement and quote journal | Docker volume | Internal network only |

The browser calls `/api` on the frontend origin. Vite proxies those requests to Spring Boot. A read-only chain proxy keeps the Blockfrost key on the server; transaction submission happens only through the facilitator.

## Read and inspect

- [Tutorial with payment flow illustration](docs/tutorial.md)
- [Published documentation website](https://satran004.github.io/cardano-x402-starter/)
- [Architecture and implementation decisions](docs/architecture.md)
- [Validation evidence and remaining live check](docs/validation.md)
- [Upstream facilitator API](facilitator/docs/api.md)
- [Optional JavaScript resource server using official x402 packages](resource-server-js/README.md)

The tutorial separates standard x402 messages from Cardano mechanism semantics and this demo's application choices. It also explains direct payments, Masumi escrow, custom scripts, ADA/native-token assets, fees, and confirmations.

## Choose the resource server

Spring Boot is the default. An optional **plain JavaScript / Node.js / Express** implementation uses official `@x402/core` and `@x402/cardano` server APIs. Both expose the same endpoints and share the PostgreSQL payment journal.

```bash
./scripts/start.sh js    # Use JavaScript with the existing frontend and CF facilitator
./scripts/start.sh java  # Switch back to Spring Boot
docker compose stop     # Stop either variant, retaining data
```

Run one resource-server implementation at a time. JavaScript retains the same preprod-only direct ADA payment policy. Its SDK prepares the local answer before settlement and releases it after confirmation; see the tutorial for the difference from Spring Boot's handler timing.

```bash
docker compose ps
docker compose logs --tail=100 facilitator resource-server
./scripts/test.sh
docker compose stop
```

Stopping preserves the database and merchant wallet. Keep the PostgreSQL volume: it records payments and their ownership. Do not delete it while payments are pending.

## Configuration

The root `.env.example` documents `BLOCKFROST_PROJECT_ID`, `PAY_TO`, and `PAYMENT_AMOUNT`. `scripts/import-key.py` imports only a preprod token from `~/keys` without printing credentials. To use your own merchant, set `PAY_TO` to your preprod receiving address before setup. The facilitator does not need a wallet or test ADA.

This demo uses x402 **v2**: `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, and `PAYMENT-RESPONSE`. At this starter's upstream compatibility revision, the official Java library documents v1 `X-PAYMENT`; the Spring Boot application therefore implements the small v2 HTTP adapter. The browser uses official `@x402/core` and `@x402/cardano` 2.26.0, with Evolution for its CIP-30 transaction-building adapter.

This is a local, single-resource-server tutorial. API ports bind to loopback. The development frontend, read-only Blockfrost proxy, lack of account authentication, and serialized resource-server settlement are deliberate local-demo choices. See [architecture](docs/architecture.md) before adapting this to a hosted service.
