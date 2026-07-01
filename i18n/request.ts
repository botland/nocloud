import { getRequestConfig } from 'next-intl/server';
import { hasLocale } from 'next-intl';
import { routing } from './routing';
import en from '../locales/en.json';
import fr from '../locales/fr.json';

const messagesByLocale = { en, fr } as const;
type MessageLocale = keyof typeof messagesByLocale;

function resolveMessages(locale: string) {
  if (locale in messagesByLocale) {
    return messagesByLocale[locale as MessageLocale];
  }
  return messagesByLocale.en;
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  return {
    locale,
    messages: resolveMessages(locale),
  };
});