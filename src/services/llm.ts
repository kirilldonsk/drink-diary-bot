import OpenAI from "openai";

interface LlmConfig {
  apiKey?: string;
  baseUrl: string;
  model: string;
}

export class RecipePolisher {
  private readonly client: OpenAI | null;
  private readonly model: string;

  constructor(config: LlmConfig) {
    this.model = config.model;

    if (!config.apiKey) {
      this.client = null;
      return;
    }

    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl
    });
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  async polish(drinkName: string, entryText: string): Promise<string | null> {
    if (!this.client) {
      return null;
    }

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        temperature: 0.1,
        messages: [
          {
            role: "system",
            content:
              [
                "Ты корректор технологического дневника напитков.",
                "Разрешено только:",
                "- исправить орфографию, пунктуацию и пробелы;",
                "- слегка структурировать текст коротким списком по исходным фактам, если это уместно.",
                "Запрещено:",
                "- добавлять советы, рекомендации, выводы, предупреждения;",
                "- добавлять новые факты, ингредиенты, действия или планы.",
                "Ответ только на русском, только чистый текст, без Markdown."
              ].join("\n")
          },
          {
            role: "user",
            content: [
              `Напиток: ${drinkName}`,
              "Отредактируй запись аккуратно без расширения смысла и без рекомендаций.",
              "Текст записи:",
              entryText
            ].join("\n")
          }
        ]
      });

      const content = response.choices[0]?.message?.content?.trim();
      return content || null;
    } catch (error) {
      console.error("ProxyAPI polishing failed:", error);
      return null;
    }
  }
}
