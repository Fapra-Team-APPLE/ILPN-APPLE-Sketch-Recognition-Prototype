// @ts-check
const eslint = require("@eslint/js");
const tseslint = require("typescript-eslint");
const angular = require("angular-eslint");
const decoratorPosition = require("eslint-plugin-decorator-position");
const importPlugin = require("eslint-plugin-import");

module.exports = tseslint.config(
    {
        files: ["**/*.html"],
        extends: [
            ...angular.configs.templateRecommended,
        ],
        rules: {},
    },
    {
        files: ["**/*.ts"],
        plugins: {
            import: importPlugin,
            'decorator-position': decoratorPosition
        },
        extends: [
            eslint.configs.recommended,
            ...tseslint.configs.recommended,
            ...tseslint.configs.stylistic,
            ...angular.configs.tsRecommended,
        ],
        processor: angular.processInlineTemplates,
        rules: {
            "@angular-eslint/directive-selector": [
                "error",
                {
                    type: "attribute",
                    prefix: "app",
                    style: "camelCase",
                },
            ],
            "@angular-eslint/prefer-inject": "off",
            "@typescript-eslint/array-type": "off",
            "@typescript-eslint/consistent-indexed-object-style": "off",
            '@typescript-eslint/no-shadow': 'error',
            '@typescript-eslint/no-inferrable-types': 'off',
            '@typescript-eslint/consistent-type-assertions': 'off',
            '@typescript-eslint/no-unused-vars': [
                'error',
                {
                    'args': 'all',
                    'argsIgnorePattern': '^_',
                    'caughtErrors': 'all',
                    'caughtErrorsIgnorePattern': '^_',
                    'destructuredArrayIgnorePattern': '^_',
                    'varsIgnorePattern': '^_',
                    'ignoreRestSiblings': true
                }
            ],
            '@typescript-eslint/member-ordering': [
                'error',
                {
                    default: {
                        memberTypes: [
                            'signature',
                            'call-signature',
                            'field',
                            'constructor',
                            'method'
                        ],
                        order: 'as-written'
                    }
                }
            ],
            '@typescript-eslint/naming-convention': [
                'error',
                {
                    selector: 'variable',
                    format: ['camelCase', 'UPPER_CASE']
                },
                {
                    selector: 'classProperty',
                    modifiers: ['static', 'readonly'],
                    format: ['UPPER_CASE']
                },
                {
                    selector: 'variable',
                    modifiers: ['destructured'],
                    format: null
                },
                {
                    selector: 'typeLike',
                    format: ['PascalCase']
                },
                {
                    selector: 'memberLike',
                    modifiers: ['private'],
                    format: ['camelCase'],
                    leadingUnderscore: 'allow'
                }
            ],
            '@typescript-eslint/ban-ts-comment': 'off',
            '@angular-eslint/component-class-suffix': 'error',
            '@angular-eslint/no-input-rename': 'error',
            '@angular-eslint/no-output-rename': 'error',
            '@angular-eslint/prefer-standalone': 'error',
            'no-shadow': 'off',
            indent: ['error', 4, {
                SwitchCase: 2,
                FunctionExpression: {parameters: 'first'},
                FunctionDeclaration: {parameters: 'first'}
            }],
            'space-infix-ops': 'error',
            'keyword-spacing': ['error', {before: true, after: true}],
            'spaced-comment': ['error', 'always'],
            'max-len': ['error', {code: 175}],
            'max-params': ['error', 5],
            complexity: 'off',
            'no-trailing-spaces': 'error',
            'eol-last': ['error', 'always'],
            semi: ['error', 'always'],
            'no-multi-spaces': 'error',
            'no-multiple-empty-lines': ['error', {max: 2, maxEOF: 1}],
            'import/no-duplicates': 'error',
            'import/order': ['error', {
                alphabetize: {
                    order: 'asc',
                    caseInsensitive: true
                }
            }],
            'import/no-cycle': 'error',
            'function-paren-newline': ['error', 'consistent'],
            'decorator-position/decorator-position': 'error',
            'padded-blocks': ['error',
                {
                    blocks: 'never',
                    classes: 'always',
                    switches: 'never'
                }],
            'lines-between-class-members': ['error', 'always', {exceptAfterSingleLine: true}],
            eqeqeq: ['error', 'always'],
            quotes: ['error', 'single']
        },
    },
);
