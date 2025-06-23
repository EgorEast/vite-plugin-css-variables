/* eslint-disable max-lines */
import fs from "fs/promises";
import path from "path";
import { ESLint } from "eslint";
import prettier from "prettier";
import type { Plugin } from "vite";

interface PluginOptions {
  configPath: string;
  constantName: string;
  eslintConfigPath?: string;
  getVariableSyntax: (params: { key: string; value: string }) => string;
  outputPath: string;
  prettierConfigPath?: string;
  variablesPrefix: string;
}

const loadPrettierConfig = async (configPath?: string) => {
  try {
    const cwd = process.cwd();
    const configFile = configPath
      ? path.resolve(configPath)
      : await findConfigFile(cwd, [
          "prettier.config.cjs",
          "prettier.config.js",
          ".prettierrc.cjs",
          ".prettierrc.js",
          ".prettierrc",
        ]);

    if (configFile) {
      const config = await import(configFile);
      return config.default || config;
    }
    return await prettier.resolveConfig(cwd);
  } catch (error) {
    console.warn("Failed to load Prettier config:", error);
    return null;
  }
};

const loadEslintConfig = async (configPath?: string) => {
  try {
    const cwd = process.cwd();
    const configFile = configPath
      ? path.resolve(configPath)
      : await findConfigFile(cwd, [
          "eslint.config.js",
          "eslint.config.mjs",
          ".eslintrc.js",
          ".eslintrc.cjs",
        ]);

    return new ESLint({
      fix: true,
      overrideConfigFile: configFile,
    });
  } catch (error) {
    console.warn("Failed to load ESLint config:", error);
    return null;
  }
};

const findConfigFile = async (dir: string, names: string[]) => {
  for (const name of names) {
    const filePath = path.join(dir, name);
    try {
      await fs.access(filePath);
      return filePath;
    } catch {
      continue;
    }
  }
  return null;
};

const formatFile = async (
  filePath: string,
  eslint: ESLint | null,
  prettierConfig: null | prettier.Options,
) => {
  try {
    let content = await fs.readFile(filePath, "utf-8");

    if (prettierConfig) {
      const ext = path.extname(filePath).slice(1);
      content = await prettier.format(content, {
        ...prettierConfig,
        filepath: filePath,
        parser: ext === "css" ? "css" : "babel",
      });
      await fs.writeFile(filePath, content);
    }

    if (eslint) {
      const results = await eslint.lintText(content, { filePath });
      if (results[0]?.output) {
        content = results[0].output;
        await fs.writeFile(filePath, content);

        if (prettierConfig) {
          const ext = path.extname(filePath).slice(1);
          content = await prettier.format(content, {
            ...prettierConfig,
            filepath: filePath,
            parser: ext === "css" ? "css" : "babel",
          });
          await fs.writeFile(filePath, content);
        }
      }
    }
  } catch (error) {
    console.warn(
      "Formatting error:",
      error instanceof Error ? error.message : error,
    );
  }
};

