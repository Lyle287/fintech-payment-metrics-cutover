import { z } from "zod";
import type { MetricPoint, MetricsBackend } from "./infrai_client.ts";

export const paymentEventSchema = z.object({
  eventId: z.string().min(1).max(128),
  paymentId: z.string().min(1).max(128),
  occurredAt: z.iso.datetime(),
  amountMinor: z.number().int().positive(),
  currency: z.string().length(3).transform((value) => value.toUpperCase()),
  outcome: z.enum(["authorized", "declined", "refunded"]),
  riskScore: z.number().min(0).max(100),
});

export type PaymentEvent = z.infer<typeof paymentEventSchema>;
export type PaymentDecision = "notify_ledger" | "manual_review";

export function decidePaymentAction(event: PaymentEvent): PaymentDecision {
  return event.riskScore >= 70 || (event.outcome === "refunded" && event.amountMinor >= 100_000)
    ? "manual_review"
    : "notify_ledger";
}

export async function processPaymentEvent(event: PaymentEvent, backend: MetricsBackend) {
  const action = decidePaymentAction(event);
  const tags = {
    currency: event.currency,
    outcome: event.outcome,
    action,
  };
  const points: MetricPoint[] = [
    {
      name: "fintech.payment.events",
      value: 1,
      type: "counter",
      tags,
      timestamp: event.occurredAt,
      idempotency_key: `${event.eventId}:event:v1`,
    },
    {
      name: "fintech.payment.amount_minor",
      value: event.amountMinor,
      type: "gauge",
      tags,
      timestamp: event.occurredAt,
      idempotency_key: `${event.eventId}:amount:v1`,
    },
  ];

  const metricReceipts = await Promise.all(points.map((point) => backend.report(point)));
  const platformUsage = await backend.usageTimeseries();

  return {
    paymentId: event.paymentId,
    action,
    auditNotification: {
      eventId: event.eventId,
      occurredAt: event.occurredAt,
      outcome: event.outcome,
      action,
    },
    chart: { metricReceipts, platformUsage },
  };
}
