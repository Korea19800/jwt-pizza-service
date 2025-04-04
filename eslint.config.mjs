import globals from 'globals';
import pluginJs from '@eslint/js';


//export default [
  //{ files: ['**/*.js'], languageOptions: { sourceType: 'commonjs' } },
  //{ languageOptions: { globals: globals.node } },
  //{ languageOptions: { globals: globals.jest } },
  //pluginJs.configs.recommended,
// ];

// updated eslint.config.mjs for deliv11
export default [
  {
    files: ["**/*.js"],
    languageOptions: {
      sourceType: "module",
      ecmaVersion: 2020,
    },
    env: {
      node: true,
      es2021: true,
    },
    rules: {
      // 여기에 룰들 추가
    },
  },
];
