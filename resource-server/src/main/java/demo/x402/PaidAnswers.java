package demo.x402;

import com.bloxbean.cardano.client.transaction.util.TransactionUtil;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;

@Service
public class PaidAnswers {
    private final ObjectMapper json;
    private final JdbcTemplate db;
    private final FacilitatorClient facilitator;
    private final String payTo, amount, publicUrl;
    public PaidAnswers(ObjectMapper json, JdbcTemplate db, FacilitatorClient facilitator,
        @Value("${demo.pay-to}") String payTo, @Value("${demo.amount}") String amount,
        @Value("${demo.public-url}") String publicUrl) {
        if (!payTo.startsWith("addr_test1") || !amount.matches("[1-9][0-9]*") || Long.parseLong(amount) < 2_000_000)
            throw new IllegalArgumentException("Use a preprod address and at least 2000000 lovelace");
        this.json=json; this.db=db; this.facilitator=facilitator;
        this.payTo=payTo; this.amount=amount; this.publicUrl=publicUrl;
    }
    public Map<String, Object> config() {
        return Map.of("network", "cardano:preprod", "amount", amount, "payTo", payTo,
            "confirmationPolicy", Map.of("l1Confirmations", 1));
    }
    public Map<String, Object> quote(String question) throws Exception {
        if (question == null || question.isBlank() || question.length() > 300)
            throw new IllegalArgumentException("Enter a question between 1 and 300 characters");
        // Never issue a payment request for capabilities this facilitator cannot settle.
        boolean supported = false;
        for (var kind : facilitator.supported().path("kinds")) {
            var extra=kind.path("extra");
            if (kind.path("x402Version").asInt()==2 && kind.path("scheme").asText().equals("exact")
                && kind.path("network").asText().equals("cardano:preprod")
                && extra.path("assetTransferMethods").toString().contains("\"default\"")
                && extra.path("l1Confirmations").path("minimum").asInt(99)<=1
                && extra.path("l1Confirmations").path("maximum").asInt(-1)>=1) supported=true;
        }
        if (!supported) throw new IllegalStateException("Facilitator does not support this payment policy");
        String id=UUID.randomUUID().toString();
        var requirements=json.valueToTree(Map.of("scheme", "exact", "network", "cardano:preprod",
            "asset", "lovelace", "amount", amount, "payTo", payTo, "maxTimeoutSeconds", 600,
            "extra", Map.of("assetTransferMethod", "default", "areFeesSponsored", false,
                "confirmationPolicy", Map.of("l1Confirmations", 1))));
        long expiry=Instant.now().plusSeconds(600).toEpochMilli();
        db.update("INSERT INTO demo_quotes(id,question,requirements,expires_at) VALUES (?,?,?,?)",
            id, question.strip(), json.writeValueAsString(requirements), expiry);
        return Map.of("id", id, "url", resourceUrl(id), "expiresAt", expiry);
    }
    private String resourceUrl(String id) { return publicUrl + "/api/answers/" + id; }

