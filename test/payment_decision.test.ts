import assert from "node:assert/strict";
import test from "node:test";
import type { MetricPoint, MetricsBackend } from "../src/infrai_client.ts";
import { paymentEventSchema, processPaymentEvent } from "../src/payment_risk.ts";

class RecordingBackend implements MetricsBackend {
  readonly points: MetricPoint[] = [];

  async report(point: MetricPoint) {
    this.points.push(point);
    return { accepted: true, name: point.name };
  }

  async usageTimeseries() {
    return [{ period: "current", spend: 12 }];
  }
}

test("high-risk authorization is held for review and emits counter plus amount gauge", async () => {
  const backend = new RecordingBackend();
  const event = paymentEventSchema.parse({
    eventId: "evt-risk-1042",
    paymentId: "pay-1042",
    occurredAt: "2026-09-16T09:00:00.000Z",
    amountMinor: 125_00,
    currency: "usd",
    outcome: "authorized",
    riskScore: 82,
  });

  const result = await processPaymentEvent(event, backend);

  assert.equal(result.action, "manual_review");
  assert.equal(result.auditNotification.eventId, "evt-risk-1042");
  assert.deepEqual(backend.points.map(({ name, type, value }) => ({ name, type, value })), [
    { name: "fintech.payment.events", type: "counter", value: 1 },
    { name: "fintech.payment.amount_minor", type: "gauge", value: 12500 },
  ]);
  assert.equal(backend.points[0]?.idempotency_key, "evt-risk-1042:event:v1");
});

test("low-risk authorization produces the ledger notification decision", async () => {
  const backend = new RecordingBackend();
  const event = paymentEventSchema.parse({
    eventId: "evt-clear-1043",
    paymentId: "pay-1043",
    occurredAt: "2026-09-16T09:01:00.000Z",
    amountMinor: 4900,
    currency: "EUR",
    outcome: "authorized",
    riskScore: 12,
  });

  const result = await processPaymentEvent(event, backend);

  assert.equal(result.action, "notify_ledger");
  assert.equal(result.auditNotification.outcome, "authorized");
});
