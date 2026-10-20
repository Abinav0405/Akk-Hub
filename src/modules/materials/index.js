// Public exports — materials module (Wave 1 M-LIB + Wave 2 SMALL-PAGES)
export * from './lib/utils';
export * from './lib/inventory';
export * from './lib/dates';
export { default as MaterialForm } from './components/MaterialForm';
export { default as MaterialInput } from './components/MaterialInput';
export { default as MaterialsManager } from './components/MaterialsManager';
export { default as RequestersManager } from './components/RequestersManager';
export { default as SitesManager } from './components/SitesManager';
export { default as ManagersManager } from './components/ManagersManager';
export { default as AdminAnalytics } from './components/AdminAnalytics';

export { default as RequestHistory } from './pages/RequestHistory';
export { default as History } from './pages/History';

// LEGACY-PAGES
export { default as RequestPortal } from './pages/RequestPortal';
export { default as AdminDashboard } from './pages/AdminDashboard';
export { default as ManagerDashboard } from './pages/ManagerDashboard';
