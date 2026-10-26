import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'
import { defineConfig } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig([
  // 생성된 아이콘 모듈과 빌드 결과물은 검사하지 않는다
  { ignores: ['dist', 'src/server/icons.ts'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['src/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    extends: [reactHooks.configs.flat.recommended],
  },
  {
    files: ['api/**', 'src/server/**', 'scripts/**', '__test__/**', '*.config.{js,ts}', '.pnpmfile.cjs'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['.pnpmfile.cjs'],
    languageOptions: { sourceType: 'commonjs' },
  },
  {
    rules: {
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  // 서식은 prettier 가 맡으므로 서식 관련 규칙은 끈다 (항상 마지막에 둔다)
  prettier,
])
