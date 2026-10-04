package demo.x402;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.Map;

@RestController
public class DemoController {
    private final PaidAnswers answers;
    public DemoController(PaidAnswers answers) { this.answers=answers; }
    @GetMapping("/api/config") public Map<String,Object> config() { return answers.config(); }
    @PostMapping("/api/quotes") public Map<String,Object> quote(@RequestBody Map<String,String> body) throws Exception { return answers.quote(body.get("question")); }
    @GetMapping("/api/answers/{id}") public ResponseEntity<?> answer(@PathVariable String id,
        @RequestHeader(value="PAYMENT-SIGNATURE",required=false) String payment) throws Exception { return answers.answer(id,payment); }
    @ExceptionHandler(IllegalArgumentException.class) public ResponseEntity<?> invalid() { return PaidAnswers.error(400,"invalid_request"); }
    @ExceptionHandler(Exception.class) public ResponseEntity<?> unavailable() {
        // This also covers a lost settlement response; a stored payload must be retried unchanged.
        return ResponseEntity.status(503).body(Map.of("error","backend_unavailable",
            "instruction","If a payment was signed, retain and retry that exact payment."));
    }
}
