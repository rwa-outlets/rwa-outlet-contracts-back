/**
 * Every agent decision, logged with the subgraph query + entities it was
 * based on and the action (if any) it took. This log IS the demo evidence
 * for the Graph track ("query -> reasoning -> action") and pairs with the
 * Hedera HCS audit-trail bonus (mirror entries there once wired up).
 *
 * In-memory + process log for the hackathon; swap for a real store (or HCS
 * topic) if this needs to survive restarts / be independently auditable.
 */
export interface AgentDecision {
  id: string;
  timestamp: string;
  query: string; // human-readable description of what was queried
  entities: unknown; // raw subgraph entities the decision was based on
  reasoning: string; // the agent's stated reasoning
  action:
    | { type: "none" }
    | { type: "createPool"; asset: string; poolType: string }
    | { type: "dockPool"; strategyHash: string }
    | { type: "recycle"; asset: string; amount: string }
    | { type: "fulfillRedeemEpoch"; epoch: string }
    | { type: "hederaPayment"; txId: string; amount: string; recipient: string };
}

const log: AgentDecision[] = [];

export function recordDecision(decision: Omit<AgentDecision, "id" | "timestamp">): AgentDecision {
  const entry: AgentDecision = {
    ...decision,
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
  };
  log.push(entry);
  return entry;
}

export function getDecisionLog(): AgentDecision[] {
  return [...log].reverse(); // most recent first
}
