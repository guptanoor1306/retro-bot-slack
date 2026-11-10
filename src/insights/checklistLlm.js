const { logError, logInfo } = require('../utils');

function getOpenAiKey() {
  return process.env.OPENAI_API_KEY?.trim() || '';
}

function checklistMatchMode() {
  const mode = (process.env.CHECKLIST_MATCH_MODE || 'llm').toLowerCase();
  if (mode === 'keyword') return 'keyword';
  return getOpenAiKey() ? 'llm' : 'keyword';
}

function catalogForPrompt(definition) {
  const mapItems = (items = []) => items.map((item) => ({
    id: item.id,
    label: item.label,
    description: item.description || item.label,
    example_signals: item.signals || item.keywords || [],
  }));
  return {
    checks: mapItems(definition.checks),
    antiChecks: mapItems(definition.antiChecks),
  };
}

function normalizeHits(rawHits, definitionItems) {
  const byId = new Map((definitionItems || []).map((i) => [i.id, i]));
  const hits = [];
  for (const hit of rawHits || []) {
    const id = hit?.id;
    if (!id || !byId.has(id)) continue;
    const confidence = String(hit.confidence || '').toLowerCase();
    if (confidence !== 'high' && confidence !== 'medium') continue;
    const item = byId.get(id);
    hits.push({
      id,
      label: item.label,
      confidence,
      evidence: String(hit.evidence || '').trim().slice(0, 240),
    });
  }
  return hits;
}

async function classifyRetroAgainstChecklist({
  videoName = '',
  ipName = '',
  retroText = '',
  definition,
}) {
  if (!retroText?.trim() || !definition) {
    return { checks: [], antiChecks: [], matcher: 'none' };
  }

  if (checklistMatchMode() !== 'llm') {
    return null;
  }

  const catalog = catalogForPrompt(definition);
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  const userPrompt = `You map completed video retros to a fixed Reels/Shorts checklist.

Video: ${videoName || 'n/a'}
IP: ${ipName || 'n/a'}

Checklist catalog (JSON):
${JSON.stringify(catalog, null, 2)}

Retro text (Good / Bad / Action items from the team):
---
${retroText.slice(0, 12000)}
---

Rules:
- Match only when the retro clearly supports the item (paraphrases and Hinglish OK).
- Do NOT guess. Skip items with weak support.
- "checks" = positive things the team says went well and align with the Do list.
- "antiChecks" = problems / failures that align with the Anti list.
- evidence must be a short quote or tight paraphrase from the retro text.

Return JSON only:
{
  "checks": [{"id": "...", "confidence": "high|medium", "evidence": "..."}],
  "antiChecks": [{"id": "...", "confidence": "high|medium", "evidence": "..."}]
}`;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${getOpenAiKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'You classify retro text against a checklist. Output valid JSON only.',
          },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) return { checks: [], antiChecks: [], matcher: 'llm' };

    const parsed = JSON.parse(raw);
    const checks = normalizeHits(parsed.checks, definition.checks);
    const antiChecks = normalizeHits(parsed.antiChecks, definition.antiChecks);
    logInfo('Checklist LLM classified retro', {
      video: videoName,
      checks: checks.length,
      anti: antiChecks.length,
    });
    return { checks, antiChecks, matcher: 'llm' };
  } catch (error) {
    logError('classifyRetroAgainstChecklist', error);
    return null;
  }
}

module.exports = {
  checklistMatchMode,
  classifyRetroAgainstChecklist,
};
