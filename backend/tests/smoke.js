// Walks through every route once against a running instance of the backend.
// Usage: BASE_URL=http://localhost:3000 node tests/smoke.js
// No dependencies — uses Node 22's built-in fetch.

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const USER = '0xTestUser000000000000000000000000000001';
let failures = 0;

async function check(label, fn) {
  try {
    const result = await fn();
    console.log(`✓ ${label}`);
    return result;
  } catch (err) {
    failures += 1;
    console.error(`✗ ${label} — ${err.message}`);
    return null;
  }
}

async function req(method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(data)}`);
  return data;
}

async function main() {
  console.log(`Testing ${BASE_URL}\n`);

  await check('GET /health', async () => {
    const r = await req('GET', '/health');
    if (r.status !== 'ok') throw new Error('unexpected body');
  });

  await check('GET /api/assets', async () => {
    const r = await req('GET', '/api/assets');
    if (!Array.isArray(r) || r.length === 0) throw new Error('expected non-empty array');
  });

  await check('GET /api/pools', () => req('GET', '/api/pools'));
  await check('GET /api/pool-types', () => req('GET', '/api/pool-types'));
  await check('GET /api/vaults', () => req('GET', '/api/vaults'));
  await check('GET /api/dashboard', () => req('GET', '/api/dashboard'));

  const trade = await check('POST /api/trades', () => req('POST', '/api/trades', {
    poolId: 'express-tbill', direction: 'exit', amount: 1000, maker: USER,
  }));
  if (trade) console.log(`  usdcReceived: ${trade.usdcReceived}`);

  const request = await check('POST /api/queue', () => req('POST', '/api/queue', {
    user: USER, assetId: 'rwaTBILL', amountTokens: 500,
  }));

  if (request) {
    await check('POST /api/queue/:id/mark-claimable', () => req('POST', `/api/queue/${request._id}/mark-claimable`));
    await check('POST /api/queue/:id/claim', () => req('POST', `/api/queue/${request._id}/claim`));
  }

  await check('GET /api/queue?user=', async () => {
    const r = await req('GET', `/api/queue?user=${USER}`);
    if (!r.some((x) => x.status === 'Claimed')) throw new Error('expected a claimed request');
  });

  const position = await check('POST /api/vault-positions', () => req('POST', '/api/vault-positions', {
    user: USER, vaultId: 'express-tier', amount: 1000,
  }));

  if (position) {
    await check('POST /api/vault-positions/:id/withdraw', () => req('POST', `/api/vault-positions/${position._id}/withdraw`, {
      amountShares: 200,
    }));
  }

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
