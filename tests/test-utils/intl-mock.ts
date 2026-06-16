import { vi } from 'vitest'

/** Hoist-safe next-intl mock for component tests. Call via vi.mock in each test file. */
export const nextIntlMock = {
  useTranslations: (namespace?: string) => {
    const prefix = namespace ? `${namespace}.` : ''
    const t = (key: string, values?: Record<string, unknown>) => {
      if (!values) return `${prefix}${key}`
      const serialized = Object.entries(values)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(',')
      return `${prefix}${key}(${serialized})`
    }
    return t
  },
  useLocale: () => 'en',
}

export function mockNextIntl() {
  vi.mock('next-intl', () => nextIntlMock)
}