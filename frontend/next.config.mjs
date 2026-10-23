// Local Next proxies /api to the FastAPI process. On Vercel, vercel.json
// already sends /api and /health to that service, so these rewrites must
// not point at the public host (and a host without https:// fails the build).
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const configDir = path.dirname(fileURLToPath(import.meta.url));

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

function buildId() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  if (sha) return sha.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: configDir,
      encoding: 'utf8',
    }).trim();
  } catch (error) {
    const detail = error?.stderr?.toString?.() || error?.message || 'unknown';
    console.error('Could not read the git build id:', detail.trim());
    return 'dev';
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Dev server advertises as localhost; the app is opened at 127.0.0.1.
  // Without this, Next can fail to serve /_next chunks (ChunkLoadError).
  allowedDevOrigins: ['127.0.0.1', 'http://127.0.0.1:3000'],
  env: {
    NEXT_PUBLIC_DEPLOYMENT_ID:
      process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA || 'local',
    NEXT_PUBLIC_BUILD_ID: buildId(),
  },
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
      { source: '/api/support/:path*', destination: `${apiOrigin}/api/support/:path*` },
      { source: '/health', destination: `${apiOrigin}/health` },
    ];
  },
};

export default nextConfig;
