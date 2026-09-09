'use strict';
const assert = require('assert');
const { clean, isAIAttribution } = require('../tools/commit-attribution.js');
const human = 'Co-Authored-By: Claude Duhamel <claude@example.com>';
const message = 'A human-authored change\n\nMentions Claude in the explanation.\n\n' + human + '\n';
assert.strictEqual(clean(message), message);
for (const name of ['Claude Fable 5', 'Claude Opus 5 (1M context)', 'Claude Opus 5']) {
  const trailer = 'Co-Authored-By: ' + name + ' <noreply@anthropic.com>';
  assert(isAIAttribution(trailer));
  assert.strictEqual(clean(message + trailer + '\n'), message);
}
assert.strictEqual(clean(message + 'Claude-Session: https://claude.ai/code/session_test\n'), message);
assert(isAIAttribution('Co-Authored-By: GitHub Copilot <copilot@github.com>'));
assert(isAIAttribution('Co-Authored-By: Codex <agent@example.com>'));
assert(!isAIAttribution('Discuss Co-Authored-By: Codex in a test.'));
assert.strictEqual(clean('Subject\n\nBody with trailing blanks\n\n'), 'Subject\n\nBody with trailing blanks\n\n');
console.log('PASS: AI trailers removed; human credits and unrelated text preserved.');
