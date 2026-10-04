package demo.x402;

import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;
import org.springframework.core.io.ClassPathResource;
import java.util.*;
import java.nio.charset.StandardCharsets;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class PaidAnswersTest {
    ObjectMapper json=new ObjectMapper();
    FacilitatorClient client;
    PaidAnswers server;
    JdbcTemplate db;
    String tx;
    String hash;
    @BeforeEach void setup() throws Exception {
        var ds=new DriverManagerDataSource("jdbc:h2:mem:"+UUID.randomUUID()+";DB_CLOSE_DELAY=-1", "sa", "");
        new ResourceDatabasePopulator(new ClassPathResource("schema.sql")).execute(ds);
        client=mock(FacilitatorClient.class);
        when(client.supported()).thenReturn(json.readTree("""
            {"kinds":[{"x402Version":2,"scheme":"exact","network":"cardano:preprod","extra":{"assetTransferMethods":["default"],"l1Confirmations":{"minimum":0,"maximum":20}}}]}
            """));
        db=new JdbcTemplate(ds);
        server=new PaidAnswers(json,db,client,"addr_test1demo","2000000","http://localhost:8080");
        var vector=json.readTree(new ClassPathResource("public-test-transaction.json").getInputStream());
        tx=vector.path("transaction").asText(); hash=vector.path("hash").asText();
        when(client.call(eq("verify"),any(),any())).thenReturn(json.readTree("{\"isValid\":true}"));
        when(client.call(eq("settle"),any(),any())).thenReturn(settled());
    }
    JsonNode settled() throws Exception { return json.readTree("{\"success\":true,\"transaction\":\""+hash+"\",\"network\":\"cardano:preprod\",\"extra\":{\"status\":\"confirmed\",\"confirmations\":1}}"); }
    String quote() throws Exception { return (String)server.quote("What is a UTxO?").get("id"); }
    ObjectNode payload(String id) throws Exception {
        var challenge=json.valueToTree(server.answer(id,null).getBody());
        var payload=json.createObjectNode();payload.put("x402Version",2);
        payload.set("resource",challenge.path("resource"));payload.set("accepted",challenge.path("accepts").get(0));
        payload.set("payload",json.valueToTree(Map.of("transaction",tx,"nonce","01".repeat(32)+"#0")));
        return payload;
    }
    String encode(JsonNode payload) throws Exception { return Base64.getEncoder().encodeToString(json.writeValueAsString(payload).getBytes(StandardCharsets.UTF_8)); }
    @Test void unpaidRequestIsV2ChallengeAndNeverSettles() throws Exception {
        var response=server.answer(quote(),null);
        assertEquals(402,response.getStatusCode().value());
        var body=json.readTree(Base64.getDecoder().decode(response.getHeaders().getFirst("PAYMENT-REQUIRED")));
        assertEquals(2,body.path("x402Version").asInt());
        assertEquals("2000000",body.path("accepts").get(0).path("amount").asText());
        verify(client,never()).call(anyString(),any(),any());
    }
    @Test void invalidPaymentCannotUnlockAnswerEvenWithHttp200Verdict() throws Exception {
        when(client.call(eq("verify"),any(),any())).thenReturn(json.readTree("{\"isValid\":false}"));
        var id=quote();var response=server.answer(id,encode(payload(id)));
        assertEquals(402,response.getStatusCode().value());
        assertEquals("not_submitted",json.valueToTree(response.getBody()).path("paymentStatus").asText());
        verify(client,never()).call(eq("settle"),any(),any());
    }
    @Test void changedAmountAndRecipientAreRejectedBeforeFacilitator() throws Exception {
        var id=quote();var p=payload(id);((ObjectNode)p.path("accepted")).put("amount","1");
        assertEquals(400,server.answer(id,encode(p)).getStatusCode().value());
        p=payload(id);((ObjectNode)p.path("accepted")).put("payTo","addr_test1attacker");
        assertEquals(400,server.answer(id,encode(p)).getStatusCode().value());
        verify(client,never()).call(anyString(),any(),any());
    }
    @Test void samePaymentRetryReturnsSameAnswerWithoutAnotherSubmission() throws Exception {
        var id=quote();var signature=encode(payload(id));
        var first=server.answer(id,signature);var retry=server.answer(id,signature);
        assertEquals(200,first.getStatusCode().value());assertEquals(first.getBody(),retry.getBody());
        verify(client,times(1)).call(eq("settle"),any(),any());
    }
    @Test void pendingRetrySkipsSpentInputVerificationAndReconcilesSamePayload() throws Exception {
        when(client.call(eq("settle"),any(),any())).thenReturn(json.readTree("{\"success\":false,\"errorReason\":\"settlement_pending\",\"transaction\":\""+hash+"\"}"),settled());
        var id=quote();var signature=encode(payload(id));
        assertEquals(202,server.answer(id,signature).getStatusCode().value());
        assertEquals(200,server.answer(id,signature).getStatusCode().value());
        verify(client,times(1)).call(eq("verify"),any(),any());
        verify(client,times(2)).call(eq("settle"),any(),any());
    }
    @Test void oneTransactionCannotBuyTwoDifferentQuestions() throws Exception {
        var first=quote();assertEquals(200,server.answer(first,encode(payload(first))).getStatusCode().value());
        var second=quote();assertEquals(409,server.answer(second,encode(payload(second))).getStatusCode().value());
        verify(client,times(1)).call(eq("settle"),any(),any());
    }
    @Test void lostSettlementResponseRetainsVerifiedPayloadForRetry() throws Exception {
        when(client.call(eq("settle"),any(),any())).thenThrow(new java.net.http.HttpTimeoutException("lost response")).thenReturn(settled());
        var id=quote();var signature=encode(payload(id));
        assertThrows(java.net.http.HttpTimeoutException.class,()->server.answer(id,signature));
        assertEquals(200,server.answer(id,signature).getStatusCode().value());
        verify(client,times(1)).call(eq("verify"),any(),any());
    }
    @Test void successWithoutDepthEvidenceDoesNotReleaseResource() throws Exception {
        when(client.call(eq("settle"),any(),any())).thenReturn(json.readTree("{\"success\":true,\"transaction\":\""+hash+"\",\"extra\":{\"confirmations\":0}}"));
        var id=quote();assertThrows(IllegalStateException.class,()->server.answer(id,encode(payload(id))));
    }
    @Test void expiredSignedQuoteCanStartOverWithoutSubmittingOrBindingPayment() throws Exception {
        var id=quote();var signature=encode(payload(id));
        db.update("UPDATE demo_quotes SET expires_at=0 WHERE id=?",id);
        var response=server.answer(id,signature);
        assertEquals(410,response.getStatusCode().value());
        var body=json.valueToTree(response.getBody());
        assertEquals("quote_expired",body.path("error").asText());
        assertEquals("not_submitted",body.path("paymentStatus").asText());
        assertTrue(body.path("canRequestNewQuote").asBoolean());
        assertNull(db.queryForObject("SELECT tx_hash FROM demo_quotes WHERE id=?",String.class,id));
        verify(client,never()).call(anyString(),any(),any());
        // No claim was made: a fresh question can accept a payment normally.
        var fresh=quote();assertEquals(200,server.answer(fresh,encode(payload(fresh))).getStatusCode().value());
    }
    @Test void expiredUnsignedQuoteProvidesSafeRecovery() throws Exception {
        var id=quote();db.update("UPDATE demo_quotes SET expires_at=0 WHERE id=?",id);
        var response=server.answer(id,null);
        assertEquals(410,response.getStatusCode().value());
        assertTrue(json.valueToTree(response.getBody()).path("canRequestNewQuote").asBoolean());
        verify(client,never()).call(anyString(),any(),any());
    }
    @Test void quoteExpiryDoesNotDiscardAnAlreadySubmittedPendingPayment() throws Exception {
        when(client.call(eq("settle"),any(),any())).thenReturn(json.readTree("{\"success\":false,\"errorReason\":\"settlement_pending\",\"transaction\":\""+hash+"\"}"),settled());
        var id=quote();var signature=encode(payload(id));
        assertEquals(202,server.answer(id,signature).getStatusCode().value());
        db.update("UPDATE demo_quotes SET expires_at=0 WHERE id=?",id);
        // An unsigned probe cannot declare a bound payment safe to discard.
        assertFalse(json.valueToTree(server.answer(id,null).getBody()).path("canRequestNewQuote").asBoolean());
        assertEquals(200,server.answer(id,signature).getStatusCode().value());
        verify(client,times(1)).call(eq("verify"),any(),any());
        verify(client,times(2)).call(eq("settle"),any(),any());
    }
}
