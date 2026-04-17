const test = require('node:test');
const assert = require('node:assert/strict');
const { GeminiProcessManager } = require('../../extension/dist/chat/GeminiProcessManager.js');

function runManagerRequest(args, prompt = 'hello world') {
  return new Promise((resolve) => {
    const manager = new GeminiProcessManager();
    const chunks = [];
    let settled = false;

    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      manager.stopAll();
      resolve({ ...result, output: chunks.join('') });
    };

    manager.runRequest({
      requestId: 'req-' + Math.random().toString(36).slice(2),
      cliPath: process.execPath,
      args,
      timeoutMs: 5000,
      prompt,
      responseLanguage: 'en',
      contextText: '',
      onChunk: (chunk) => chunks.push(chunk),
      onDone: () => finish({ status: 'done' }),
      onCancelled: () => finish({ status: 'cancelled' }),
      onError: (message) => finish({ status: 'error', message })
    });
  });
}

test('streams stdout and completes successfully', async () => {
  const result = await runManagerRequest(['-e', "process.stdout.write('ok')"]);
  assert.equal(result.status, 'done');
  assert.equal(result.output, 'ok');
});

test('injects prompt when using {{prompt}} argument', async () => {
  const result = await runManagerRequest([
    '-e',
    "process.stdout.write(process.argv[1].includes('User prompt:') ? 'yes' : 'no')",
    '{{prompt}}'
  ]);

  assert.equal(result.status, 'done');
  assert.equal(result.output, 'yes');
});
