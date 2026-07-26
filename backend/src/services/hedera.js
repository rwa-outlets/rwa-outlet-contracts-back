// Hedera agentic-payments service (Hedera prize track: AI & Agentic Payments).
//
// The curator agent's treasury on Hedera testnet, built directly on
// @hashgraph/sdk (qualifying integration path: "Hedera SDKs directly"). Three
// capabilities, consumed by the MCP tools (src/mcp/hedera-server.js) and by
// the agent's post-run settlement hook (src/services/agent.js):
//
//   transferHbar     — HBAR payment with a memo (the payment leg)
//   submitDecision   — append a decision record to the public HCS audit topic
//   settleAgentRun   — autonomous per-run settlement: pays the per-query data
//                      fee and logs the decision; called fire-and-forget after
//                      every agent run that touched the subgraph
//
// The whole feature is dormant unless HEDERA_ACCOUNT_ID + HEDERA_PRIVATE_KEY
// are set, so deployments without keys behave exactly as before.

const {
  Client, AccountId, PrivateKey, Hbar,
  TransferTransaction, TopicCreateTransaction, TopicMessageSubmitTransaction,
  AccountBalanceQuery,
} = require('@hashgraph/sdk');
const env = require('../env');

const NETWORK = env.HEDERA_NETWORK;

function isConfigured() {
  return Boolean(env.HEDERA_ACCOUNT_ID && env.HEDERA_PRIVATE_KEY);
}

// Portal keys come in several encodings (DER, raw ECDSA hex, raw ED25519 hex).
function parsePrivateKey(str) {
  const attempts = [
    () => PrivateKey.fromStringDer(str),
    () => PrivateKey.fromStringECDSA(str),
    () => PrivateKey.fromStringED25519(str),
  ];
  for (const attempt of attempts) {
    try { return attempt(); } catch { /* next encoding */ }
  }
  throw new Error('HEDERA_PRIVATE_KEY is not a valid DER, ECDSA, or ED25519 private key');
}

let clientSingleton = null;

function getClient() {
  if (!isConfigured()) throw new Error('Hedera is not configured (set HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY)');
  if (!clientSingleton) {
    const operatorId = AccountId.fromString(env.HEDERA_ACCOUNT_ID);
    const operatorKey = parsePrivateKey(env.HEDERA_PRIVATE_KEY);
    clientSingleton = Client.forName(NETWORK)
      .setOperator(operatorId, operatorKey)
      // Testnet safety rails — nothing this service does should cost more.
      .setDefaultMaxTransactionFee(new Hbar(2))
      .setDefaultMaxQueryPayment(new Hbar(1));
  }
  return clientSingleton;
}

// ------------------------------------------------------------------ hashscan

// "0.0.123@1699999999.123456789" → "0.0.123-1699999999-123456789"
function hashscanTxUrl(transactionId) {
  const [account, timestamp] = transactionId.toString().split('@');
  return `https://hashscan.io/${NETWORK}/transaction/${account}-${timestamp.replace('.', '-')}`;
}

function hashscanTopicUrl(topicId) {
  return `https://hashscan.io/${NETWORK}/topic/${topicId}`;
}

function hashscanAccountUrl(accountId) {
  return `https://hashscan.io/${NETWORK}/account/${accountId}`;
}

// ------------------------------------------------------- receipts ring buffer

// Judges and the frontend read this via GET /api/hedera/receipts — a live,
// clickable audit trail of everything the agent settled on Hedera.
const RECEIPTS_MAX = 50;
const receipts = [];

function recordReceipt(receipt) {
  receipts.unshift(receipt);
  if (receipts.length > RECEIPTS_MAX) receipts.pop();
  return receipt;
}

function getReceipts() {
  return receipts;
}

// ------------------------------------------------------------------ HCS topic

let topicPromise = null;

// Uses HEDERA_HCS_TOPIC_ID when pinned (recommended — survives restarts),
// otherwise lazily creates one and logs the id to pin later.
function ensureTopic() {
  if (!topicPromise) {
    topicPromise = (async () => {
      if (env.HEDERA_HCS_TOPIC_ID) return env.HEDERA_HCS_TOPIC_ID;
      const client = getClient();
      const response = await new TopicCreateTransaction()
        .setTopicMemo('RWA Outlets — curator agent decision log')
        .execute(client);
      const topicReceipt = await response.getReceipt(client);
      const topicId = topicReceipt.topicId.toString();
      console.log(`[hedera] created HCS audit topic ${topicId} — pin it via HEDERA_HCS_TOPIC_ID to keep one trail across restarts (${hashscanTopicUrl(topicId)})`);
      return topicId;
    })().catch((err) => {
      topicPromise = null; // allow retry on the next call
      throw err;
    });
  }
  return topicPromise;
}

// ------------------------------------------------------------------ operations

