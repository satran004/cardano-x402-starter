/** Discard a saved signature only on an explicit server verdict for this unpaid quote. */
export function canReplaceUnsubmittedPayment(status: number, body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const response = body as Record<string, unknown>;
  const rejectedBeforeSubmission = (status === 410 && response.error === 'quote_expired')
    || (status === 402 && response.error === 'payment_invalid');
  return rejectedBeforeSubmission && response.paymentStatus === 'not_submitted' && response.canRequestNewQuote === true;
}
