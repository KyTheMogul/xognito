/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config, { isServer }) => {
    // Exclude Firebase Functions from the build
    if (isServer) {
      config.externals = [...(config.externals || []), 'firebase-functions', 'firebase-admin'];
    }
    return config;
  },
  // Exclude Firebase Functions directory from the build
  transpilePackages: [],
  experimental: {
    serverComponentsExternalPackages: ['firebase-functions', 'firebase-admin']
  }
}

module.exports = nextConfig 