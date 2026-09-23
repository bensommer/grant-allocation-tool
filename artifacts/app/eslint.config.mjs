import nextConfig from 'eslint-config-next';

const config = [
  ...nextConfig,
  { ignores: ['.next/**', 'src/generated/**', 'playwright-report/**', 'test-results/**'] },
];

export default config;
