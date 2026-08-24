// Dev-only: lets Jest run the PWA's ES-module source (src/*.js) under
// Node's CommonJS default without touching how those files ship to the
// browser (browsers use <script type="module">, not this config).
module.exports = {
  presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
};
