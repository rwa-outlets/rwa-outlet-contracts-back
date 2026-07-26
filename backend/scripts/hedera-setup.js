#!/usr/bin/env node
// One-shot Hedera bootstrap for the curator agent's payment rail.
//
// Prereq: a funded testnet account from https://portal.hedera.com (faucet),
// with HEDERA_ACCOUNT_ID + HEDERA_PRIVATE_KEY in .env. Then:
//
//   npm run hedera:setup
//
// It will, idempotently:
//   1. verify the operator key and print the balance
//   2. create the HCS decision-log topic       (unless HEDERA_HCS_TOPIC_ID set)
//   3. create + fund the fee-collector account (unless HEDERA_FEE_COLLECTOR_ID set)
//   4. send a 0.001 ℏ proof payment + a proof HCS message
//   5. print hashscan.io links and the exact env lines to paste into .env
//      (and into terraform.tfvars for the deployed backend)

require('dotenv').config();
const {
  Client, AccountId, PrivateKey, Hbar,
  AccountCreateTransaction, AccountBalanceQuery,
} = require('@hashgraph/sdk');
const hedera = require('../src/services/hedera');
const env = require('../src/env');

async function main() {
  if (!env.HEDERA_ACCOUNT_ID || !env.HEDERA_PRIVATE_KEY) {
    console.error('Set HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY in .env first.');
    console.error('Create + fund a testnet account at https://portal.hedera.com');
    process.exit(1);
  }

  const operatorKey = hedera.parsePrivateKey(env.HEDERA_PRIVATE_KEY);
  const client = Client.forName(env.HEDERA_NETWORK)
    .setOperator(AccountId.fromString(env.HEDERA_ACCOUNT_ID), operatorKey)
    .setDefaultMaxTransactionFee(new Hbar(2));

  // 1 — operator sanity
  const balance = await new AccountBalanceQuery()
    .setAccountId(env.HEDERA_ACCOUNT_ID)
    .execute(client);
  console.log(`operator ${env.HEDERA_ACCOUNT_ID} on ${env.HEDERA_NETWORK} — balance ${balance.hbars.toString()}`);
  console.log(`  https://hashscan.io/${env.HEDERA_NETWORK}/account/${env.HEDERA_ACCOUNT_ID}\n`);

  // 2 — HCS audit topic
  let topicId = env.HEDERA_HCS_TOPIC_ID;
  if (topicId) {
    console.log(`HCS topic already pinned: ${topicId}`);
  } else {
    topicId = await hedera.ensureTopic();
    console.log(`created HCS decision-log topic: ${topicId}`);
  }
  console.log(`  ${hedera.hashscanTopicUrl(topicId)}\n`);

  // 3 — fee-collector account (plays the "data provider" being paid per query)
  let collectorId = env.HEDERA_FEE_COLLECTOR_ID;
  let collectorKeyLine = null;
  if (collectorId) {
    console.log(`fee collector already pinned: ${collectorId}`);
  } else {
    const collectorKey = PrivateKey.generateECDSA();
    const createTx = new AccountCreateTransaction().setInitialBalance(new Hbar(1));
    // SDK ≥2.69 renamed setKey; support both so the script survives upgrades.
    if (typeof createTx.setKeyWithoutAlias === 'function') createTx.setKeyWithoutAlias(collectorKey.publicKey);
    else createTx.setKey(collectorKey.publicKey);
    const response = await createTx.execute(client);
    const receipt = await response.getReceipt(client);
    collectorId = receipt.accountId.toString();
    collectorKeyLine = `# fee-collector private key (testnet only, kept for reference): ${collectorKey.toStringDer()}`;
    console.log(`created fee-collector account: ${collectorId} (funded with 1 ℏ)`);
  }
  console.log(`  https://hashscan.io/${env.HEDERA_NETWORK}/account/${collectorId}\n`);

  // 4 — proof transactions (these are real testnet txs — demo evidence)
  process.env.HEDERA_FEE_COLLECTOR_ID = collectorId; // let the service see it
  const payment = await hedera.transferHbar({
    to: collectorId,
    amountHbar: 0.001,
    memo: 'rwa-outlets:setup-proof',
  });
  console.log(`proof payment SUCCESS: ${payment.transactionId}`);
  console.log(`  ${payment.hashscanUrl}`);
  const log = await hedera.submitDecision({
    kind: 'setup-proof',
    note: 'curator agent payment rail initialized',
  });
  console.log(`proof HCS message #${log.sequenceNumber}: ${log.transactionId}`);
  console.log(`  ${log.hashscanUrl}\n`);

  // 5 — env lines to pin
  console.log('Pin these in backend/.env (and terraform.tfvars for the deployment):\n');
  console.log(`HEDERA_HCS_TOPIC_ID=${topicId}`);
  console.log(`HEDERA_FEE_COLLECTOR_ID=${collectorId}`);
  if (collectorKeyLine) console.log(collectorKeyLine);

  client.close();
}

main().catch((err) => {
  console.error('hedera-setup failed:', err.message);
  process.exit(1);
});
