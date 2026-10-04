import { useEffect, useState } from 'react';
import { useCardano } from '@cardano-foundation/cardano-connect-with-wallet';
import { NetworkType } from '@cardano-foundation/cardano-connect-with-wallet-core';
import { decodePaymentRequiredHeader, decodePaymentResponseHeader } from '@x402/core/http';
import type { PaymentRequired } from '@x402/core/types';
import { signPayment, validateOffer, type Cip30Api, type DemoConfig } from './payment';
import { canReplaceUnsubmittedPayment } from './recovery';

declare global { interface Window { cardano?: Record<string, { enable(): Promise<Cip30Api> }> } }
type Quote = { id: string; url: string; expiresAt: number };
type Saved = { quote: Quote; signature: string; question: string };
type Trace = { status: string; title: string; detail: string; data?: unknown };
type Answer = { result: { question: string; answer: string; source: string }; settlement: { transaction: string; extra?: { confirmations?: number } } };
const savedKey = 'cardano-x402-pending';
function restore(): Saved | null { try { return JSON.parse(sessionStorage.getItem(savedKey) || 'null'); } catch { return null; } }

export function App() {
  const wallet = useCardano({ limitNetwork: NetworkType.TESTNET });
  const [config, setConfig] = useState<DemoConfig | null>(null);
  const [question, setQuestion] = useState('How does x402 work on Cardano?');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [offer, setOffer] = useState<PaymentRequired | null>(null);
  const [pending, setPending] = useState<Saved | null>(restore);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [trace, setTrace] = useState<Trace[]>([]);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [phase, setPhase] = useState(0);
  const [now, setNow] = useState(Date.now);
  const [freshQuoteNeeded, setFreshQuoteNeeded] = useState(false);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { fetch('/api/config').then(async r => { if (!r.ok) throw new Error('Resource server is unavailable.'); setConfig(await r.json()); }).catch(e => setError(e.message)); }, []);
  const add = (entry: Trace) => setTrace(t => [...t, entry]);
  const amount = config ? (Number(config.amount) / 1e6).toLocaleString() : '2';
  const quoteSecondsLeft = quote ? Math.max(0, Math.floor((quote.expiresAt - now) / 1000)) : 0;
  const quoteTooOld = !!quote && quoteSecondsLeft <= 30;

  async function requestQuote() {
    setBusy(true); setError(''); setAnswer(null); setTrace([]); setPhase(1); setOffer(null); setQuote(null); setFreshQuoteNeeded(false);
    try {
      if (!config) throw new Error('Wait for the resource server to connect.');
      const r = await fetch('/api/quotes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question }) });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || 'Could not create a quote. Check facilitator health.');
      const q = body as Quote;
      const challenge = await fetch(`/api/answers/${q.id}`);
      if (challenge.status !== 402) throw new Error('Expected HTTP 402 Payment Required.');
      const required = decodePaymentRequiredHeader(challenge.headers.get('PAYMENT-REQUIRED')!);
      validateOffer(required, config, q.url);
      setQuote(q); setOffer(required); setPhase(2);
      add({ status: '402', title: 'Payment required', detail: 'The resource server quoted its price. No payment has been made.', data: required });
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }

  async function deliver(saved: Saved) {
    setPhase(4);
    add({ status: 'GET', title: 'Signed payment sent', detail: 'Retrying the same resource with PAYMENT-SIGNATURE. The facilitator verifies and submits it.' });
    const r = await fetch(`/api/answers/${saved.quote.id}`, { headers: { 'PAYMENT-SIGNATURE': saved.signature } });
    const body = await r.json();
    const receipt = r.headers.get('PAYMENT-RESPONSE');
    const safeToReplace = canReplaceUnsubmittedPayment(r.status, body);
    const rejectedDetail = body.error === 'quote_expired'
      ? 'The quote expired before acceptance.'
      : `The payment was rejected before submission: ${body.verification?.invalidReason || 'verification failed'}.`;
    add({ status: String(r.status), title: r.status === 200 ? 'Settled on preprod' : 'Settlement response',
      detail: r.status === 200 ? 'Payment included in a block, with at least one newer block. Answer unlocked.' : safeToReplace ? `${rejectedDetail} The server confirms it did not submit this payment; you can request a fresh quote.` : 'Keep this signed payment and retry it. Do not sign a second transaction.',
      data: receipt ? decodePaymentResponseHeader(receipt) : body });
    if (safeToReplace) {
      setQuestion(saved.question); setPending(null); sessionStorage.removeItem(savedKey);
      setOffer(null); setQuote(null); setPhase(1); setFreshQuoteNeeded(true);
      setError(`${rejectedDetail} No transaction was submitted for this quote. Request a fresh quote to continue.`);
    } else if (r.status === 200) {
      setAnswer(body); setPhase(5); setPending(null); sessionStorage.removeItem(savedKey); setOffer(null);
    } else if (r.status === 202) {
      setError('Payment is pending on preprod. Wait a moment, then check the same payment again.');
    } else {
      throw new Error(`${body.error || 'Request failed'}. Retain this payment and inspect the response below before starting over.`);
    }
  }

  async function pay() {
    if (!offer || !quote || !config || !wallet.enabledWallet) return;
    setBusy(true); setError(''); setPhase(3);
    try {
      if (Date.now() >= quote.expiresAt - 30_000) {
        setOffer(null); setQuote(null); setFreshQuoteNeeded(true);
        throw new Error('This quote is expiring. Request a fresh quote before signing.');
      }
      const injected = window.cardano?.[wallet.enabledWallet];
      if (!injected) throw new Error('The browser wallet is unavailable. Reconnect it.');
      const api = await injected.enable();
      const signature = await signPayment(api, offer, config, quote.expiresAt);
      const saved = { quote, signature, question };
      // Store before sending: network failures and reloads must never cause a new charge.
      sessionStorage.setItem(savedKey, JSON.stringify(saved)); setPending(saved);
      add({ status: 'CIP-30', title: 'Wallet signature approved', detail: 'The signed transaction is ready. The browser has not broadcast it.' });
      await deliver(saved);
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function retry() {
    if (!pending) return;
    setBusy(true); setError('');
    try { await deliver(pending); } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }

  return <div className="app">
    <header><a className="brand" href="/"><span className="brandmark">₳</span> Cardano <b>x402</b></a><div className="header-links"><a href="/tutorial.html">Read the tutorial ↗</a><span className="network"><i /> Preprod testnet</span></div></header>
    <main><div className="eyebrow">HTTP PAYMENTS · LIVE ON CARDANO PREPROD</div><section className="intro"><h1>A question.<br />A payment.<br /><em>An answer.</em></h1><div className="intro-copy"><p>See an HTTP request become a Cardano payment. Connect your wallet, ask a question, and unlock a small educational answer with test ADA.</p><div className="price"><strong>{amount} <span>tADA</span></strong><small>per answer + network fee</small></div></div></section>
    <section className="flow" aria-label="Payment flow">{['Request', '402 quote', 'Wallet signs', 'Verify + settle', '200 answer'].map((s, i) => <div key={s} className={phase > i ? 'active' : ''}><span>{String(i + 1).padStart(2, '0')}</span><b>{s}</b>{i < 4 && <i>→</i>}</div>)}</section>
    <div className="workspace"><section className="ask panel"><div className="panel-heading"><span>01 / THE RESOURCE</span><span className="tag">Spring Boot API</span></div><h2>What would you like to know?</h2><p className="muted">Try x402, UTxOs, CIP-30 wallets, facilitators, or fees. Answers come from a small local set of examples.</p><label htmlFor="question">Your question</label><textarea id="question" maxLength={300} value={pending?.question || question} disabled={busy || !!pending} onChange={e => setQuestion(e.target.value)} /><div className="suggestions">{['What is a UTxO?', 'What does the facilitator do?', 'Who pays the fee?'].map(q => <button key={q} disabled={busy || !!pending} onClick={() => setQuestion(q)}>{q}</button>)}</div>
    <div className="wallet"><div><b>{wallet.isConnected ? `Connected to ${wallet.enabledWallet}` : 'Connect your Cardano wallet'}</b><p>Choose <strong>preprod</strong> in your wallet settings. Keep at least {Number(amount) + 1} tADA available.</p></div>{wallet.isConnected ? <button className="quiet" disabled={busy} onClick={wallet.disconnect}>Disconnect</button> : <div className="wallet-list">{wallet.installedExtensions.map(name => <button key={name} disabled={busy} onClick={() => wallet.connect(name, undefined, e => setError(message(e)))}>{name}</button>)}{!wallet.installedExtensions.length && <span>No CIP-30 wallet found. Install a browser wallet and reload.</span>}</div>}</div>
    {offer && !pending && <div className="offer"><div><span>PAYMENT-REQUIRED</span><b>{amount} tADA + fee</b></div><p>Merchant address</p><code>{config?.payTo}</code><p>Release after inclusion + 1 newer block. {quoteTooOld ? 'Quote is expiring; request a fresh one.' : `Quote expires in ${Math.floor(quoteSecondsLeft / 60)}m ${quoteSecondsLeft % 60}s.`}</p></div>}
    {pending ? <button className="primary" onClick={retry} disabled={busy}>{busy ? 'Waiting for preprod confirmation…' : 'Check the same payment again →'}</button> : offer && !quoteTooOld ? <button className="primary" onClick={pay} disabled={busy || !wallet.isConnected}>{busy ? 'Build, sign, and settle…' : `Approve ${amount} tADA in wallet →`}</button> : <button className="primary" onClick={requestQuote} disabled={busy || !config || !question.trim()}>{busy ? 'Requesting…' : freshQuoteNeeded || quoteTooOld ? 'Request a fresh quote →' : 'Ask and see the 402 quote →'}</button>}
    {error && <div className="error" role="alert">{error}</div>}{pending && <p className="hint">Your signed payment is saved in this tab. Retrying reuses it without requesting another signature. Confirmation can take a few minutes.</p>}</section>
    <section className="trace panel"><div className="panel-heading"><span>02 / THE HANDSHAKE</span><span className="live-dot">Live trace</span></div><h2>Follow the HTTP exchange</h2>{trace.length === 0 ? <div className="empty"><span>402</span><h3>The request starts here.</h3><p>Ask a question to see the server’s payment requirements. Every response will appear in this panel.</p></div> : <ol>{trace.map((t, i) => <li key={i}><span className="status">{t.status}</span><div><h3>{t.title}</h3><p>{t.detail}</p>{t.data !== undefined && <details><summary>Inspect protocol JSON</summary><pre>{JSON.stringify(t.data, null, 2)}</pre></details>}</div></li>)}</ol>}</section></div>
    {answer && <section className="answer panel"><div className="panel-heading"><span>03 / YOUR PAID RESOURCE</span><span className="tag success">HTTP 200 · Paid</span></div><h2>{answer.result.question}</h2><p>{answer.result.answer}</p><div className="receipt"><span>Confirmed on Cardano preprod · {answer.settlement.extra?.confirmations} newer blocks</span><a href={`https://preprod.cardanoscan.io/transaction/${answer.settlement.transaction}`} target="_blank" rel="noreferrer">View transaction ↗</a></div><code>{answer.settlement.transaction}</code></section>}
    <footer><p>Browser wallet → Spring Boot resource server → CF facilitator → Cardano</p><span>Built with the official x402 Cardano SDK and CF Connect with Wallet.</span></footer></main></div>;
}
function message(e: unknown) { return e instanceof Error ? e.message : String(e); }
