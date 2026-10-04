import { describe, expect, it } from 'vitest';
import { canReplaceUnsubmittedPayment } from './recovery';

describe('Saved payment recovery', () => {
  const expired = { error: 'quote_expired', paymentStatus: 'not_submitted', canRequestNewQuote: true };
  it('permits a fresh quote after a definitive pre-submission expiry', () => {
    expect(canReplaceUnsubmittedPayment(410, expired)).toBe(true);
  });
  it('permits recovery from verification rejection before submission, including an expired transaction', () => {
    expect(canReplaceUnsubmittedPayment(402, { ...expired, error: 'payment_invalid' })).toBe(true);
  });
  it.each([202, 409, 500, 503, 504])('keeps saved payments for pending, conflicting, and uncertain responses (%s)', status => {
    expect(canReplaceUnsubmittedPayment(status, expired)).toBe(false);
  });
  it.each([null, { error: 'quote_expired' }, { ...expired, paymentStatus: 'pending' }, { ...expired, canRequestNewQuote: false }, { ...expired, error: 'settlement_pending' }])('keeps payment without an explicit safe server verdict (%j)', body => {
    expect(canReplaceUnsubmittedPayment(410, body)).toBe(false);
  });
});
