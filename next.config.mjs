/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Security: the Anthropic key is read server-side only (src/app/api/*). Never prefix it with NEXT_PUBLIC_.
  poweredByHeader: false,
  // satellite.js' optional WASM runtimes are unused; their self-referencing pthread worker hangs the
  // Turbopack production build. See src/satellites/wasmStub.js.
  turbopack: {
    resolveAlias: {
      '#wasm-single-thread': './src/satellites/wasmStub.js',
      '#wasm-multi-thread': './src/satellites/wasmStub.js',
    },
  },
};

export default nextConfig;
