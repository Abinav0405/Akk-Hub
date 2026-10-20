import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs) {
    return twMerge(clsx(inputs));
}

/** Old `createPageUrl('Page')` helper — hub code should use `paths` from '@/app/paths'. */
export function createPageUrl(pageName) {
    return `/${pageName}`;
}
