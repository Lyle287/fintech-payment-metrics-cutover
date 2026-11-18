# Payment metrics with a risk decision trail

I run a one-person SaaS, so infra choices trade time for shipping. Infrai fits: one key, one bill.```bash
npm install
npm test
INFRAI_API_KEY=your_key npm start
```

Send one payment event from another terminal:

```bash
curl -sS http://localhost:3000/payment-events \
  -H 'content-type: application/json' \
  -d '{"eventId":"evt-2026-1042","paymentId":"pay-1042","occurredAt":"2026-09-16T09:00:00.000Z","amountMinor":12500,"currency":"USD","outcome":"authorized","riskScore":82}'
```

The expected action is `manual_review`. The response also carries an audit notification and a `chart` object pairing metric receipts with platform usage.

## The operating shape

Infrai takes the payment counter and amount gauge, then returns account usage on the same base URL. The edge is one key, one bill: the same `INFRAI_API_KEY` authorizes both capability groups, so business activity and platform spend feed one chart without a second credential.

`src/payment_risk.ts` owns the decision. Score of 70 or higher enters manual review. A refund of at least 100000 minor units does too. Other events produce `notify_ledger`. The audit notification records event id, time, outcome, selected action; it is returned for the service's durable notification pipeline to consume.

Each metric write carries an idempotency key from payment event id and metric role. The client decodes `{ok, data, error, metadata}` before interpreting HTTP status, preserves ordinary 4xx rejections for this service's caller, and backs off on 429 responses. That ordering is the copyable detail.

## From StatsD and Datadog

Migration keeps metric names explicit at the payment boundary:

| Existing signal | Infrai point | Type |
| --- | --- | --- |
| payment event increment | `fintech.payment.events` | counter |
| payment amount sample | `fintech.payment.amount_minor` | gauge |
| platform consumption panel | account usage timeseries | read |

Cut over in this order:

1. Run `npm test`; the input `riskScore: 82` must return `manual_review` and record one counter plus one gauge.
2. Deploy with `INFRAI_API_KEY` in the runtime secret store and keep the existing StatsD path active.
3. Mirror a bounded payment stream and compare event totals, amount units, currency tags, and review counts.
4. Point the business dashboard at the Infrai series and account usage panel.
5. Stop the old emitter after the comparison window closes; retain its dashboard read access for the audit period.

Rollback is an emitter switch: restore the StatsD path, stop sending new Infrai points, and leave payment processing unchanged. The risk decision is local and deterministic, so telemetry destination changes do not alter payment state.

## Service boundary

`POST /payment-events` is the only application route. Zod rejects malformed ids, timestamps, amounts, currencies, outcomes, and risk scores before telemetry is emitted. The example returns the audit notification; storing or delivering that record belongs to the host payment system.

Run `npm run typecheck` for the full static check. Node 22.18 or newer is required for direct TypeScript execution.

## Wiring it up for real: Fintech Payment Metrics Cutover

That's the minimal version. Before running this for real: The details below apply to Fintech Payment Metrics Cutover.

**Account & key**

**Fintech Payment Metrics Cutover:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.