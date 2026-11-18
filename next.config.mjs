/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [{ source: '/trap', destination: '/api/trap' }];
  },
  async redirects() {
    return [
      { source: '/use', destination: '/integrations', permanent: false },
      { source: '/compare', destination: '/arena', permanent: false },
      { source: '/console', destination: '/dashboard', permanent: false },
    ];
  },
};
export default nextConfig;
