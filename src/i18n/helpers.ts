import { moment } from 'obsidian';
import en from './locales/en.json';
import ru from './locales/ru.json';

const locales: { [key: string]: any } = {
    en,
    ru,
};

/**
 * Функция для получения перевода по ключу (например, 'settings.title').
 * Поддерживает вложенность через точку.
 */
export function t(path: string, vars?: { [key: string]: string }): string {
    const lang = (window as any).moment.locale();
    const locale = locales[lang] || locales['en'];
    
    const value = path.split('.').reduce((obj, key) => obj?.[key], locale);
    
    if (!value) {
        console.warn(`[MsTodoSync] Translation missing for key: ${path}`);
        return path;
    }

    if (vars) {
        let result = value;
        for (const [key, val] of Object.entries(vars)) {
            result = result.replace(`{{${key}}}`, val);
        }
        return result;
    }

    return value;
}
