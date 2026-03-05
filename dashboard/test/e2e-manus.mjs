#!/usr/bin/env node
/**
 * E2E Test: Manus v3 Dashboard
 * Verifies WebSocket connection, tool event flow, and panel rendering.
 * 
 * Usage: node test/e2e-manus.mjs [--url URL] [--token TOKEN]
 * 
 * Requires: playwright (npx playwright install chromium)
 */
import { chromium } from 'playwright';

const BASE_URL = process.argv.find(a => a.startsWith('--url='))?.split('=')[1] || 'http://localhost:9001';
const TOKEN = process.argv.find(a => a.startsWith('--token='))?.split('=')[1] || 'rasputin-neural-2026';
const TIMEOUT = 15000;

let browser, page;
let passed = 0, failed = 0;

function ok(name) { passed++; console.log(`  ✅ ${name}`); }
function fail(name, err) { failed++; console.log(`  ❌ ${name}: ${err}`); }

async function test(name, fn) {
  try {
    await fn();
    ok(name);
  } catch (e) {
    fail(name, e.message);
  }
}

async function run() {
  console.log(`\n🧪 Manus v3 E2E Test Suite`);
  console.log(`   URL: ${BASE_URL}/manus-v3.html`);
  console.log(`   Token: ${TOKEN.slice(0, 8)}...`);
  console.log('');

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  page = await context.newPage();

  // ─── Test 1: Page loads ──────────────────────────────────
  console.log('📦 Page Load');
  await test('Page loads with 200', async () => {
    const resp = await page.goto(`${BASE_URL}/manus-v3.html?token=${TOKEN}`, { timeout: TIMEOUT });
    if (resp.status() !== 200) throw new Error(`Status ${resp.status()}`);
  });

  await test('Title contains Nexus', async () => {
    const title = await page.locator('.logo').textContent();
    if (!title.includes('Nexus')) throw new Error(`Title: ${title}`);
  });

  // ─── Test 2: WebSocket connects & authenticates ──────────
  console.log('\n🔌 WebSocket Connection');
  await test('WebSocket connects and authenticates', async () => {
    // Wait for connection indicator to turn green
    await page.waitForFunction(() => {
      return document.getElementById('connText')?.textContent === 'Connected';
    }, { timeout: TIMEOUT });
  });

  // ─── Test 3: Telemetry populates ─────────────────────────
  console.log('\n📊 Telemetry');
  await test('CPU metric appears', async () => {
    await page.waitForFunction(() => {
      const el = document.querySelector('.metric-value');
      return el && el.textContent && el.textContent !== '—';
    }, { timeout: TIMEOUT });
  });

  await test('GPU info appears', async () => {
    await page.waitForFunction(() => {
      const el = document.getElementById('gpuList');
      return el && !el.textContent.includes('Loading...');
    }, { timeout: TIMEOUT });
  });

  // ─── Test 4: Inject fake tool events to test rendering ───
  console.log('\n🔧 Tool Event Rendering');
  
  await test('Injected tool_start creates step', async () => {
    await page.evaluate(() => {
      handleMessage({
        type: 'tool_start',
        tool: 'exec',
        input: { command: 'echo "hello world"' },
        id: 'test-exec-1',
        description: 'Running: echo "hello world"',
        ts: Date.now(),
      });
    });
    const stepText = await page.locator('.step-desc').last().textContent();
    if (!stepText.includes('echo')) throw new Error(`Step text: ${stepText}`);
  });

  await test('Terminal tab shows command', async () => {
    await page.evaluate(() => document.querySelector('[data-tab="terminal"]').click());
    const content = await page.locator('#terminalContent').textContent();
    if (!content.includes('echo "hello world"')) throw new Error(`Terminal: ${content.slice(0, 100)}`);
  });

  await test('tool_result populates terminal output', async () => {
    await page.evaluate(() => {
      handleMessage({
        type: 'tool_result',
        id: 'test-exec-1',
        text: 'hello world',
        ts: Date.now(),
      });
    });
    const content = await page.locator('#terminalContent').textContent();
    if (!content.includes('hello world')) throw new Error(`Terminal missing output`);
  });

  await test('tool_end marks step as done', async () => {
    await page.evaluate(() => {
      handleMessage({ type: 'tool_end', id: 'test-exec-1', ts: Date.now() });
    });
    // Check the step that has test-exec-1 is marked done
    const status = await page.evaluate(() => {
      const idx = state.toolMap.get('test-exec-1');
      return state.steps[idx]?.status;
    });
    if (status !== 'done') throw new Error(`Step status: ${status}`);
  });

  // ─── Test 5: Read tool → Code tab ────────────────────────
  await test('Read tool shows in Code tab', async () => {
    await page.evaluate(() => {
      handleMessage({
        type: 'tool_start',
        tool: 'read',
        input: { file_path: '/etc/hostname' },
        id: 'test-read-1',
        description: 'Reading /etc/hostname',
        ts: Date.now(),
      });
      handleMessage({
        type: 'tool_result',
        id: 'test-read-1',
        text: 'rasputin',
        ts: Date.now(),
      });
    });
    await page.evaluate(() => document.querySelector('[data-tab="code"]').click());
    const content = await page.locator('#codeContent').textContent();
    if (!content.includes('hostname') || !content.includes('rasputin')) {
      throw new Error(`Code tab: ${content.slice(0, 100)}`);
    }
  });

  // ─── Test 6: Search tool → Browser tab ───────────────────
  await test('Web search shows in Browser tab', async () => {
    await page.evaluate(() => {
      handleMessage({
        type: 'tool_start',
        tool: 'web_search',
        input: { query: 'test query' },
        id: 'test-search-1',
        description: 'Searching: test query',
        ts: Date.now(),
      });
      handleMessage({
        type: 'tool_result',
        id: 'test-search-1',
        text: 'Result: Found 10 items',
        ts: Date.now(),
      });
    });
    await page.evaluate(() => document.querySelector('[data-tab="browser"]').click());
    const content = await page.locator('#browserContent').textContent();
    if (!content.includes('test query')) throw new Error(`Browser tab: ${content.slice(0, 100)}`);
  });

  // ─── Test 7: Token streaming → Output tab ────────────────
  console.log('\n💬 Streaming');
  await test('Token stream appears in Output tab', async () => {
    await page.evaluate(() => {
      handleMessage({ type: 'token_stream', text: 'Hello', delta: 'Hello', role: 'assistant', ts: Date.now() });
      handleMessage({ type: 'token_stream', text: 'Hello world', delta: ' world', role: 'assistant', ts: Date.now() });
    });
    await page.evaluate(() => document.querySelector('[data-tab="output"]').click());
    const content = await page.locator('#outputContent').textContent();
    if (!content.includes('Hello world')) throw new Error(`Output: ${content.slice(0, 100)}`);
  });

  await test('streaming_end finalizes', async () => {
    await page.evaluate(() => {
      handleMessage({ type: 'streaming_end', ts: Date.now() });
    });
    const action = await page.locator('#currentAction').textContent();
    if (action !== 'Idle') throw new Error(`Action: ${action}`);
  });

  // ─── Test 8: Thinking events ─────────────────────────────
  await test('Thinking creates step', async () => {
    const before = await page.evaluate(() => state.steps.length);
    await page.evaluate(() => {
      handleMessage({ type: 'thinking', text: 'Analyzing the problem...', ts: Date.now() });
    });
    const after = await page.evaluate(() => state.steps.length);
    if (after <= before) throw new Error('No thinking step added');
  });

  // ─── Test 9: Error handling ──────────────────────────────
  console.log('\n⚠️  Error Handling');
  await test('tool_error marks step as error', async () => {
    await page.evaluate(() => {
      handleMessage({
        type: 'tool_start',
        tool: 'exec',
        input: { command: 'bad_command' },
        id: 'test-error-1',
        description: 'Running: bad_command',
        ts: Date.now(),
      });
      handleMessage({
        type: 'tool_error',
        id: 'test-error-1',
        text: 'command not found',
        ts: Date.now(),
      });
    });
    const status = await page.evaluate(() => {
      const idx = state.toolMap.get('test-error-1');
      return state.steps[idx]?.status;
    });
    if (status !== 'error') throw new Error(`Error step status: ${status}`);
  });

  // ─── Test 10: Step count badge ───────────────────────────
  console.log('\n🔢 Step Count');
  await test('Step count badge matches actual steps', async () => {
    const badge = await page.locator('#stepCount').textContent();
    const actual = await page.evaluate(() => state.steps.length);
    if (parseInt(badge) !== actual) throw new Error(`Badge ${badge} != actual ${actual}`);
  });

  // ─── Summary ─────────────────────────────────────────────
  await browser.close();
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  
  if (failed > 0) {
    console.log('\n❌ TESTS FAILED');
    process.exit(1);
  } else {
    console.log('\n✅ ALL TESTS PASSED');
    process.exit(0);
  }
}

run().catch(e => {
  console.error('Fatal:', e);
  browser?.close();
  process.exit(1);
});
