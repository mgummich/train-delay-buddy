import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import de from './de.json'

void i18n.use(initReactI18next).init({
  lng: 'de',
  fallbackLng: 'de',
  resources: { de: { translation: de } },
  interpolation: { escapeValue: false },
})

export default i18n