    /** Serialize demo requests in this single server; the UNIQUE tx hash survives restarts. */
    public synchronized ResponseEntity<?> answer(String id, String signature) throws Exception {
        var rows=db.queryForList("SELECT * FROM demo_quotes WHERE id=?", id);
        if (rows.isEmpty()) return error(404, "quote_not_found");
        var row=rows.getFirst();
        var requirements=json.readTree((String)row.get("requirements"));
        var resource=json.valueToTree(Map.of("url", resourceUrl(id), "description", "A short educational Cardano answer", "mimeType", "application/json"));
        var required=json.valueToTree(Map.of("x402Version", 2, "resource", resource, "accepts", List.of(requirements)));
        if (signature == null || signature.isBlank()) {
            if (Instant.now().toEpochMilli() > ((Number)row.get("expires_at")).longValue())
                return row.get("tx_hash") == null ? expiredBeforePayment() : error(410, "quote_expired");
            return ResponseEntity.status(402).header("PAYMENT-REQUIRED", encode(required)).body(required);
        }
        JsonNode incoming;
        String hash;
        try {
            if (signature.length()>60_000) return error(413,"payment_too_large");
            incoming=json.readTree(Base64.getDecoder().decode(signature));
            if (incoming.path("x402Version").asInt()!=2 || !incoming.path("accepted").equals(requirements)
                || !incoming.path("resource").path("url").asText().equals(resourceUrl(id))) return error(400,"payment_terms_mismatch");
            byte[] tx=Base64.getDecoder().decode(incoming.path("payload").path("transaction").asText());
            hash=TransactionUtil.getTxHash(tx);
        } catch (Exception e) { return error(400,"malformed_payment"); }
        var recorded=(String)row.get("tx_hash");
        if (recorded != null && !recorded.equals(hash)) return error(409,"quote_already_bound_to_another_payment");
        if (recorded == null) {
            var owners=db.queryForList("SELECT id FROM demo_quotes WHERE tx_hash=?",hash);
            if (!owners.isEmpty()) return error(409,"payment_already_used_for_another_question");
            if (Instant.now().toEpochMilli() > ((Number)row.get("expires_at")).longValue()) return expiredBeforePayment();
            var verified=facilitator.call("verify", incoming, requirements);
            if (!verified.path("isValid").asBoolean()) return ResponseEntity.status(402)
                .header("PAYMENT-REQUIRED", encode(required)).body(Map.of("error", "payment_invalid", "verification", verified,
                    "paymentStatus", "not_submitted", "canRequestNewQuote", true));
            // Persist the exact verified payload BEFORE submission. A lost response can safely retry.
            try { db.update("UPDATE demo_quotes SET tx_hash=?,payload=? WHERE id=?",hash,json.writeValueAsString(incoming),id); }
            catch (DuplicateKeyException e) { return error(409,"payment_already_used_for_another_question"); }
        } else {
            incoming=json.readTree((String)row.get("payload"));
            if (row.get("answer") != null) return success(json.readTree((String)row.get("answer")),json.readTree((String)row.get("settlement")));
        }
        var settled=facilitator.call("settle", incoming, requirements);
        db.update("UPDATE demo_quotes SET settlement=? WHERE id=?",json.writeValueAsString(settled),id);
        if (!settled.path("success").asBoolean()) {
            // Pending is not a new 402 quote: the transaction may already have moved funds.
            int status=settled.path("errorReason").asText().equals("settlement_pending") ? 202 : 409;
            return ResponseEntity.status(status).header("PAYMENT-RESPONSE",encode(settled))
                .body(Map.of("error", settled.path("errorReason").asText(), "settlement", settled,
                    "instruction", "Retry the identical PAYMENT-SIGNATURE; do not sign another transaction."));
        }
        if (!hash.equals(settled.path("transaction").asText()) || settled.path("extra").path("confirmations").asInt(-2)<1)
            throw new IllegalStateException("Facilitator returned insufficient settlement evidence");
        var answer=json.valueToTree(Map.of("question",row.get("question"),"answer",explain((String)row.get("question")),
            "generatedAt",Instant.now().toString(),"source","Local educational examples; no external AI service"));
        db.update("UPDATE demo_quotes SET answer=? WHERE id=?",json.writeValueAsString(answer),id);
        return success(answer, settled);
    }
    private ResponseEntity<?> success(JsonNode answer, JsonNode settled) throws Exception {
        return ResponseEntity.ok().header("PAYMENT-RESPONSE",encode(settled)).body(Map.of("result",answer,"settlement",settled));
    }
    private String encode(JsonNode node) throws Exception {
        return Base64.getEncoder().encodeToString(json.writeValueAsString(node).getBytes(StandardCharsets.UTF_8));
    }
    static ResponseEntity<?> error(int status,String code) { return ResponseEntity.status(status).body(Map.of("error",code)); }
    private static ResponseEntity<?> expiredBeforePayment() {
        // Only used when no verified payload is bound. This branch never calls settle.
        return ResponseEntity.status(410).body(Map.of("error", "quote_expired",
            "paymentStatus", "not_submitted", "canRequestNewQuote", true,
            "instruction", "The quote expired before payment was accepted. Request a fresh quote; no transaction was submitted for this quote."));
    }
    static String explain(String question) {
        String q=question.toLowerCase(Locale.ROOT);
        if (q.contains("utxo")) return "A UTxO is an unspent transaction output: a piece of value controlled by an address. A Cardano payment consumes existing UTxOs and creates new outputs for the merchant and your change. The x402 nonce identifies one consumed input.";
        if (q.contains("wallet") || q.contains("cip")) return "CIP-30 lets this website request access to your Cardano browser wallet and ask it to sign a transaction. You approve the payment in the wallet. Your private keys stay there; the facilitator receives only the signed transaction.";
        if (q.contains("facilitator")) return "The facilitator verifies the payer's signed transaction, submits it to Cardano, and checks confirmation evidence. It holds no signing keys and needs no funded wallet. This demo waits for inclusion plus one newer block before releasing your answer.";
        if (q.contains("fee")) return "The 2 tADA price goes to the demo merchant. A separate Cardano network fee is paid from your wallet's inputs. The transaction also returns change to your wallet. Only preprod test ADA is used here.";
        return "x402 turns HTTP 402 Payment Required into a payment handshake. The server quotes its price, your wallet signs a Cardano transaction, and the browser retries with PAYMENT-SIGNATURE. The server asks the facilitator to verify and settle it, then returns the answer with PAYMENT-RESPONSE.";
    }
}
