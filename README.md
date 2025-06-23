# vite-plugin-css-variables

Vite plugin that generates CSS variables from JavaScript/TypeScript configuration objects.

## Installation

```bash
npm install vite-plugin-css-variables --save-dev
```

## Usage

```typescript
import { cssVariablesPlugin } from "vite-plugin-css-variables";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    cssVariablesPlugin({
      configPath: "./src/config.ts",
      constantName: "COLORS",
      outputPath: "./src/styles/variables.css",
      variablesPrefix: "app",
      getVariableSyntax: ({ value }) =>
        value.startsWith("#") ? "<color>" : "<length-percentage>",
    }),
  ],
});
```

## Options

| Option              | Type     | Description                                      |
| ------------------- | -------- | ------------------------------------------------ |
| configPath          | string   | Path to config file                              |
| constantName        | string   | Name of the exported constant                    |
| outputPath          | string   | Output CSS file path                             |
| variablesPrefix     | string   | Prefix for CSS variables                         |
| getVariableSyntax   | function | Returns CSS `@property` syntax for each variable |
| eslintConfigPath?   | string   | Optional ESLint config path                      |
| prettierConfigPath? | string   | Optional Prettier config path                    |
