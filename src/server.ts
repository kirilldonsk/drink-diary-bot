import Fastify from "fastify";
import type { AppConfig } from "./config.js";
import { AppDatabase } from "./db.js";
import { renderNotFoundPage, renderSharePage } from "./services/render.js";

interface ServerDeps {
  config: AppConfig;
  db: AppDatabase;
}

export function createHttpServer(deps: ServerDeps) {
  const app = Fastify({ logger: true });

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
    const html = renderSharePage({ drink, shareLink, entries });

    reply.type("text/html; charset=utf-8").send(html);
  });

  return app;
}
