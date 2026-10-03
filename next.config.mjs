/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Security: the Anthropic key is read server-side only (src/app/api/*). Never prefix it with NEXT_PUBLIC_.
  poweredByHeader: false,
};

export default nextConfig;
