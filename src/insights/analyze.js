const { logError, logInfo, DEFAULT_SOCIAL_ANALYTICS_WEIGHT } = require('../utils');
const { buildComparisonSummary, buildSocialComparisonSummary } = require('./compare');
const { formatPremierForPrompt, fetchPremierFeedback } = require('./premier');
const { cleanAnalysisOutput, FORMAT_RULES, RETRO_LEARNING_FORMAT_RULES, SOCIAL_COMPARE_FORMAT_RULES } = require('./format');
const { formatChecklistReportForPrompt } = require('./checklist');

function getOpenAiKey() {
  const key = process.env.OPENAI_API_KEY?.trim();
  return key || null;
}

function aiFallbackNote(error) {
  const key = getOpenAiKey();
  if (!key) {
    return 'No OPENAI_API_KEY in .env — structured comparison only.';
  }
  if (error) {
    return `AI analysis failed: ${error.message}`;
  }
  return 'AI returned empty response — structured comparison shown above.';
}

async function callOpenAI(systemPrompt, userPrompt, { temperature = 0.3 } = {}) {
  const apiKey = getOpenAiKey();
  if (!apiKey) return null;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature,
    }),
  });

  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content?.trim() || null;
  return raw ? cleanAnalysisOutput(raw) : null;
}

/** Mode 1: Compare two retros by IP */
async function analyzeRetroComparison(comparison, { checklist_report: checklistReport } = {}) {
  const summary = buildComparisonSummary(comparison);
  if (!comparison.has_pair) return summary;

  const checklistBlock = checklistReport?.repeated_anti?.length
    ? `${formatChecklistReportForPrompt(checklistReport)}\n`
    : '';

  const prompt = `Compare two video production retros for the same IP. Use ONLY the text below as evidence.

${summary}

${checklistBlock}Checklist hints are keyword matches on retro text — use only when they clearly align with retro wording. Do not treat checklist alone as proof of repetition.


Evidence rules (critical — do not violate):
- "Repeated mistake" = an issue in the NEWER retro's Bad (or failed execution implied in Good/Bad) that clearly matches an action item or Bad from the OLDER retro. Same theme, not just a vague similarity.
- If an issue appears ONLY in the newer retro, it is NOT repeated — put it under improvements needed.
- Do NOT assume something happened before unless the older retro explicitly mentions it.
- Preserve the team's meaning. Do not rewrite into generic jargon or change intent (submissions may be informal or Hindi-influenced English).
- Skip points with no direct evidence. Do not pad.

Write exactly 3 sections:

### Any repeated mistakes?
Issues from the newer retro that clearly recur from the older retro. One line each.

### Any improvements needed?
Issues to fix from the newer retro (including first-time issues). One line each.

### Overall verdict
Line 1: Learning: Improving / Stagnating / Regressing
Line 2–3 max: brief evidence only.

${RETRO_LEARNING_FORMAT_RULES}`;

  try {
    const ai = await callOpenAI(
      'You write sharp, evidence-based IP learning summaries from retro text. Never invent repeated mistakes. Output only the 3 required sections.',
      prompt,
      { temperature: 0.2 },
    );
    if (ai) {
      logInfo('AI retro comparison generated');
      return ai;
    }
    return `${summary}\n\n${aiFallbackNote()}`;
  } catch (error) {
    logError('analyzeRetroComparison', error);
    return `${summary}\n\n${aiFallbackNote(error)}`;
  }
}

/** Mode 2: Two retros + two Premier sessions */
async function analyzeCombined({ retroIds, premierSessionIds }) {
  const { compareTwoRetros } = require('./compare');
  const { getRetroById } = require('../sheets');

  if (retroIds.length !== 2) throw new Error('Select exactly 2 retros');
  if (premierSessionIds.length !== 2) throw new Error('Select exactly 2 Premier sessions');

  const [retroA, retroB] = await Promise.all(retroIds.map((id) => getRetroById(id)));
  if (!retroA || !retroB) throw new Error('Retro not found');

  const sorted = [retroA, retroB].sort(
    (a, b) => (a.completed_at || a.release_date).localeCompare(b.completed_at || b.release_date),
  );
  const comparison = await compareTwoRetros(sorted[0].retro_id, sorted[1].retro_id);
  const retroSummary = buildComparisonSummary(comparison);
  const premierData = await fetchPremierFeedback({ sessionIds: premierSessionIds });
  const premierText = formatPremierForPrompt(premierData);

  const prompt = `Evaluate whether a video IP team implemented learnings across two release cycles.

RETRO COMPARISON (older → newer):
${retroSummary}

PREMIER FEEDBACK (two sessions — first listed is older session, second is newer):
${premierText}

Analyze:
1. Were older retro action items addressed in the newer retro?
2. Does newer Premier feedback show fewer repeated issues vs older Premier?
3. Where retro self-assessment and Premier feedback align or conflict
4. Verdict: Learning implemented: Yes / Partial / No — with evidence

Use ### headers for each numbered section. ${FORMAT_RULES}`;

  try {
    const ai = await callOpenAI(
      'You cross-reference production retros with Premier reviewer feedback. Output plain text with ### headers only.',
      prompt,
    );
    if (ai) {
      logInfo('AI combined analysis generated');
      return {
        analysis: ai,
        comparison,
        premierData,
        publish_retro_id: sorted[1].retro_id,
      };
    }
  } catch (error) {
    logError('analyzeCombined', error);
    return {
      analysis: `${retroSummary}\n\nPremier feedback:\n${premierText}\n\n${aiFallbackNote(error)}`,
      comparison,
      premierData,
      publish_retro_id: sorted[1].retro_id,
    };
  }

  return {
    analysis: `${retroSummary}\n\nPremier feedback:\n${premierText}\n\n${aiFallbackNote()}`,
    comparison,
    premierData,
    publish_retro_id: sorted[1].retro_id,
  };
}