// HBAR payment with a memo. `amountHbar` is capped by HEDERA_MAX_TRANSFER_HBAR
// (the agent drives this through an LLM tool — the cap bounds the blast radius).
async function transferHbar({ to, amountHbar, memo }) {
  const amount = Number(amountHbar);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error(`invalid amount: ${amountHbar}`);
  if (amount > env.HEDERA_MAX_TRANSFER_HBAR) {
    throw new Error(`amount ${amount} ℏ exceeds the HEDERA_MAX_TRANSFER_HBAR cap of ${env.HEDERA_MAX_TRANSFER_HBAR} ℏ`);
  }
  const client = getClient();
  const tinybars = Math.round(amount * 1e8);
  const tx = new TransferTransaction()
    .addHbarTransfer(env.HEDERA_ACCOUNT_ID, Hbar.fromTinybars(-tinybars))
    .addHbarTransfer(to, Hbar.fromTinybars(tinybars));
  if (memo) tx.setTransactionMemo(String(memo).slice(0, 100));
  const response = await tx.execute(client);
  const receipt = await response.getReceipt(client);
  return {
    kind: 'payment',
    status: receipt.status.toString(),
    transactionId: response.transactionId.toString(),
    hashscanUrl: hashscanTxUrl(response.transactionId),
    from: env.HEDERA_ACCOUNT_ID,
    to,
    amountHbar: amount,
    memo: memo || null,
    at: new Date().toISOString(),
  };
}

// Append a JSON decision record to the curator's public HCS audit topic.
async function submitDecision(record) {
  const client = getClient();
  const topicId = await ensureTopic();
  const message = JSON.stringify({ v: 1, ts: new Date().toISOString(), ...record });
  const response = await new TopicMessageSubmitTransaction()
    .setTopicId(topicId)
    .setMessage(message)
    .execute(client);
  const receipt = await response.getReceipt(client);
  return {
    kind: 'decision-log',
    status: receipt.status.toString(),
    transactionId: response.transactionId.toString(),
    hashscanUrl: hashscanTxUrl(response.transactionId),
    topicId,
    topicUrl: hashscanTopicUrl(topicId),
    sequenceNumber: receipt.topicSequenceNumber ? receipt.topicSequenceNumber.toString() : null,
    message,
    at: new Date().toISOString(),
  };
}

async function getOperatorBalance() {
  const client = getClient();
  const balance = await new AccountBalanceQuery()
    .setAccountId(env.HEDERA_ACCOUNT_ID)
    .execute(client);
  return balance.hbars.toString();
}

async function getStatus() {
  return {
    configured: true,
    network: NETWORK,
    operator: env.HEDERA_ACCOUNT_ID,
    operatorUrl: hashscanAccountUrl(env.HEDERA_ACCOUNT_ID),
    balance: await getOperatorBalance(),
    topicId: env.HEDERA_HCS_TOPIC_ID || null,
    topicUrl: env.HEDERA_HCS_TOPIC_ID ? hashscanTopicUrl(env.HEDERA_HCS_TOPIC_ID) : null,
    feeCollector: env.HEDERA_FEE_COLLECTOR_ID || null,
    queryFeeHbar: env.HEDERA_QUERY_FEE_HBAR,
    maxTransferHbar: env.HEDERA_MAX_TRANSFER_HBAR,
  };
}

// ------------------------------------------------- autonomous run settlement

// Called (fire-and-forget) after every agent run that used tools: settles the
// per-subgraph-query data fee and appends the decision record to HCS. This is
// the "agent executes payments autonomously" flow — no human in the loop.
async function settleAgentRun({ model, question, tools, queries, answerPreview }) {
  let feePayment = null;
  if (queries > 0 && env.HEDERA_FEE_COLLECTOR_ID) {
    feePayment = await transferHbar({
      to: env.HEDERA_FEE_COLLECTOR_ID,
      amountHbar: Number((env.HEDERA_QUERY_FEE_HBAR * queries).toFixed(8)),
      memo: `rwa-outlets:data-fee:${queries}q`,
    });
    recordReceipt(feePayment);
  }
  const decision = await submitDecision({
    kind: 'curator-decision',
    model,
    question: (question || '').slice(0, 200),
    tools,
    subgraphQueries: queries,
    dataFee: feePayment
      ? { amountHbar: feePayment.amountHbar, transactionId: feePayment.transactionId, hashscanUrl: feePayment.hashscanUrl }
      : null,
    answer: (answerPreview || '').slice(0, 240),
  });
  recordReceipt(decision);
  return { feePayment, decision };
}

module.exports = {
  isConfigured,
  transferHbar,
  submitDecision,
  settleAgentRun,
  getOperatorBalance,
  getStatus,
  getReceipts,
  recordReceipt,
  hashscanTxUrl,
  hashscanTopicUrl,
  ensureTopic,
  parsePrivateKey,
};
