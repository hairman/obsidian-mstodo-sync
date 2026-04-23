import { moment } from 'obsidian';
import en from './locales/en.json';
import ru from './locales/ru.json';

const locales: { [key: string]: Record<string, unknown> } = {
    en: en as Record<string, unknown>,
    ru: ru as Record<string, unknown>,
};

/**
 * Функция для получения перевода по ключу (например, 'settings.title').
 * Поддерживает вложенность через точку.
 */
export function t(path: string, vars?: { [key: string]: string }): string {
    const lang = moment.locale();
    const locale = locales[lang] || locales['en'];
    
    const value = path.split('.').reduce<Record<string, unknown> | string | undefined>((obj, key) => {
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
            return (obj as Record<string, unknown>)[key] as Record<string, unknown> | string | undefined;
        }
        return undefined;
    }, locale);
    
    if (!value || typeof value !== 'string') {
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
