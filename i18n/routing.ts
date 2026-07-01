import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['en', 'fr', 'de', 'es', 'it', 'nl', 'pl', 'sv'],
  defaultLocale: 'en',
});