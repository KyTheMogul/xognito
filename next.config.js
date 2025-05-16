/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Ensure externals is an array
      const externals = Array.isArray(config.externals) ? config.externals : [];
      config.externals = [...externals, 'firebase-functions', 'firebase-admin'];
      
      // Ensure watchOptions.ignored is an array
      const ignored = Array.isArray(config.watchOptions?.ignored) ? config.watchOptions.ignored : [];
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [...ignored, '**/firebase/functions/**']
      };
    }
    return config;
  },
  // Use the new serverExternalPackages option
  serverExternalPackages: ['firebase-functions', 'firebase-admin'],
  // Exclude Firebase Functions from the build
  transpilePackages: []
}

module.exports = nextConfig 