const test = require('node:test');
const assert = require('node:assert/strict');
const { SlashCommandRouter } = require('../../extension/dist/chat/SlashCommandRouter.js');
const { GeminiProcessManager } = require('../../extension/dist/chat/GeminiProcessManager.js');

test('custom slash workflow is transformed and consumable by process manager', async () => {
  const router = new SlashCommandRouter();
  router.setCustomCommands({
    ship: {
      hint: 'Create a practical release checklist with rollback steps.',
      category: 'generation',
      mode: 'plan'
    }
  });

  const route = router.parse('/ship production fix');
  assert.equal(route.valid, true);
  assert.equal(route.commandMeta?.name, 'ship');

  const manager = new GeminiProcessManager();
  const chunkPromise = new Promise((resolve, reject) => {
    manager.runRequest({
      requestId: 'integration-' + Date.now(),
      cliPath: process.execPath,
      args: ['-e', "process.stdout.write(process.argv[1].includes('Command: /ship') ? 'matched' : 'miss')", '{{prompt}}'],
      timeoutMs: 5000,
      prompt: route.transformedPrompt,
      responseLanguage: 'en',
      contextText: '',
      onChunk: (chunk) => resolve(chunk),
      onDone: () => {},
      onCancelled: () => reject(new Error('request was cancelled')),
      onError: (message) => reject(new Error(message))
    });
  });

  const chunk = await chunkPromise;
  assert.equal(chunk, 'matched');
});
