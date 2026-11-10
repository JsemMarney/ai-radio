/**
 * Upozornění na Discord (DISCORD_WEBHOOK_URL v .env.local). Bez URL se nic neposílá.
 * Každý druh upozornění nejvýš jednou za ALERT_COOLDOWN_MIN (výchozí 30 min), ať to nespamuje.
 */

const lastSent = new Map<string, number>();

function cooldownMs(): number {
  const n = Number(process.env.ALERT_COOLDOWN_MIN ?? 30);
  return (Number.isFinite(n) && n > 0 ? n : 30) * 60_000;
}

export async function sendAlert(key: string, message: string): Promise<void> {
  // Lokální vývoj (.claude/dev-open.cjs) nesmí posílat upozornění na ostrý Discord.
  if (process.env.RADIO_NO_ALERTS === "1") return;
  const url = process.env.DISCORD_WEBHOOK_URL?.trim();
  if (!url || !/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(url)) return;
  const now = Date.now();
  if (now - (lastSent.get(key) ?? 0) < cooldownMs()) return;
  lastSent.set(key, now);
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: `📻 **Miss Radio** — ${message}`.slice(0, 1900), allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // Discord nedostupný — nevadí
  }
}
