/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverRuntimeConfig: {
    // Aumenta timeout das API routes para 30s (necessário com 110 ligas)
  },
};

module.exports = nextConfig;