/** Mode 3: Compare two Premier sessions only */
async function analyzePremierComparison(premierSessionIds) {
  if (premierSessionIds.length !== 2) throw new Error('Select exactly 2 Premier sessions');

  const premierData = await fetchPremierFeedback({ sessionIds: premierSessionIds });
  const [sessionA, sessionB] = premierData.sessions || [];

  const formatSession = (s, label) => {
    if (!s?.markers?.length) return `${label}: no feedback`;
    const lines = s.markers.map(
      (m) => `@${m.timestamp}s [${m.type}] ${m.feedback}${m.aiTags?.length ? ` (${m.aiTags.join(', ')})` : ''}`,
    );
    return `${label} (${s.sessionId}):\n${lines.join('\n')}`;
  };

  const premierText = [
    formatSession(sessionA, 'Premier session A (older)'),
    '',
    formatSession(sessionB, 'Premier session B (newer)'),
  ].join('\n');

  const prompt = `Compare Premier reviewer feedback across two video sessions.

${premierText}

Analyze:
1. Recurring issues in both sessions
2. Issues fixed in the newer session
3. New issues in the newer session
4. Verdict: Premier trend: Improving / Stagnating / Regressing

Use ### headers for each numbered section. ${FORMAT_RULES}`;

  try {
    const ai = await callOpenAI(
      'You compare qualitative Premier video review feedback. Output plain text with ### headers only.',
      prompt,
    );
    if (ai) {
      logInfo('AI premier comparison generated');
      return { analysis: ai, premierData };
    }
  } catch (error) {
    logError('analyzePremierComparison', error);
    return {
      analysis: `${premierText}\n\n${aiFallbackNote(error)}`,
      premierData,
    };
  }

  return {
    analysis: `${premierText}\n\n${aiFallbackNote()}`,
    premierData,
  };
}

/** Social: compare 2–4 retros with weighted analytics + retro blend */
async function analyzeSocialComparison(comparison, { checklist_report: checklistReport } = {}) {
  const summary = buildSocialComparisonSummary(comparison);
  if (!comparison.has_comparison) return summary;

  const analyticsWeight = parseFloat(process.env.SOCIAL_ANALYTICS_WEIGHT)
    || DEFAULT_SOCIAL_ANALYTICS_WEIGHT;
  const retroWeight = 1 - analyticsWeight;

  const checklistBlock = checklistReport?.repeated_anti?.length
    ? `${formatChecklistReportForPrompt(checklistReport)}\n`
    : '';

  const prompt = `Compare ${comparison.items.length} social content retros for the same IP. Use ONLY the text below as evidence.

${summary}

${checklistBlock}Checklist hints are keyword matches — confirm with retro text before calling something repeated.


Context:
- Retros are filled soon after release — analytics may be early; weight retro written insights when numbers look immature.
- Pieces may use different metric sets; only compare metrics that appear in 2+ pieces.
- Scoring blend for Winner: ~${Math.round(retroWeight * 100)}% retro quality, ~${Math.round(analyticsWeight * 100)}% analytics.

Evidence rules (critical):
- Analytics highlights: only call out clear leaders/laggers on shared metrics. Cite the number. Max 5 lines.
- Repeated mistake = same theme in Bad or action items of 2+ pieces. Do NOT mark first-time issues as repeated.
- Do NOT infer patterns not stated in the retro text.
- Preserve the team's meaning — submissions may be informal or Hindi-influenced English.
- Skip points with no direct evidence.

Write exactly 4 sections:

### Analytics highlights
Shared metrics only. One line per standout with numbers.

### Any repeated mistakes?
Themes that recur across 2+ pieces. One line each.

### Any improvements needed?
Fixes from retro text (first-time or recurring). One line each.

### Winner
Best piece overall using the blend above.

${SOCIAL_COMPARE_FORMAT_RULES}`;

  try {
    const ai = await callOpenAI(
      'You write sharp social retro comparisons using metrics and retro text. Never invent repeated mistakes. Output only the 4 required sections.',
      prompt,
      { temperature: 0.2 },
    );
    if (ai) {
      logInfo('AI social comparison generated');
      return ai;
    }
    return `${summary}\n\n${aiFallbackNote()}`;
  } catch (error) {
    logError('analyzeSocialComparison', error);
    return `${summary}\n\n${aiFallbackNote(error)}`;
  }
}

/** Legacy */
async function analyzeLearning({ comparison, premierData }) {
  return analyzeRetroComparison(comparison);
}

module.exports = {
  analyzeRetroComparison,
  analyzeCombined,
  analyzePremierComparison,
  analyzeSocialComparison,
  analyzeLearning,
};
