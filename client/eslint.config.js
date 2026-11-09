import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    // Render-loop code mutates three.js objects (matrices, uniforms, instance buffers)
    // in useFrame instead of calling setState every frame — the pattern R3F and the
    // performance rules require. The compiler's immutability rule can't tell those
    // scene objects apart from React state, so it is off for the game folder only.
    files: ['src/game/**/*.{js,jsx}'],
    rules: { 'react-hooks/immutability': 'off' },
  },
])
