export function nowIso(): string {
  return new Date().toISOString();
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function splitTelegramMessage(text: string, max = 3800): string[] {
  if (text.length <= max) return [text];

  const parts: string[] = [];
  let remaining = text;

  while (remaining.length > max) {
    const slice = remaining.slice(0, max);
    const lastBreak = Math.max(slice.lastIndexOf("\n\n"), slice.lastIndexOf("\n"));
    const splitAt = lastBreak > 500 ? lastBreak : max;

    parts.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining.length > 0) {
    parts.push(remaining);
  }

  return parts;
}

export function normalizeSingleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function randomToken(length = 14): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let token = "";

  for (let i = 0; i < length; i += 1) {
    token += alphabet[Math.floor(Math.random() * alphabet.length)] ?? "X";
  }

  return token;
}
