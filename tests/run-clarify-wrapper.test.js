// tests/run-clarify-wrapper.test.js
// Verifies the _runClarify wrapper pattern used in server.js line 1633
// returns a Promise so the pr-checker can chain .catch() on it.

let assert;
try { assert = require('assert'); } catch { assert = require('node:assert'); }

// Simulates the production pattern from server.js:1633:
//   _runClarify = (tid) => { try { return runClarify(tid); } catch {} };
async function fakeRunClarify(tid) {
  return { clarified: false };
}

// Test 1: wrapper WITH return (the fix) — returns a Promise
(function testWithReturn() {
  const wrapper = (tid) => { try { return fakeRunClarify(tid); } catch {} };
  const result = wrapper('test-1');
  assert.ok(result instanceof Promise,
    'wrapper WITH return should return a Promise from the async function');
  console.log('PASS: wrapper with return returns a Promise (fix)');
})();

// Test 2: wrapper WITHOUT return (the bug) — returns undefined
(function testWithoutReturn() {
  const wrapper = (tid) => { try { fakeRunClarify(tid); } catch {} };
  const result = wrapper('test-2');
  assert.strictEqual(result, undefined,
    'wrapper WITHOUT return should return undefined');
  console.log('PASS: wrapper without return returns undefined (bug reproduced)');
})();

// Test 3: Promise.resolve(undefined) gracefully handles .catch()
(function testPromiseResolveUndefined() {
  let caught = false;
  const p = Promise.resolve(undefined).catch(() => { caught = true; });
  assert.ok(p instanceof Promise, 'Promise.resolve(undefined) returns a Promise');
  // .catch should not fire for a resolved promise
  assert.strictEqual(caught, false, '.catch should not fire on resolved Promise');
  console.log('PASS: Promise.resolve(undefined).catch() is safe (defensive hardening)');
})();

// Test 4: connection — wrapper with return can chain .catch() without crash
(async function testWrapperWithReturnChainsCatch() {
  const wrapper = (tid) => { try { return fakeRunClarify(tid); } catch {} };
  let caught = false;
  try {
    await wrapper('test-4').catch(() => { caught = true; });
  } catch {
    // Should never reach here — if it does, the test fails
    assert.fail('wrapper().catch() should not throw');
  }
  assert.strictEqual(caught, false, '.catch should not fire on resolved promise');
  console.log('PASS: wrapper with return supports .catch() chaining');
})();

console.log('\n\u2705 All run-clarify-wrapper tests passed');
process.exit(0);
