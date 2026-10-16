// Local Next proxies /api to the FastAPI process. On Vercel, vercel.json
// already sends /api and /health to that service, so these rewrites must
// not point at the public host (and a host without https:// fails the build).
function localApiOrigin() {
  const configured = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';
  const withScheme = /^https?:\/\//i.test(configured) ? configured : `http://${configured}`;
  try {
    const url = new URL(withScheme);
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return url.origin;
  } catch {
    return null;
  }
  return null;
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    const apiOrigin = localApiOrigin();
    if (!apiOrigin) return [];
    return [
      { source: '/api/portfolios', destination: `${apiOrigin}/api/portfolios` },
      { source: '/api/portfolios/:path*', destination: `${apiOrigin}/api/portfolios/:path*` },
      { source: '/api/v1/:path*', destination: `${apiOrigin}/api/v1/:path*` },
      { source: '/api/macro/:path*', destination: `${apiOrigin}/api/macro/:path*` },
      { source: '/api/admin/:path*', destination: `${apiOrigin}/api/admin/:path*` },
      { source: '/api/stripe/:path*', destination: `${apiOrigin}/api/stripe/:path*` },
      { source: '/health', destination: `${apiOrigin}/health` },
    ];
  },
};

export default nextConfig;
