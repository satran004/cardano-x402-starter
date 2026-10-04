package demo.x402;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.net.URI;
import java.net.http.*;
import java.time.Duration;

/** Read-only, bounded routes needed by the browser transaction builder. No submission route. */
@RestController
public class BlockfrostProxy {
    private final String key, base;
    private final HttpClient http=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    public BlockfrostProxy(@Value("${demo.blockfrost-key}") String key,@Value("${demo.blockfrost-url}") String base) { this.key=key; this.base=base; }
    @GetMapping("/api/chain/**") public ResponseEntity<String> query(HttpServletRequest request) throws Exception {
        String path=request.getRequestURI().substring("/api/chain".length());
        if (!path.matches("/(epochs/latest/parameters|blocks/latest|genesis|addresses/addr_test1[a-z0-9]+/utxos|txs/[a-f0-9]{64}/utxos)"))
            return ResponseEntity.status(404).body("{\"error\":\"chain_route_not_allowed\"}");
        String qs=request.getQueryString();
        if (qs!=null && !qs.matches("(?:(?:page|count)=[0-9]{1,3}|order=(?:asc|desc))(?:&(?:(?:page|count)=[0-9]{1,3}|order=(?:asc|desc)))*"))
            return ResponseEntity.badRequest().body("{\"error\":\"invalid_chain_query\"}");
        var response=http.send(HttpRequest.newBuilder(URI.create(base+path+(qs==null?"":"?"+qs)))
            .timeout(Duration.ofSeconds(20)).header("project_id",key).GET().build(),HttpResponse.BodyHandlers.ofString());
        return ResponseEntity.status(response.statusCode()).header("Content-Type","application/json").body(response.body());
    }
}
