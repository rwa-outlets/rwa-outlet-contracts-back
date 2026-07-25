import { Client, PrivateKey } from "@hiero-ledger/sdk";
import { requireEnv } from "../env.js";
import { recordDecision } from "../agent/decisionLog.js";

/**
 * Hedera Agent Kit v4 wiring for the "AI & Agentic Payments" track.
 * v4 loads ZERO tools by default — plugins must be passed explicitly.
 * Fund the operator via portal.hedera.com faucet (testnet only).
 *
 * Every tx ID must be logged and surfaced as a hashscan.io/testnet link —
 * that link is the demo evidence, so recordDecision() on every payment.
 */
let client: Client | undefined;

export function getHederaClient(): Client {
  if (!client) {
    const accountId = requireEnv("HEDERA_ACCOUNT_ID");
    const privateKey = requireEnv("HEDERA_PRIVATE_KEY");
    client = Client.forTestnet().setOperator(accountId, PrivateKey.fromStringECDSA(privateKey));
  }
  return client;
}

export function hashscanLink(txId: string): string {
  return `https://hashscan.io/testnet/transaction/${txId}`;
}

/**
 * Placeholder for the Hedera Agent Kit toolkit wiring:
 *
 *   import { HederaLangchainToolkit, AgentMode } from "@hashgraph/hedera-agent-kit-langchain";
 *   import { allCorePlugins } from "@hashgraph/hedera-agent-kit/plugins";
 *
 *   const toolkit = new HederaLangchainToolkit({
 *     client: getHederaClient(),
 *     configuration: { plugins: allCorePlugins, context: { mode: AgentMode.AUTONOMOUS } },
 *   });
 *
 * Wire this once the reasoning loop needs to trigger a real payment
 * (e.g. paying a maker their recycle fee, or a scheduled LP distribution).
 */
export async function recordHederaPayment(params: {
  txId: string;
  amount: string;
  recipient: string;
  reasoning: string;
}) {
  recordDecision({
    query: "hedera payment execution",
    entities: { recipient: params.recipient, amount: params.amount },
    reasoning: params.reasoning,
    action: { type: "hederaPayment", ...params },
  });
}
