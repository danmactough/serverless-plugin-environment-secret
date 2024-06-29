module.exports = {
  env: {
    commonjs: true,
    es2024: true,
    node: true,
    jest: true,
  },
  rules: {
    quotes: [
      'error',
      'single',
      { avoidEscape: true, allowTemplateLiterals: true },
    ],
  },
};
