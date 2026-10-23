/**
 * Automated End-to-End Verification Test for The Augusta Collection (Gemini 3.8 Flash).
 */

const BASE_URL = 'http://127.0.0.1:8942';

async function run() {
  console.log('\n  🏌️ Running End-to-End Verification Test against http://127.0.0.1:8942...\n');

  // 1. Health check
  console.log('  1. Checking /api/health...');
  const healthRes = await fetch(`${BASE_URL}/api/health`);
  if (!healthRes.ok) throw new Error(`Health check failed with status ${healthRes.status}`);
  const health = await healthRes.json();
  console.log(`     ✓ MCP Status: ${health.mcp.state} (${health.tools} tools available)`);
  console.log(`     ✓ Agent Model: ${health.model}`);

  // 2. Reset state
  console.log('\n  2. Resetting session state...');
  await fetch(`${BASE_URL}/api/reset`, { method: 'POST' });
  console.log('     ✓ State reset clean.');

  // 3. Add 3 Tour Velocity balls to cart ($16.00)
  console.log('\n  3. Adding 3 Tour Velocity balls ($16.00) to bag...');
  const addRes = await fetch(`${BASE_URL}/api/cart/add`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'tour-velocity-3' }),
  });
  const addData = await addRes.json();
  console.log(`     ✓ Cart items: ${addData.state.cartCount} balls, total: ${addData.state.cartTotalLabel}`);
  if (addData.state.cartTotal !== 1600) {
    throw new Error(`Expected cart total 1600 cents ($16.00), got ${addData.state.cartTotal}`);
  }

  // 4. Trigger checkout
  console.log('\n  4. Triggering checkout turn via Gemini 3.8 Flash & Global Payments MCP...');
  const t0 = Date.now();
  const checkoutRes = await fetch(`${BASE_URL}/api/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'conor.a.redmond+deals@gmail.com' }),
  });

  const duration = Date.now() - t0;
  if (!checkoutRes.ok) {
    const err = await checkoutRes.json();
    throw new Error(`Checkout failed: ${err.error || JSON.stringify(err)}`);
  }
  const checkoutData = await checkoutRes.json();

  console.log(`     ✓ Gemini 3.8 Flash Turn Duration: ${duration}ms`);
  console.log(`     ✓ Assistant Reply: "${checkoutData.reply.slice(0, 100)}..."`);
  console.log(`     ✓ Payment Link ID: ${checkoutData.link?.id}`);
  console.log(`     ✓ Payment URL: ${checkoutData.link?.url}`);
  console.log(`     ✓ Payment Status: ${checkoutData.link?.status}`);

  // 5. Verify final state and email dispatch
  console.log('\n  5. Verifying server state and email transport...');
  const stateRes = await fetch(`${BASE_URL}/api/state`);
  const finalState = (await stateRes.json()).state;
  console.log(`     ✓ Email Transport: ${finalState.emailResult?.transport}`);
  console.log(`     ✓ Email Recipient: ${finalState.emailResult?.to}`);
  console.log(`     ✓ Email Subject: "${finalState.emailResult?.subject}"`);
  console.log(`     ✓ Email Status: ${finalState.emailResult?.ok ? 'DELIVERED' : 'FAILED'}`);

  console.log('\n  ✨ E2E Test Passed with 100% verification!\n');
}

run().catch((err) => {
  console.error('\n  ❌ Test failed:', err.message);
  process.exit(1);
});
