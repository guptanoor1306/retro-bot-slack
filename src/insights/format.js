/** Clean AI output for Slack — no asterisks or dash bullets. */
function cleanAnalysisOutput(text) {
  if (!text) return text;
  return text
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/^[ \t]*[-•]\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const FORMAT_RULES = `Formatting rules (STRICT — follow exactly):
- Use ### for each section header (e.g. ### 1. Did the team repeat mistakes...)
- Do NOT use asterisks (*) anywhere
- Do NOT use dash bullets (-) or bullet characters anywhere
- Plain text only. Use short sentences separated by newlines.
- Be concise and actionable`;

const RETRO_LEARNING_FORMAT_RULES = `Output rules (STRICT):
- Output EXACTLY 3 sections with these headers, in this order:
  ### Any repeated mistakes?
  ### Any improvements needed?
  ### Overall verdict
- Do NOT add other sections or preamble.
- Do NOT use asterisks (*) or dash bullets (-).
- Each point: one short line (max ~20 words). Quote the team's wording when possible.
- No filler, no generic production advice, no restating the whole retro.
- If nothing applies in a section, write exactly: None identified.`;

const SOCIAL_COMPARE_FORMAT_RULES = `Output rules (STRICT):
- Output EXACTLY 4 sections with these headers, in this order:
  ### Analytics highlights
  ### Any repeated mistakes?
  ### Any improvements needed?
  ### Winner
- Do NOT add other sections or preamble.
- Do NOT use asterisks (*) or dash bullets (-).
- Each point: one short line (max ~20 words). Include numbers for analytics when citing them.
- No filler, no piece-by-piece recap, no generic social media advice.
- If nothing applies in a section, write exactly: None identified.
- Winner section format:
  Line 1: <piece title> | Confidence: High / Medium / Low
  Line 2–3 max: why (blend retro insights + analytics evidence)`;

module.exports = {
  cleanAnalysisOutput,
  FORMAT_RULES,
  RETRO_LEARNING_FORMAT_RULES,
  SOCIAL_COMPARE_FORMAT_RULES,
};
