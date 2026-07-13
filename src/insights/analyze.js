const { logError, logInfo, DEFAULT_SOCIAL_ANALYTICS_WEIGHT } = require('../utils');
const { buildComparisonSummary, buildSocialComparisonSummary } = require('./compare');
const { formatPremierForPrompt, fetchPremierFeedback } = require('./premier');
const { cleanAnalysisOutput, FORMAT_RULES } = require('./format');

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

async function callOpenAI(systemPrompt, userPrompt) {
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
      temperature: 0.3,
    }),
  });

  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content?.trim() || null;
  return raw ? cleanAnalysisOutput(raw) : null;
}

/** Mode 1: Compare two retros by IP */
async function analyzeRetroComparison(comparison) {
  const summary = buildComparisonSummary(comparison);
  if (!comparison.has_pair) return summary;

  const prompt = `Compare two video production retros for the same IP.

${summary}

Analyze:
1. Did the team repeat mistakes from the older retro's action items in the newer retro?
2. What clearly improved?
3. What still needs work?
4. Verdict: Learning: Improving / Stagnating / Regressing

Use ### headers for each numbered section. ${FORMAT_RULES}`;

  try {
    const ai = await callOpenAI(
      'You analyze video production retro learning trends. Output plain text with ### headers only.',
      prompt,
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
async function analyzeSocialComparison(comparison) {
  const summary = buildSocialComparisonSummary(comparison);
  if (!comparison.has_comparison) return summary;

  const analyticsWeight = parseFloat(process.env.SOCIAL_ANALYTICS_WEIGHT)
    || DEFAULT_SOCIAL_ANALYTICS_WEIGHT;
  const retroWeight = 1 - analyticsWeight;

  const prompt = `Compare ${comparison.items.length} Instagram/social content retros for the same IP.

${summary}

Important context:
- Retros are filled soon after release, so analytics may be early/incomplete — weight retro written insights higher when numbers look immature.
- Scoring blend: approximately ${Math.round(retroWeight * 100)}% retro quality (good/bad/action items + metric insights) and ${Math.round(analyticsWeight * 100)}% analytics performance.

Analyze in detail:
1. Analytics comparison across all pieces (note which metrics lead/lag; flag stale-early data)
2. Retro written insights — what each piece did well and poorly
3. Action items quality and learning transfer across pieces
4. Head-to-head ranking of all pieces with evidence
5. ### Winner
   Name the winning piece, confidence (High/Medium/Low), and why — using the weighted blend above

Use ### headers for each numbered section. ${FORMAT_RULES}`;

  try {
    const ai = await callOpenAI(
      'You compare social media content retros with analytics and qualitative feedback. Declare one clear winner. Output plain text with ### headers only.',
      prompt,
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
