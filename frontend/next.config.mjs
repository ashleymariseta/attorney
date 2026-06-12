/** @type {import('next').NextConfig} */

// Hosts the dev backend can serve media from. In production set
// NEXT_PUBLIC_API_BASE to your real backend; the URL is parsed here so its
// host is automatically allow-listed for next/image.
const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? 'http://127.0.0.1:8000';
const apiUrl = new URL(apiBase);

const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: apiUrl.protocol.replace(':', ''),
        hostname: apiUrl.hostname,
        port: apiUrl.port || undefined,
        pathname: '/media/**',
      },
      // Dev convenience: cover both 127.0.0.1 and localhost regardless of
      // what NEXT_PUBLIC_API_BASE is set to.
      { protocol: 'http', hostname: '127.0.0.1', port: '8000', pathname: '/media/**' },
      { protocol: 'http', hostname: 'localhost', port: '8000', pathname: '/media/**' },
    ],
  },
};

export default nextConfig;
