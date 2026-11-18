/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [{ source: '/trap', destination: '/api/trap' }];
  },
};
export default nextConfig;
