#!/usr/bin/env node
// MCP server exposing the RWA Outlets subgraph — a Node take on
// kukapay/thegraph-mcp. Two tools:
//   get_subgraph_schema  — introspects the subgraph and returns the SDL
//   query_subgraph       — executes an arbitrary GraphQL query
//
// Used two ways:
//   - in-process by the backend's chat agent (src/services/agent.js) via an
//     InMemoryTransport — no extra process, no port
//   - standalone over stdio (`npm run mcp`) for Claude Desktop / other MCP hosts
// Config via env: SUBGRAPH_URL — GraphQL endpoint of the deployed subgraph.

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { z } = require('zod');
const {
  getIntrospectionQuery, buildClientSchema, printSchema,
} = require('graphql');

// Keep tool results bounded so a huge result set can't blow up the model's
// context window (or a free-tier TPM budget) — the agent can always re-query
// with `first:` limits.
const MAX_RESULT_CHARS = Number(process.env.MAX_TOOL_RESULT_CHARS || 15_000);

// The Graph auto-generates enormous `input *_filter` / `*_orderBy` boilerplate
// per entity. Strip it from the SDL — models know the `where:` conventions —
// so the schema fits comfortably in small token budgets.
function compactSdl(sdl) {
  return sdl
    .split(/\n\n+/)
    .filter((block) => {
      const head = block.replace(/^"""[\s\S]*?"""\s*/, '');
      return !/^(input |enum \w+_orderBy|type Subscription|directive )/.test(head);
    })
    .join('\n\n');
}

async function graphqlRequest(query, variables) {
  const url = process.env.SUBGRAPH_URL;
  if (!url) {
    throw new Error('SUBGRAPH_URL is not set — point it at the deployed subgraph query endpoint');
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: variables || undefined }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Subgraph responded ${res.status}: ${text.slice(0, 500)}`);
  }
  return res.json();
}

function asToolResult(payload, isError = false) {
  let text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  if (text.length > MAX_RESULT_CHARS) {
    text = `${text.slice(0, MAX_RESULT_CHARS)}\n…[truncated — narrow the query with \`first:\` / \`where:\` and retry]`;
  }
  return { content: [{ type: 'text', text }], isError };
}

const server = new McpServer({ name: 'rwa-outlets-subgraph', version: '1.0.0' });

server.registerTool(
  'get_subgraph_schema',
  {
    description:
      'Fetch the GraphQL schema (SDL) of the RWA Outlets subgraph via introspection. '
      + 'Use this to discover entities, fields, and filters before writing queries.',
    inputSchema: {},
  },
  async () => {
    try {
      const result = await graphqlRequest(getIntrospectionQuery());
      if (result.errors) return asToolResult({ errors: result.errors }, true);
      const sdl = compactSdl(printSchema(buildClientSchema(result.data)));
      return asToolResult(
        `${sdl}\n\n# Note: The Graph's standard filter/order boilerplate is omitted.`
        + ' Every list field supports first, skip, orderBy: <fieldName>,'
        + ' orderDirection: asc|desc, and where: { field: v, field_gt, field_lt, field_in, ... }.',
      );
    } catch (err) {
      return asToolResult(`get_subgraph_schema failed: ${err.message}`, true);
    }
  },
);

server.registerTool(
  'query_subgraph',
  {
    description:
      'Execute a GraphQL query against the RWA Outlets subgraph (The Graph, Ethereum Sepolia). '
      + 'Indexes pools/strategies, trades with rateVsNavBps, NAV history, ERC-7540 redemption '
      + 'queues, curator vaults, KYC holders, token balances, and Uniswap v4 observations. '
      + 'Always bound result sets with `first:` (e.g. first: 25).',
    inputSchema: {
      query: z.string().describe('The GraphQL query to execute'),
      variables: z.record(z.any()).optional().describe('Optional GraphQL variables object'),
    },
  },
  async ({ query, variables }) => {
    try {
      const result = await graphqlRequest(query, variables);
      return asToolResult(result, Boolean(result.errors));
    } catch (err) {
      return asToolResult(`query_subgraph failed: ${err.message}`, true);
    }
  },
);

module.exports = { server };

// Standalone stdio mode (`npm run mcp`) — for external MCP hosts.
if (require.main === module) {
  require('dotenv').config();
  const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
  server.connect(new StdioServerTransport()).then(() => {
    // stdout is the MCP transport — log only to stderr.
    console.error(`[subgraph-mcp] ready (endpoint: ${process.env.SUBGRAPH_URL || 'UNSET'})`);
  }).catch((err) => {
    console.error('[subgraph-mcp] fatal:', err);
    process.exit(1);
  });
}
