#!/usr/bin/env node
// MCP server exposing the curator agent's Hedera treasury (testnet).
//
// Three tools, backed by src/services/hedera.js (@hashgraph/sdk directly):
//   hedera_get_treasury   — operator account, balance, HCS topic, hashscan links
//   hedera_transfer_hbar  — pay HBAR to a Hedera account with a memo
//   hedera_log_decision   — append a record to the public HCS audit topic
//
// Used two ways, same as the subgraph MCP server:
//   - in-process by the chat agent (src/services/agent.js) via InMemoryTransport
//   - standalone over stdio (`npm run mcp:hedera`) for Claude Desktop / MCP hosts

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { z } = require('zod');
const hedera = require('../services/hedera');

function asToolResult(payload, isError = false) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  return { content: [{ type: 'text', text }], isError };
}

const server = new McpServer({ name: 'rwa-outlets-hedera', version: '1.0.0' });

server.registerTool(
  'hedera_get_treasury',
  {
    description:
      'Get the curator agent\'s Hedera testnet treasury status: operator account id, '
      + 'HBAR balance, the HCS decision-log topic, fee-collector account, and hashscan.io links.',
    inputSchema: {},
  },
  async () => {
    try {
      return asToolResult(await hedera.getStatus());
    } catch (err) {
      return asToolResult(`hedera_get_treasury failed: ${err.message}`, true);
    }
  },
);

server.registerTool(
  'hedera_transfer_hbar',
  {
    description:
      'Execute an HBAR payment from the curator treasury to a Hedera testnet account '
      + '(e.g. settle a curator/service fee). Returns the transaction id, consensus status, '
      + 'and a hashscan.io link — always cite that link to the user. Amounts are capped server-side.',
    inputSchema: {
      to: z.string().regex(/^\d+\.\d+\.\d+$/).describe('Recipient Hedera account id, e.g. 0.0.12345'),
      amountHbar: z.number().positive().describe('Amount in HBAR (testnet)'),
      memo: z.string().max(100).optional().describe('Transaction memo, e.g. what the payment settles'),
    },
  },
  async ({ to, amountHbar, memo }) => {
    try {
      const receipt = await hedera.transferHbar({ to, amountHbar, memo });
      hedera.recordReceipt(receipt);
      return asToolResult(receipt);
    } catch (err) {
      return asToolResult(`hedera_transfer_hbar failed: ${err.message}`, true);
    }
  },
);

server.registerTool(
  'hedera_log_decision',
  {
    description:
      'Append a curator decision record to the public Hedera Consensus Service audit topic. '
      + 'Use for notable decisions (rebalance recommendations, settlement calls, risk alerts) '
      + 'so they are independently verifiable. Returns the topic sequence number and hashscan.io links.',
    inputSchema: {
      summary: z.string().max(300).describe('One-line decision summary'),
      details: z.record(z.any()).optional().describe('Optional structured context (numbers, entity ids)'),
    },
  },
  async ({ summary, details }) => {
    try {
      const receipt = await hedera.submitDecision({ kind: 'curator-note', summary, details: details || null });
      hedera.recordReceipt(receipt);
      return asToolResult(receipt);
    } catch (err) {
      return asToolResult(`hedera_log_decision failed: ${err.message}`, true);
    }
  },
);

module.exports = { server };

// Standalone stdio mode (`npm run mcp:hedera`) — for external MCP hosts.
if (require.main === module) {
  require('dotenv').config();
  const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
  server.connect(new StdioServerTransport()).then(() => {
    // stdout is the MCP transport — log only to stderr.
    console.error(`[hedera-mcp] ready (${hedera.isConfigured() ? 'operator configured' : 'NOT CONFIGURED — set HEDERA_ACCOUNT_ID / HEDERA_PRIVATE_KEY'})`);
  }).catch((err) => {
    console.error('[hedera-mcp] fatal:', err);
    process.exit(1);
  });
}
