import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

// Content-Security-Policy for the built app only (the dev server injects inline scripts).
const csp: Plugin = {
  name: 'wirewright-csp',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace(
      '<head>',
      `<head>\n    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:" />`,
    ),
};

// "source" resolves workspace packages to their TypeScript sources.
// base "./" lets the desktop app load the build from file://.
export default defineConfig({
  base: './',
  plugins: [react(), csp],
  resolve: { conditions: ['source'] },
  build: { outDir: 'dist', sourcemap: true },
});
