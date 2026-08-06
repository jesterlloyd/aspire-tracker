// KEITH-P0: the single place a skill call reaches Anthropic.
//
// Deliberately separate from the tool loop in api/keith.js: a skill call is a
// ONE-SHOT, TOOL-FREE completion. No tools are offered, so there is no path for
// resume text to trigger a database read - which is the structural half of the
// prompt-injection defense. The instructional half (treat the document as data)
// lives in the skill's own instructions.
//
// Model, temperature and max_tokens come from modelRouting.resolveRoute() and
// never from a request body.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

/**
 * One tool-free completion.
 * Returns { ok:true, text, usage, model } or { ok:false, reason, status }.
 */
export async function completeWithoutTools({ route, system, messages, timeoutMs = 18000 }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, reason: 'missing_api_key', status: 500 };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: route.model,
        max_tokens: route.maxTokens,
        temperature: route.temperature,
        system,
        messages,
        // No `tools` key at all: the model cannot call anything during a skill run.
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const status = response.status;
      return { ok: false, reason: status === 429 ? 'upstream_rate_limited' : 'upstream_error', status };
    }
    const data = await response.json();
    const text = (data?.content || [])
      .filter(b => b?.type === 'text')
      .map(b => b.text)
      .join('')
      .trim();
    if (!text) return { ok: false, reason: 'empty_completion', status: 502 };
    return {
      ok: true,
      text,
      model: data?.model || route.model,
      usage: {
        inputTokens: Number(data?.usage?.input_tokens || 0),
        outputTokens: Number(data?.usage?.output_tokens || 0),
      },
    };
  } catch (err) {
    return { ok: false, reason: err?.name === 'AbortError' ? 'timeout' : 'network_error', status: 504 };
  } finally {
    clearTimeout(timer);
  }
}
