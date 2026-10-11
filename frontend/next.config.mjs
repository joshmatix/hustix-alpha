const apiOrigin = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      { source: '/api/portfolios', destination: `${apiOrigin}/api/portfolios` },
      { source: '/api/portfolios/:path*', destination: `${apiOrigin}/api/portfolios/:path*` },
      { source: '/api/v1/:path*', destination: `${apiOrigin}/api/v1/:path*` },
      { source: '/api/macro/:path*', destination: `${apiOrigin}/api/macro/:path*` },
      { source: '/health', destination: `${apiOrigin}/health` },
    ];
  },
};

export default nextConfig;
