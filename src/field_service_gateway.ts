import { createServer, type ServerResponse } from "node:http";
import { z } from "zod";

const updateSchema = z.object({
  work_order_id: z.string().min(1),
  photo_urls: z.array(z.string().url()).max(12),
  dispatch_status: z.enum(["assigned", "en_route", "on_site", "completed"]),
  technician_follow_up: z.string().max(1000).optional(),
}).strict();

type WorkOrderUpdate = z.infer<typeof updateSchema>;
const workOrders = new Map<string, WorkOrderUpdate>();

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

const server = createServer((request, response) => {
  if (request.method !== "POST" || request.url !== "/work-orders/update") {
    json(response, 404, { error: "route not found" });
    return;
  }

  let raw = "";
  request.setEncoding("utf8");
  request.on("data", (chunk: string) => { raw += chunk; });
  request.on("end", () => {
    let input: unknown;
    try {
      input = JSON.parse(raw);
    } catch {
      json(response, 400, { error: "body must be valid JSON" });
      return;
    }
    const parsed = updateSchema.safeParse(input);
    if (!parsed.success) {
      json(response, 422, { error: "invalid work-order update", issues: parsed.error.issues });
      return;
    }
    workOrders.set(parsed.data.work_order_id, parsed.data);
    json(response, 200, { saved: true, work_order: parsed.data });
  });
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`Field-service gateway listening on http://localhost:${port}`));
