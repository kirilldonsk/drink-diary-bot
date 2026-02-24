import { escapeHtml } from "../lib/format.js";
import type { Drink, JournalEntry, ShareLink } from "../types.js";
import type { ExtractedRecipeFacts } from "./llm.js";

interface IngredientItem {
  key: string;
  name: string;
  amount: string;
  rank: number;
  order: number;
}

interface AutoData {
  improvedText: string;
  ingredients: Array<{ name: string; amount: string }>;
  fermentationStart: string | null;
  bottleVolume: string | null;
  bottleAbv: string | null;
  batchNumber: string | null;
}

const MAX_IMPROVED_TEXT_LENGTH = 2600;

export function renderNotFoundPage(): string {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Страница не найдена</title>
  <style>
    body { font-family: "IBM Plex Sans", "Segoe UI", sans-serif; padding: 24px; background: #eef4fb; color: #1f2e3e; }
    .card { max-width: 760px; margin: 40px auto; background: #fff; border: 1px solid #d8e4f2; border-radius: 18px; padding: 28px; box-shadow: 0 12px 28px rgba(13, 44, 74, .08); }
  </style>
</head>
<body>
  <div class="card">
    <h1>QR-ссылка не найдена</h1>
    <p>Возможно, ссылка устарела или была удалена.</p>
  </div>
</body>
</html>`;
}

export function renderSharePage(input: {
  drink: Drink;
  shareLink: ShareLink;
  entries: JournalEntry[];
  gptFacts?: ExtractedRecipeFacts | null;
}): string {
  const { drink, shareLink, entries, gptFacts } = input;
  const autoData = buildAutoData(entries, shareLink.createdAt, gptFacts ?? null);
  const title = shareLink.type === "gift" ? `Подарочная бутылка ${drink.name}` : `Дневник напитка ${drink.name}`;

  const ingredientRows = autoData.ingredients
    .map((item) => `<div class="meta-item">${escapeHtml(item.name)}: ${escapeHtml(item.amount)}</div>`)
    .join("\n");

  const ingredientFallback =
    autoData.ingredients.length === 0
      ? '<div class="meta-item">Ингредиенты не определены автоматически</div>'
      : "";

  const fermentStartValue = autoData.fermentationStart ?? "Не указано";
  const volumeValue = autoData.bottleVolume ?? "Не указано";
  const abvValue = autoData.bottleAbv ?? "Не указано";

  const giftBlock =
    shareLink.type === "gift"
      ? `
    <section class="card gift" style="--delay: 120ms">
      <div class="gift-grid">
        <div class="gift-item"><strong>Получатель:</strong><br />${escapeHtml(shareLink.giftRecipient ?? "Не указан")}</div>
        <div class="gift-item"><strong>Номер бутылки:</strong><br />${escapeHtml(shareLink.bottleCode ?? "Не указан")}</div>
        <div class="gift-item"><strong>Номер партии:</strong><br />${escapeHtml(autoData.batchNumber ?? "Не указан")}</div>
        ${shareLink.giftMessage ? `<div class="gift-item"><strong>Сообщение:</strong><br />${escapeHtml(shareLink.giftMessage)}</div>` : ""}
      </div>
    </section>
      `
      : "";

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      --bg0: #f7fbff;
      --bg1: #eef4fb;
      --bg2: #e6eef8;
      --card: #fcfeff;
      --ink: #10243a;
      --line: #d5e3f2;
      --shadow: 0 18px 36px rgba(17, 45, 74, 0.09);
      --radius: 22px;
      --ease: cubic-bezier(.22, .61, .36, 1);
    }

    * { box-sizing: border-box; }

    html, body {
      margin: 0;
      min-height: 100dvh;
      font-family: "IBM Plex Sans", "Avenir Next", "Segoe UI", sans-serif;
      color: var(--ink);
      background-color: var(--bg1);
      background:
        radial-gradient(circle at 8% 8%, #ffffff 0%, rgba(255,255,255,0) 44%),
        radial-gradient(circle at 92% 14%, #e8f2ff 0%, rgba(232,242,255,0) 44%),
        linear-gradient(180deg, var(--bg0) 0%, var(--bg1) 44%, var(--bg2) 100%);
      background-repeat: no-repeat, no-repeat, no-repeat;
      background-size: 140% 62%, 140% 62%, 100% 100%;
      overflow-x: hidden;
    }

    .page {
      width: min(1240px, calc(100% - 36px));
      margin: 24px auto 40px;
      display: grid;
      grid-template-columns: repeat(12, minmax(0, 1fr));
      gap: 12px;
      position: relative;
      z-index: 1;
    }

    .card {
      position: relative;
      overflow: hidden;
      border-radius: var(--radius);
      border: 1px solid var(--line);
      background: color-mix(in oklab, var(--card), white 30%);
      box-shadow: var(--shadow);
      padding: 20px;
      opacity: 0;
      transform: translateY(20px) scale(.985);
      animation: rise 760ms var(--ease) forwards;
      animation-delay: var(--delay, 0ms);
    }

    @keyframes rise { to { opacity: 1; transform: translateY(0) scale(1); } }

    h1 { margin: 0; }

    .hero {
      grid-column: span 7;
      min-height: 280px;
      display: grid;
      align-content: space-between;
      background: linear-gradient(125deg, #ffffff 0%, #f0f7ff 100%);
    }

    .title {
      margin-top: 12px;
      font-size: clamp(36px, 4.8vw, 64px);
      line-height: .92;
      letter-spacing: -0.03em;
    }

    .improved-text {
      margin-top: 12px;
      border-radius: 14px;
      border: 1px dashed #c8daee;
      background: #ffffff;
      padding: 14px;
      font-size: 14px;
      color: #1a3550;
      line-height: 1.5;
      white-space: pre-wrap;
    }

    .meta {
      margin-top: 16px;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }

    .meta-item {
      background: #fff;
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 9px 10px;
      font: 500 12px/1.25 "IBM Plex Mono", ui-monospace, monospace;
      color: #26445f;
    }

    .signature {
      grid-column: span 5;
      min-height: 280px;
      display: grid;
      align-content: space-between;
      gap: 14px;
      background: linear-gradient(165deg, #f8fcff 0%, #f0f7ff 52%, #f8f6ff 100%);
    }

    .signature-box {
      min-height: 124px;
      border-radius: 16px;
      border: 1px solid #cfe0f1;
      background: #ffffff;
      display: grid;
      place-items: center;
      padding: 16px;
    }

    .signature-svg { width: min(100%, 300px); height: auto; }
    .signature-fallback[hidden] { display: none; }

    .gift {
      grid-column: span 12;
      min-height: 120px;
      background: linear-gradient(165deg, #f7fcff 0%, #edf5ff 100%);
    }

    .gift-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
    }

    .gift-item {
      border: 1px solid var(--line);
      border-radius: 12px;
      background: #fff;
      padding: 10px;
      font-size: 13px;
      color: #31506f;
      line-height: 1.35;
    }

    .parallax {
      transform: translate3d(var(--mx, 0), var(--my, 0), 0);
      transition: transform 300ms var(--ease);
    }

    @media (max-width: 1024px) {
      .hero, .signature, .gift { grid-column: span 12; }
      .gift-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }

    @media (max-width: 640px) {
      .page { width: calc(100% - 18px); margin-top: 14px; gap: 10px; }
      .card { border-radius: 16px; padding: 16px; }
      .meta { grid-template-columns: 1fr; }
      .title { font-size: clamp(32px, 12vw, 46px); }
      .gift-grid { grid-template-columns: 1fr; }
    }

    @media (prefers-reduced-motion: reduce) {
      .card, .parallax {
        animation: none !important;
        transition: none !important;
        transform: none !important;
      }
    }
  </style>
</head>
<body>
  <main class="page">
    <section class="card hero parallax" style="--delay: 20ms">
      <div>
        <h1 class="title">${escapeHtml(drink.name)}</h1>
        <div class="improved-text">${escapeHtml(autoData.improvedText)}</div>
      </div>
      <div class="meta">
        ${ingredientRows}
        ${ingredientFallback}
      </div>
    </section>

    <aside class="card signature parallax" style="--delay: 80ms">
      <div class="meta" style="margin-top:12px;">
        <div class="meta-item">Старт брожения: ${escapeHtml(fermentStartValue)}</div>
        <div class="meta-item">Объем бутылки: ${escapeHtml(volumeValue)}</div>
        <div class="meta-item">Крепость: ${escapeHtml(abvValue)}</div>
      </div>
      <div class="signature-box">
        <img class="signature-svg" src="/signature.svg" alt="Подпись" onerror="window.showSignatureFallback?.()" />
        <svg id="signatureFallback" class="signature-svg signature-fallback" viewBox="0 0 500 140" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Signature placeholder" hidden>
          <path d="M20 92C44 31 61 123 80 92C98 60 98 65 114 96C122 113 124 64 144 55C159 48 166 95 184 98C202 101 207 69 224 57C250 39 259 117 284 95C305 76 315 51 333 59C355 69 364 109 390 94C416 79 429 55 470 45" stroke="#2E5E87" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
    </aside>

    ${giftBlock}
  </main>

  <script>
    const cards = Array.from(document.querySelectorAll('.parallax'));
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    window.showSignatureFallback = () => {
      const fallback = document.getElementById('signatureFallback');
      if (fallback) fallback.hidden = false;
    };

    if (!reduce) {
      window.addEventListener('pointermove', (e) => {
        const x = (e.clientX / window.innerWidth - 0.5) * 10;
        const y = (e.clientY / window.innerHeight - 0.5) * 8;
        cards.forEach((el, i) => {
          const factor = (i + 1) * 0.24;
          el.style.setProperty('--mx', ((-x * factor).toFixed(2)) + 'px');
          el.style.setProperty('--my', ((-y * factor).toFixed(2)) + 'px');
        });
      }, { passive: true });
    }
  </script>
</body>
</html>`;
}

function buildAutoData(entries: JournalEntry[], fallbackDateIso: string, gptFacts: ExtractedRecipeFacts | null): AutoData {
  const orderedEntries = [...entries].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const sourceTexts = orderedEntries.map((entry) => normalizePlainText(entry.polishedText ?? entry.rawText)).filter(Boolean);

  const fullSourceText = sourceTexts.join("\n\n");
  const fallbackIngredients = extractIngredients(fullSourceText);
  const gptIngredients = sanitizeGptIngredients(gptFacts?.ingredients ?? []);

  const ingredients = gptIngredients.length > 0 ? gptIngredients : fallbackIngredients;
  const fermentationStart = extractFermentationStart(fullSourceText);
  const bottleVolume = extractBottleVolume(fullSourceText);
  const bottleAbv = extractBottleAbv(fullSourceText);
  const batchNumber = extractBatchNumber(fullSourceText) ?? buildFallbackBatchNumber(fallbackDateIso);
  const improvedText = buildImprovedText(orderedEntries);

  return {
    improvedText,
    ingredients,
    fermentationStart,
    bottleVolume,
    bottleAbv,
    batchNumber
  };
}

function sanitizeGptIngredients(list: Array<{ name: string; amount: string }>): Array<{ name: string; amount: string }> {
  const result: Array<{ name: string; amount: string }> = [];
  const seen = new Set<string>();

  for (const item of list) {
    const name = item.name.trim();
    const amount = item.amount.trim();
    if (!name || !amount) {
      continue;
    }

    const key = `${name.toLowerCase()}|${amount.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push({ name, amount });
  }

  return result.slice(0, 8);
}

function buildImprovedText(entries: JournalEntry[]): string {
  if (entries.length === 0) {
    return "Записей пока нет.";
  }

  const pieces: string[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const base = normalizePlainText(entry.polishedText ?? entry.rawText);
    if (!base) {
      continue;
    }

    const withDate = `${formatIsoDate(entry.entryDate)}: ${base}`;
    if (!seen.has(withDate)) {
      seen.add(withDate);
      pieces.push(withDate);
    }
  }

  const merged = pieces.join("\n\n").trim();
  if (!merged) {
    return "Записей пока нет.";
  }

  if (merged.length <= MAX_IMPROVED_TEXT_LENGTH) {
    return merged;
  }

  return `${merged.slice(0, MAX_IMPROVED_TEXT_LENGTH - 3)}...`;
}

function extractIngredients(sourceText: string): Array<{ name: string; amount: string }> {
  const lines = splitLines(sourceText);
  const items: IngredientItem[] = [];
  const seen = new Set<string>();
  let order = 0;

  const push = (rawName: string, rawAmount: string, rawUnit: string) => {
    const name = normalizeIngredientName(rawName);
    if (!name) {
      return;
    }

    const amount = `${normalizeNumber(rawAmount)} ${normalizeUnit(rawUnit)}`;
    const key = `${name.toLowerCase()}|${amount}`;
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    items.push({ key, name, amount, rank: ingredientRank(name), order: order++ });
  };

  for (const line of lines) {
    const namedPattern = /(^|[;,.\n])\s*([A-Za-zА-Яа-яЁё()\-\s]{2,40})\s*[:—-]\s*(\d+(?:[.,]\d+)?)\s*(кг|г|л|мл|ml|l)\b/gi;
    for (const match of line.matchAll(namedPattern)) {
      push(match[2] ?? "", match[3] ?? "", match[4] ?? "");
    }

    const amountFirstPattern = /(\d+(?:[.,]\d+)?)\s*(кг|г|л|мл|ml|l)\s+([A-Za-zА-Яа-яЁё][^,.;\n]*?)(?=(?:\d+(?:[.,]\d+)?\s*(?:кг|г|л|мл|ml|l)\b)|$)/gi;
    for (const match of line.matchAll(amountFirstPattern)) {
      push(match[3] ?? "", match[1] ?? "", match[2] ?? "");
    }
  }

  return items
    .sort((a, b) => {
      if (a.rank !== b.rank) {
        return a.rank - b.rank;
      }
      return a.order - b.order;
    })
    .slice(0, 6)
    .map((item) => ({ name: item.name, amount: item.amount }));
}

function normalizeIngredientName(raw: string): string {
  let value = raw
    .replace(/\s+/g, " ")
    .replace(/[.,;:]+$/g, "")
    .replace(/\b(размеш\w*|смеш\w*|выпар\w*|добав\w*|внес\w*|постав\w*|снял\w*|перел\w*|для|на|в)\b.*$/i, "")
    .trim();

  if (!value) {
    return "";
  }

  if (/м[её]д/i.test(value)) {
    return "Мед";
  }

  if (/вода/i.test(value)) {
    return /горяч/i.test(value) ? "Вода (горячая)" : "Вода";
  }

  if (/дрожж/i.test(value)) {
    return "Дрожжи";
  }

  if (value.length > 44) {
    value = value.slice(0, 44).trim();
  }

  return capitalize(value);
}

function ingredientRank(name: string): number {
  const key = name.toLowerCase();
  if (key.startsWith("мед")) {
    return 1;
  }
  if (key.startsWith("вода")) {
    return 2;
  }
  if (key.startsWith("дрожжи")) {
    return 3;
  }
  return 10;
}

function extractFermentationStart(sourceText: string): string | null {
  for (const line of splitLines(sourceText)) {
    if (!/(брожен|поставил|поставили)/i.test(line)) {
      continue;
    }

    const date = extractDateToken(line);
    if (!date) {
      continue;
    }

    const timeMatch = line.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    const formattedDate = formatDateToken(date);
    if (!formattedDate) {
      continue;
    }

    return timeMatch ? `${formattedDate} ${timeMatch[0]}` : formattedDate;
  }

  return null;
}

function extractBottleVolume(sourceText: string): string | null {
  const contextual = sourceText.match(/(?:об[ъе]м|бутылк[аи])[^\n.]{0,30}?(\d+(?:[.,]\d+)?)\s*(л|мл|ml|l)\b/i);
  if (contextual) {
    return `${normalizeNumber(contextual[1] ?? "")} ${normalizeUnit(contextual[2] ?? "")}`;
  }

  return null;
}

function extractBottleAbv(sourceText: string): string | null {
  const contextual = sourceText.match(/(?:крепост[ьи]|abv)[^\n.]{0,20}?(\d+(?:[.,]\d+)?)\s*%/i);
  if (contextual) {
    return `${normalizeNumber(contextual[1] ?? "")}%`;
  }

  return null;
}

function extractBatchNumber(sourceText: string): string | null {
  const match = sourceText.match(/(?:номер\s+партии|партия|batch)\s*[:#-]?\s*([A-Za-zА-Яа-я0-9\-_/]{2,40})/i);
  return match?.[1]?.trim() ?? null;
}

function buildFallbackBatchNumber(fallbackDateIso: string): string {
  const date = fallbackDateIso.slice(0, 10).replace(/-/g, "");
  return `BATCH-${date}`;
}

function normalizePlainText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/```/g, "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1 ($2)")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitLines(text: string): string[] {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function extractDateToken(line: string): string | null {
  const match = line.match(/\b(\d{2}\.\d{2}(?:\.\d{2,4})?|\d{4}-\d{2}-\d{2})\b/);
  return match?.[1] ?? null;
}

function formatDateToken(token: string): string | null {
  const iso = token.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    return `${iso[3]}.${iso[2]}.${iso[1]}`;
  }

  const ru = token.match(/^(\d{2})\.(\d{2})(?:\.(\d{2,4}))?$/);
  if (!ru) {
    return null;
  }

  const yearRaw = ru[3] ?? "";
  const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw.length === 4 ? yearRaw : String(new Date().getFullYear());
  return `${ru[1]}.${ru[2]}.${year}`;
}

function formatIsoDate(input: string): string {
  const iso = input.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!iso) {
    return input;
  }

  return `${iso[3]}.${iso[2]}.${iso[1]}`;
}

function normalizeNumber(value: string): string {
  return value.replace(/,/g, ".").trim();
}

function normalizeUnit(value: string): string {
  const unit = value.toLowerCase();
  if (unit === "ml") {
    return "мл";
  }
  if (unit === "l") {
    return "л";
  }
  return unit;
}

function capitalize(value: string): string {
  if (!value) {
    return value;
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}
