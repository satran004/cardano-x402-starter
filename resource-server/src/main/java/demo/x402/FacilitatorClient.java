package demo.x402;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.util.Map;

/** x402 v2 transport adapter. Cardano validation stays in the CF facilitator. */
@Component
public class FacilitatorClient {
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    private final ObjectMapper json;
    private final String url;
    public FacilitatorClient(ObjectMapper json, @Value("${demo.facilitator-url}") String url) {
        this.json = json; this.url = url;
    }
    public JsonNode supported() throws Exception {
        return send(HttpRequest.newBuilder(URI.create(url + "/supported")).timeout(Duration.ofSeconds(10)).GET().build());
    }
    public JsonNode call(String operation, JsonNode payload, JsonNode requirements) throws Exception {
        return send(HttpRequest.newBuilder(URI.create(url + "/" + operation)).timeout(Duration.ofSeconds(90))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(Map.of(
                "x402Version", 2, "paymentPayload", payload, "paymentRequirements", requirements)))).build());
    }
    private JsonNode send(HttpRequest request) throws Exception {
        var response = http.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() != 200) throw new IllegalStateException("Facilitator HTTP " + response.statusCode());
        return json.readTree(response.body());
    }
}
