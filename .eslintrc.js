module.exports = {
	root: true,
	parser: '@typescript-eslint/parser',
	plugins: [
		'@typescript-eslint',
		'obsidianmd',
	],
	extends: [
		'eslint:recommended',
		'plugin:@typescript-eslint/recommended',
		// 'plugin:obsidianmd/recommended',
	],
	rules: {
		'no-console': ['error', { allow: ['warn', 'error', 'debug'] }],
		'@typescript-eslint/no-explicit-any': 'error',
		'@typescript-eslint/no-floating-promises': 'error',
		'@typescript-eslint/no-misused-promises': 'error',
		'@typescript-eslint/require-await': 'error',
		'@typescript-eslint/no-unused-vars': ['error', { 'argsIgnorePattern': '^_' }],
		// 'obsidianmd/ui-setting-heading': 'error',
		// 'obsidianmd/ui-text-sentence-case': 'error',
	},
	parserOptions: {
		project: './tsconfig.json',
	},
};
