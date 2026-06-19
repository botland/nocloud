import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

// NOTE: Next.js 16 emits a build warning:
//   "The 'middleware' file convention is deprecated. Please use 'proxy' instead."
// See: https://nextjs.org/docs/messages/middleware-to-proxy
// We keep the conventional middleware.ts + next-intl createMiddleware because:
// - next-intl (v4) routing docs still recommend this exact pattern.
// - The matcher + locale detection / redirects work correctly for /en /fr.
// - Renaming to proxy.ts would require non-trivial next-intl + Next config changes
//   and risks breaking the existing [locale] layout + middleware-driven routing.
// If the warning becomes a hard error in a future release, we will migrate then.
// For now this is the lowest-risk approach (functionality > warning suppression).

export default createMiddleware(routing);

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)']
};
