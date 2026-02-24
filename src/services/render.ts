import { escapeHtml } from "../lib/format.js";
import type { Drink, JournalEntry, ShareLink } from "../types.js";

export function renderNotFoundPage(): string {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Страница не найдена</title>
  <style>
    body { font-family: "IBM Plex Sans", "Segoe UI", sans-serif; padding: 24px; background: #f2f0ea; color: #1f1f1f; }
    .card { max-width: 760px; margin: 40px auto; background: #fff; border-radius: 18px; padding: 28px; box-shadow: 0 12px 28px rgba(0,0,0,.08); }
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
}): string {
  const { drink, shareLink, entries } = input;
  const title = shareLink.type === "gift" ? `Подарочная бутылка ${drink.name}` : `Дневник напитка ${drink.name}`;

  const giftBlock =
    shareLink.type === "gift"
      ? `
      <section class="gift">
        <h2>Именная бутылка</h2>
        <p><strong>Получатель:</strong> ${escapeHtml(shareLink.giftRecipient ?? "Не указано")}</p>
        <p><strong>Номер бутылки:</strong> ${escapeHtml(shareLink.bottleCode ?? "Не указан")}</p>
        ${shareLink.giftMessage ? `<p><strong>Сообщение:</strong> ${escapeHtml(shareLink.giftMessage)}</p>` : ""}
      </section>
    `
      : "";

  const entriesHtml =
    entries.length === 0
      ? "<p class=\"empty\">Пока нет записей по этому напитку.</p>"
      : entries
          .map((entry) => {
            const polished = entry.polishedText
              ? `<details><summary>Улучшенная версия</summary><pre>${escapeHtml(entry.polishedText)}</pre></details>`
              : "";

            return `
              <article class="entry">
                <header>
                  <h3>${escapeHtml(entry.entryDate)}</h3>
                  <span>ID: ${escapeHtml(entry.id.slice(0, 8))}</span>
                </header>
                <pre>${escapeHtml(entry.rawText)}</pre>
                ${polished}
              </article>
            `;
          })
          .join("\n");

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      --bg: #efe6d4;
      --card: #fff9ef;
      --ink: #2b1f0c;
      --muted: #6d5a3f;
      --accent: #9f3c0f;
      --line: #dcc8a4;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Manrope", "Segoe UI", sans-serif;
      color: var(--ink);
      background: radial-gradient(circle at top right, #f8d89a 0%, var(--bg) 42%, #ead5b3 100%);
      padding: 22px;
    }
    main {
      max-width: 920px;
      margin: 0 auto;
      display: grid;
      gap: 16px;
    }
    .hero, .gift, .timeline {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 18px 20px;
      box-shadow: 0 12px 30px rgba(66, 43, 10, 0.08);
    }
    h1, h2, h3 { margin: 0 0 8px; }
    p { margin: 6px 0; }
    .meta { color: var(--muted); font-size: 14px; }
    .entry {
      border-top: 1px dashed var(--line);
      padding-top: 12px;
      margin-top: 12px;
    }
    .entry header {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      color: var(--muted);
      font-size: 13px;
      margin-bottom: 8px;
    }
    pre {
      white-space: pre-wrap;
      margin: 0;
      font-family: "IBM Plex Mono", ui-monospace, monospace;
      background: #fff;
      border: 1px solid #e9d8bc;
      border-radius: 12px;
      padding: 10px;
    }
    details { margin-top: 10px; }
    summary { cursor: pointer; color: var(--accent); }
    .empty { color: var(--muted); }
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <h1>${escapeHtml(drink.name)}</h1>
      <p class="meta">${escapeHtml(title)}</p>
      <p class="meta">Создано: ${escapeHtml(shareLink.createdAt.slice(0, 10))}</p>
    </section>
    ${giftBlock}
    <section class="timeline">
      <h2>История рецепта</h2>
      ${entriesHtml}
    </section>
  </main>
</body>
</html>`;
}
