/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [...(config.externals || []), 'firebase-functions', 'firebase-admin'];
    }
    return config;
  },
  experimental: {
    serverComponentsExternalPackages: ['firebase-functions', 'firebase-admin']
  },
  // Exclude Firebase Functions from the build
  transpilePackages: [],
  // Ignore Firebase Functions directory
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [...(config.watchOptions?.ignored || []), '**/firebase/functions/**']
      };
    }
    return config;
  }
}

module.exports = nextConfig 