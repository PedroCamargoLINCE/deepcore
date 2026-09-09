'use strict';

// Repo policy: remove machine credits, never human coauthors or prose that
// merely mentions an assistant. Shared by the commit guard and history audit.
const aiCredit = /^Co-Authored-By:\s*(?:.*<(?:noreply@anthropic\.com|noreply@openai\.com|copilot@github\.com)>|(?:Claude (?:Fable|Opus|Sonnet|Haiku|Code)\b|ChatGPT\b|OpenAI Codex\b|Codex\b|GitHub Copilot\b|Cursor Agent\b|Devin\b).*)\s*$/i;
const aiSession = /^Claude-Session:\s*https:\/\/claude\.ai\/code\/session_\S+\s*$/i;
function isAIAttribution(line) { return aiCredit.test(line) || aiSession.test(line); }
function clean(message) {
  const lines = message.split('\n');
  if (!lines.some(isAIAttribution)) return message;
  return lines.filter(line => !isAIAttribution(line)).join('\n').replace(/\n+$/, '\n');
}
module.exports = { isAIAttribution, clean };

