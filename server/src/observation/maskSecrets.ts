/**
 * Best-effort redaction of credentials in short human-readable strings
 * (tool status lines such as `Running: curl -H "Authorization: Bearer …"`)
 * before they leave the server for the browser or the history log.
 *
 * This is a safety net, not a guarantee: it targets the common shapes of
 * secrets that show up in shell commands.
 */

const MASK = '••••';

const PATTERNS: Array<[RegExp, string]> = [
  // Authorization headers / bearer tokens
  [/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${MASK}`],
  // Well-known token prefixes (OpenAI/Anthropic, GitHub, Slack, AWS, Google, npm, Stripe)
  [/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{10,}/g, MASK],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, MASK],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, MASK],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, MASK],
  [/\bAKIA[0-9A-Z]{16}\b/g, MASK],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, MASK],
  [/\bnpm_[A-Za-z0-9]{30,}/g, MASK],
  [/\b[rs]k_(?:live|test)_[A-Za-z0-9]{10,}/g, MASK],
  // key=value / key: value for secret-looking names (env assignments, flags, query params)
  [
    /\b([A-Za-z0-9_-]*(?:api[_-]?key|secret|token|passw(?:or)?d|pwd|auth)[A-Za-z0-9_-]*)(\s*[=:]\s*|\s+)("[^"]*"|'[^']*'|[^\s&"']+)/gi,
    `$1$2${MASK}`,
  ],
  // URL credentials: scheme://user:pass@host
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+):[^\s/@]+@/gi, `$1:${MASK}@`],
];

export function maskSecrets(text: string): string {
  let out = text;
  for (const [re, replacement] of PATTERNS) {
    out = out.replace(re, replacement);
  }
  return out;
}
