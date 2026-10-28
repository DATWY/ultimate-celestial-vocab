// ESLint 9 flat config — "cổng chặn chất lượng" còn thiếu của dự án.
//
// Vì sao cấu hình này tồn tại (không phải để trang trí):
//   • `no-undef`  — bắt lỗi gõ sai tên biến toàn cục. Đây là loại lỗi duy nhất
//     trong JS vanilla mà trình duyệt chỉ báo khi ĐÚNG nhánh đó chạy, nên unit
//     test rất dễ bỏ sót (ví dụ một handler chỉ chạy khi bấm nút hiếm dùng).
//   • `no-dupe-keys` / `no-dupe-args` / `no-unreachable` — lỗi logic thuần.
//   • `no-unused-vars` — phát hiện import chết (đã có 3 export chết được ghi
//     trong UPGRADE_BACKLOG) và biến khai báo mà quên dùng.
//   • `no-console` chỉ cảnh báo ở mức `warn` cho phép `warn`/`error`, vì app
//     cố tình log chẩn đoán; `console.log` trong đường chạy nóng là mùi code.
//
// Mục tiêu: `npm run lint` phải trả 0 error. Warning được phép tồn tại nhưng
// mỗi warning phải là quyết định có chủ ý, không phải rác tích tụ.
import js from '@eslint/js';
import globals from 'globals';

export default [
    {
        ignores: [
            'dist/**',
            'node_modules/**',
            'scratch/**',
            'backups/**',
            'reports/**',
            'tmp_audit_verify_ver/**',
            'harness-plugins/**',
            'public/**',
            '.codex-evaluation-dist/**',
            'audit/**',
            'docs/**'
        ]
    },
    js.configs.recommended,
    {
        // ─── Mã chạy trong trình duyệt ───────────────────────────────────────
        files: ['src/**/*.js', 'index.html.js'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'module',
            globals: {
                ...globals.browser,
                ...globals.worker,
                // Global của app, được khai báo ở src/main.js hoặc do index.html đặt.
                __USER_FSRS7_PARAMS__: 'readonly',
                __ucvReady: 'readonly',
                __celestialLoaded: 'readonly'
            }
        },
        rules: {
            'no-unused-vars': [
                'error',
                {
                    args: 'after-used',
                    argsIgnorePattern: '^_',
                    caughtErrors: 'all',
                    caughtErrorsIgnorePattern: '^(_|e|err|error|ignored)$',
                    varsIgnorePattern: '^_',
                    // Rest/spread siblings của cùng một destructuring được phép thừa.
                    ignoreRestSiblings: true
                }
            ],
            'no-console': ['warn', { allow: ['warn', 'error'] }],
            'no-empty': ['error', { allowEmptyCatch: true }],
            // Escape dấu câu trong character class ([\-',\.\/…]) là CỐ Ý để người
            // đọc thấy ngay đây là ký tự đặc biệt, không phải range. Bỏ escape
            // từng chỗ một dễ tạo range ngoài ý muốn (ví dụ `=\-_` → `=-_`), nên
            // giữ ở mức cảnh báo thay vì bắt máy móc sửa 37 chỗ.
            'no-useless-escape': 'warn',
            eqeqeq: ['warn', 'smart'],
            'no-var': 'error',
            'prefer-const': 'warn',
            'no-throw-literal': 'error',
            'no-return-assign': ['warn', 'except-parens'],
            'no-self-compare': 'error',
            'no-unmodified-loop-condition': 'warn',
            'require-atomic-updates': 'off'
            // innerHTML là surface XSS: không cấm (app escape thủ công có kiểm
            // chứng) nhưng mọi chỗ dùng đều phải qua escapeHTML — việc đó do
            // tests/security*.test.mjs và review đảm nhiệm, không phải ESLint.
        }
    },
    {
        // ─── Công cụ Node (build, verify, huấn luyện FSRS) ───────────────────
        files: ['tools/**/*.js', 'tools/**/*.mjs', 'tools/**/*.cjs', 'vite.config.js', 'eslint.config.js'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'module',
            globals: { ...globals.node }
        },
        rules: {
            'no-console': 'off',
            'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none', varsIgnorePattern: '^_' }],
            // Harness chạy thật trong Chrome: vòng chờ có biên thời gian
            // (`while (Date.now() - t0 < 500) {}`) và `catch {}` nuốt lỗi tiến
            // trình con là cố ý — không phải bỏ quên xử lý.
            'no-empty': 'off'
        }
    },
    {
        // Script CommonJS (print_pdf.cjs) — __dirname/require hợp lệ ở đây.
        files: ['**/*.cjs'],
        languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
        rules: { 'no-console': 'off' }
    },
    {
        // ─── Test (node:test + DOM stub tự viết) ─────────────────────────────
        files: ['tests/**/*.mjs', 'tests/**/*.js', 'audit/**/*.mjs'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'module',
            globals: {
                ...globals.node,
                ...globals.browser // stub DOM trong test dùng tên API của browser
            }
        },
        rules: {
            'no-console': 'off',
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrors: 'none', varsIgnorePattern: '^_' }],
            // Harness ở tools/tests dùng vòng chờ rỗng có biên thời gian
            // (`while (Date.now() - t0 < 500) {}`) và `catch {}` để nuốt lỗi
            // của tiến trình con — cố ý, không phải bỏ quên xử lý.
            'no-empty': 'off'
        }
    }
];
