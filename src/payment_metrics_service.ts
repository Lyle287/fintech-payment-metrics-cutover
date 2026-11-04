import { createServer } from "node:http";
import { ZodError } from "zod";
import { InfraiClient, InfraiError } from "./infrai_client.ts";
import { paymentEventSchema, processPaymentEvent } from "./payment_risk.ts";

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("INFRAI_API_KEY is required");

const infrai = new InfraiClient({ apiKey });
const port = Number(process.env.PORT ?? 3000);

const server = createServer(async (request, response) => {
  response.setHeader("Content-Type", "application/json");
  if (request.method !== "POST" || request.url !== "/payment-events") {
    response.writeHead(404).end(JSON.stringify({ error: "route_not_found" }));
    return;
  }

  try {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const event = paymentEventSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    const result = await processPaymentEvent(event, infrai);
    response.writeHead(202).end(JSON.stringify(result));
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) {
      response.writeHead(400).end(JSON.stringify({ error: "invalid_payment_event" }));
      return;
    }
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      response.writeHead(status).end(JSON.stringify({ error: error.code, message: error.message }));
      return;
    }
    response.writeHead(500).end(JSON.stringify({ error: "request_failed" }));
  }
});

server.listen(port, () => {
  console.log(`payment metrics service listening on http://localhost:${port}`);
});
