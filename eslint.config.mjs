import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'
import prettier from 'eslint-config-prettier/flat'
import tseslint from 'typescript-eslint'

const cssDeclarations = {
  meta: { name: 'css-declarations' },
  supportsAutofix: false,
  preprocess(text) {
    const source = text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))
    const lines = source.split('\n').map(() => [])
    for (const match of source.matchAll(/([a-z-]+)\s*:\s*([^;{}]+);/gi)) {
      const line = source.slice(0, match.index).split('\n').length - 1
      lines[line].push(
        `__css(${JSON.stringify(match[1].toLowerCase())}, ${JSON.stringify(match[2].trim())});`,
      )
    }
    return [{ text: lines.map((calls) => calls.join(' ')).join('\n'), filename: 'declarations.js' }]
  },
  postprocess(messages) {
    return messages.flat()
  },
}

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    files: ['src/**/*.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='style']",
          message:
            'No inline styles: use a CSS module with tokens; typography only through <Text variant>.',
        },
        {
          selector: "JSXOpeningElement[name.name='style']",
          message:
            'No <style> elements: use a CSS module with tokens; typography only through <Text variant>.',
        },
      ],
    },
  },
  {
    files: ['src/components/**/*.{ts,tsx}', 'src/app/**/*.{ts,tsx}'],
    ignores: ['src/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='style']",
          message:
            'No inline styles: use a CSS module with tokens; typography only through <Text variant>.',
        },
        {
          selector: "JSXOpeningElement[name.name='style']",
          message:
            'No <style> elements: use a CSS module with tokens; typography only through <Text variant>.',
        },
        {
          selector: 'Literal[value=/#[0-9a-fA-F]{3,8}\\b/]',
          message: 'No raw hex colors in component code: use a color token.',
        },
        {
          selector: 'TemplateElement[value.raw=/#[0-9a-fA-F]{3,8}\\b/]',
          message: 'No raw hex colors in component code: use a color token.',
        },
        {
          selector: 'Literal[value=/\\d(px|rem)\\b/]:not([value=/\\((min|max)-(width|height):/])',
          message: 'No raw px or rem values in component code: use a spacing/size/radius token.',
        },
        {
          selector: 'TemplateElement[value.raw=/\\d(px|rem)\\b/]',
          message: 'No raw px or rem values in component code: use a spacing/size/radius token.',
        },
      ],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/**/*.test.{ts,tsx}'],
    rules: {
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
    },
  },
  {
    files: ['src/types/**/*.d.ts'],
    rules: { '@typescript-eslint/consistent-type-definitions': 'off' },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  { files: ['src/**/*.css'], processor: cssDeclarations },
  {
    files: ['src/**/*.css/*.js'],

    ignores: [
      'src/styles/tokens.css/**',
      'src/styles/font-faces.css/**',
      'src/components/text-styles.module.css/**',
    ],
    languageOptions: { globals: { __css: 'readonly' } },
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.name='__css'][arguments.0.value=/^(font|font-family|font-size|font-weight|line-height|letter-spacing|text-transform)$/]:not([arguments.1.value=/^(inherit|initial|unset)$/i])",
          message:
            'Typography only through <Text>: font, size, weight, line height and letter spacing come from text-styles.module.css.',
        },
        {
          selector:
            "CallExpression[callee.name='__css'][arguments.1.value=/#[0-9a-fA-F]{3,8}\\b|rgba?\\(|hsla?\\(/]",
          message: 'No raw colors in CSS: use a color token var(--color-...).',
        },
      ],
    },
  },
  prettier,
  globalIgnores([
    '**/.next/**',
    '.next-*/**',
    '.next/**',
    'node_modules/**',
    'design/**',
    'content/**',
    'coverage/**',
    'playwright-report/**',
    'test-results/**',
    'drizzle/**',
    'next-env.d.ts',
  ]),
])
