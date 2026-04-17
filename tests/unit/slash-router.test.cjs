const test = require('node:test');
const assert = require('node:assert/strict');
const { SlashCommandRouter } = require('../../extension/dist/chat/SlashCommandRouter.js');

test('parses built-in slash command metadata', () => {
  const router = new SlashCommandRouter();
  const route = router.parse('/fix tighten null checks');

  assert.equal(route.valid, true);
  assert.equal(route.command, 'fix');
  assert.equal(route.commandMeta?.mode, 'edit');
  assert.match(route.transformedPrompt, /Instruction:/);
});

test('loads custom slash workflows from registry', () => {
  const router = new SlashCommandRouter();
  router.setCustomCommands({
    refactor: {
      hint: 'Create a step-by-step safe refactor plan.',
      category: 'editing',
      mode: 'plan'
    }
  });

  const route = router.parse('/refactor split service layer');
  assert.equal(route.valid, true);
  assert.equal(route.commandMeta?.name, 'refactor');
  assert.equal(route.commandMeta?.mode, 'plan');
  assert.deepEqual(route.matchedArgs, ['split', 'service', 'layer']);
});
