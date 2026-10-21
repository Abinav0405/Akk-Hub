import { createContext, useContext } from 'react';

const AdminDashContext = createContext(null);

export function AdminDashProvider({ value, children }) {
  return <AdminDashContext.Provider value={value}>{children}</AdminDashContext.Provider>;
}

export function useAdminDash() {
  const value = useContext(AdminDashContext);
  if (!value) {
    throw new Error('useAdminDash must be used within AdminDashProvider');
  }
  return value;
}
