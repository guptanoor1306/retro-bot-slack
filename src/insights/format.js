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

module.exports = {
  cleanAnalysisOutput,
  FORMAT_RULES,
};
