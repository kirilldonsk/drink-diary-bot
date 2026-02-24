import fs from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import type { AppConfig } from "./config.js";
import { AppDatabase } from "./db.js";
import type { ExtractedRecipeFacts, RecipePolisher } from "./services/llm.js";
import { renderNotFoundPage, renderSharePage } from "./services/render.js";

interface ServerDeps {
  config: AppConfig;
  db: AppDatabase;
  polisher: RecipePolisher;
}

export function createHttpServer(deps: ServerDeps) {
  const app = Fastify({ logger: true });
  const signaturePath = path.resolve(process.cwd(), "signature.svg");
  const recipeFactsCache = new Map<string, ExtractedRecipeFacts | null>();

  app.get("/", async () => {
    return {
      service: "drink-diary-bot",
      status: "ok"
    };
  });

  app.get("/health", async () => {
    return {
      ok: true,
      timestamp: new Date().toISOString()
    };
  });

  app.get("/signature.svg", async (_request, reply) => {
    if (!fs.existsSync(signaturePath)) {
      reply.code(404).type("text/plain; charset=utf-8").send("signature.svg not found");
      return;
    }

    reply.type("image/svg+xml; charset=utf-8").send(fs.readFileSync(signaturePath, "utf-8"));
  });

  app.get<{ Params: { token: string } }>("/q/:token", async (request, reply) => {
    const shareLink = deps.db.getShareLinkByToken(request.params.token);

    if (!shareLink) {
      reply.code(404).type("text/html; charset=utf-8").send(renderNotFoundPage());
      return;
    }

    const drink = deps.db.getDrinkById(shareLink.drinkId);
    if (!drink) {
      reply.code(404).type("text/html; charset=utf-8").send(renderNotFoundPage());
      return;
    }

    const entries = deps.db.listEntriesByDrink(drink.id);
    const cacheKey = buildFactsCacheKey(shareLink.id, entries);
    let gptFacts = recipeFactsCache.get(cacheKey) ?? null;

    if (!recipeFactsCache.has(cacheKey) && deps.polisher.enabled && entries.length > 0) {
      const sourceText = entries
        .map((entry) => [entry.entryDate, entry.polishedText ?? entry.rawText].join(" | "))
        .join("\n\n");

      gptFacts = await deps.polisher.extractRecipeFacts(drink.name, sourceText);
      recipeFactsCache.set(cacheKey, gptFacts);
    }

    const html = renderSharePage({ drink, shareLink, entries, gptFacts });

    reply.type("text/html; charset=utf-8").send(html);
  });

  return app;
}

function buildFactsCacheKey(shareLinkId: string, entries: Array<{ id: string; updatedAt: string }>): string {
  const latest = entries[0];
  const latestKey = latest ? `${latest.id}:${latest.updatedAt}` : "none";
  return `${shareLinkId}|${entries.length}|${latestKey}`;
}
