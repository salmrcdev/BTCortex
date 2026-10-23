import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { enGB } from './en-GB';

export const DEFAULT_LANGUAGE = 'en-GB';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof enGB };
  }
}

export async function initialiseI18n(): Promise<void> {
  await i18next.use(initReactI18next).init({
    lng: DEFAULT_LANGUAGE,
    fallbackLng: DEFAULT_LANGUAGE,
    resources: { [DEFAULT_LANGUAGE]: { translation: enGB } },
    // React already escapes interpolated values.
    interpolation: { escapeValue: false },
  });
}

export { i18next };
