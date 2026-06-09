import type { MetadataRoute } from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/terms', '/privacy'],
        disallow: [
          '/dashboard',
          '/matters',
          '/bookings',
          '/billables',
          '/transactions',
          '/settings',
          '/lawyers',
          '/my-lawyers',
          '/accept-invite',
          '/reset-password',
          '/verify-email',
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
