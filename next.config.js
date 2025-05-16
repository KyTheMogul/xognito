/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [...(config.externals || []), 'firebase-functions', 'firebase-admin'];
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [...(config.watchOptions?.ignored || []), '**/firebase/functions/**']
      };
    }
    return config;
  },
  experimental: {
    serverComponentsExternalPackages: ['firebase-functions', 'firebase-admin']
  },
  // Exclude Firebase Functions from the build
  transpilePackages: []
}

module.exports = nextConfig 