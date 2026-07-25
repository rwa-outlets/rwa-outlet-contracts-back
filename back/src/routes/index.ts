import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { runAgentCycle } from "../agent/loop.js";
import { getDecisionLog } from "../agent/decisionLog.js";

export async function registerRoutes(app: FastifyInstance) {
  // GET /api/agent/decisions — the demo evidence: every reasoning step the
  // agent has taken, with the query + entities it acted on.
  app.get("/agent/decisions", async () => {
    return { decisions: getDecisionLog() };
  });

  // POST /api/agent/run — manually trigger one query -> reason -> act cycle.
  // Useful for the demo; a real deployment would also run this on a timer.
  const RunAgentBody = z.object({
    dryRun: z.boolean().default(false),
  });

  app.post("/agent/run", async (req, reply) => {
    const parsed = RunAgentBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    const result = await runAgentCycle({ dryRun: parsed.data.dryRun });
    return result;
  });
}
