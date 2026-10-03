/** Server-only AI configuration. Never import from client components. */
export function aiConfig() {
  const hasKey = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  const model = process.env.ANTHROPIC_MODEL?.trim() || 'claude-opus-5-5';
  const effortRaw = (process.env.LD_AI_EFFORT || 'low').trim();
  const effort = (['low', 'medium', 'high'].includes(effortRaw) ? effortRaw : 'low') as 'low' | 'medium' | 'high';
  // Server-side refusal fallback (`fallbacks: "default"`) is supported on these models.
  const fallbackCapable = ['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5'].includes(model);
  return { hasKey, model, effort, fallbackCapable };
}