const extractConfig = async (
  filePath: string,
  constantName: string,
): Promise<null | Record<string, string>> => {
  try {
    const content = await fs.readFile(filePath, "utf-8");

    // 1. Попробуем найти именованный экспорт (export const CONSTANT_NAME)
    let match = content.match(
      new RegExp(
        `export\\s+const\\s+${constantName}\\s*=\\s*(\\{[^]*?\\})(?:\\s*;)?`,
        "m",
      ),
    );

    // 2. Если не найдено, попробуем найти в default экспорте (export default { CONSTANT_NAME })
    if (!match)
      match = content.match(
        new RegExp(
          `export\\s*\\{[^]*?${constantName}\\s*:\\s*(\\{[^]*?\\})[^]*?\\}(?:\\s*;)?`,
          "m",
        ),
      );

    // 3. Если все еще не найдено, попробуем найти любой объект с таким именем
    if (!match)
      match = content.match(
        new RegExp(
          `(?:const|let|var)\\s+${constantName}\\s*=\\s*(\\{[^]*?\\})(?:\\s*;)?`,
          "m",
        ),
      );

    if (!match?.[1]) {
      console.error(
        `Configuration object "${constantName}" not found in ${filePath}`,
      );
      return null;
    }

    // Преобразуем шаблонные строки с переменными в CSS-переменные
    const configStr = match[1]
      .replace(/\${([A-Z_]+)\.([a-zA-Z_]+)}/g, (_, prefix, name) => {
        // Преобразуем camelCase в kebab-case и добавляем префикс
        const kebabName = name.replace(/[A-Z]/g, "-$&").toLowerCase();
        return `var(--${prefix.toLowerCase()}-${kebabName})`;
      })
      .replace(/(['"])?([a-zA-Z0-9_]+)(['"])?:/g, '"$2":') // Ключи без кавычек
      .replace(/'/g, '"') // Одинарные кавычки в двойные
      .replace(/,\s*([}\]])/g, "$1") // Висящие запятые
      .replace(/\/\/.*$/gm, "") // Удаляем комментарии
      .replace(/\/\*[\s\S]*?\*\//g, ""); // Удаляем многострочные комментарии

    try {
      // Безопасное преобразование строки в объект
      const obj = new Function(`return ${configStr}`)();

      // Преобразуем все значения в строки
      const result: Record<string, string> = {};
      for (const key in obj) {
        if (typeof obj[key] === "function") {
          console.warn(`Function found in ${constantName}.${key} - skipping`);
          continue;
        }
        result[key] = String(obj[key]);
      }
      return result;
    } catch (e) {
      console.error(`Error evaluating config object from ${filePath}:`, e);
      return null;
    }
  } catch (error) {
    console.error(`Error parsing ${constantName} from ${filePath}:`, error);
    return null;
  }
};

const generateCssContent = (
  config: Record<string, string>,
  prefix: string,
  getSyntax: (params: { key: string; value: string }) => string,
) => {
  const properties = Object.entries(config)
    .map(([key, value]) => {
      const varName = prefix
        ? `--${prefix}-${key.replace(/[A-Z]/g, "-$&").toLowerCase()}`
        : `--${key.replace(/[A-Z]/g, "-$&").toLowerCase()}`;
      const syntax = getSyntax({ key, value });

      return `@property ${varName} {
  syntax: '${syntax}';
  inherits: false;
  initial-value: ${value};
}`;
    })
    .join("\n\n");

  const variables = `:root {
${Object.entries(config)
  .map(([key, value]) => {
    const varName = prefix
      ? `--${prefix}-${key.replace(/[A-Z]/g, "-$&").toLowerCase()}`
      : `--${key.replace(/[A-Z]/g, "-$&").toLowerCase()}`;
    return `  ${varName}: ${value};`;
  })
  .join("\n")}
}`;

  return `/* autogenerated by vite-plugin-css-variables */

${properties}

${variables}`;
};

export const cssVariablesPlugin = (options: PluginOptions): Plugin => {
  const resolvedOptions = {
    ...options,
    configPath: path.resolve(options.configPath),
    eslintConfigPath: options.eslintConfigPath
      ? path.resolve(options.eslintConfigPath)
      : undefined,
    outputPath: path.resolve(options.outputPath),
    prettierConfigPath: options.prettierConfigPath
      ? path.resolve(options.prettierConfigPath)
      : undefined,
  };

  let formattingTools: {
    eslint: ESLint | null;
    prettierConfig: null | prettier.Options;
  } | null = null;

  const generateCss = async () => {
    try {
      if (!formattingTools)
        formattingTools = {
          eslint: await loadEslintConfig(resolvedOptions.eslintConfigPath),
          prettierConfig: await loadPrettierConfig(
            resolvedOptions.prettierConfigPath,
          ),
        };

      const config = await extractConfig(
        resolvedOptions.configPath,
        resolvedOptions.constantName,
      );
      if (!config) {
        console.error(
          `❌ ${resolvedOptions.constantName} not found or invalid`,
        );
        return false;
      }

      const cssContent = generateCssContent(
        config,
        resolvedOptions.variablesPrefix,
        resolvedOptions.getVariableSyntax,
      );

      await fs.mkdir(path.dirname(resolvedOptions.outputPath), {
        recursive: true,
      });
      await fs.writeFile(resolvedOptions.outputPath, cssContent);
      await formatFile(
        resolvedOptions.outputPath,
        formattingTools.eslint,
        formattingTools.prettierConfig,
      );

      console.log(`✅ CSS variables updated: ${resolvedOptions.outputPath}`);
      return true;
    } catch (error) {
      console.error("❌ CSS generation failed:", error);
      return false;
    }
  };

  return {
    async buildStart() {
      await generateCss();
    },
    configureServer(server) {
      const watcher = server.watcher;
      let debounceTimer: NodeJS.Timeout | null = null;

      watcher.add(resolvedOptions.configPath);

      const handleChange = async () => {
        if (debounceTimer) clearTimeout(debounceTimer);

        debounceTimer = setTimeout(async () => {
          const success = await generateCss();
          if (success)
            server.ws.send({
              data: { updated: true },
              event: "css-variables-updated",
              type: "custom",
            });
        }, 100);
      };

      watcher.on("change", (changedPath) => {
        if (changedPath === resolvedOptions.configPath) void handleChange();
      });

      watcher.on("add", (addedPath) => {
        if (addedPath === resolvedOptions.configPath) void handleChange();
      });
    },

    enforce: "pre",

    name: "vite-plugin-css-variables",

    transformIndexHtml: {
      handler(html) {
        return {
          html,
          tags: [
            {
              content: `
              if (import.meta.hot) {
                import.meta.hot.on('css-variables-updated', () => {
                  const link = document.querySelector('[href*="${path.basename(resolvedOptions.outputPath)}"]');
                  if (link) {
                    const url = new URL(link.href);
                    url.searchParams.set('t', Date.now());
                    link.href = url.toString();
                  }
                });
              }
            `,
              injectTo: "head",
              tag: "script",
            },
          ],
        };
      },
      order: "pre",
    },
  };
};

export type { PluginOptions };
