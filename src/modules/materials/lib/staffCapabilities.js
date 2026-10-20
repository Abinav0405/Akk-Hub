export function getStaffCapabilities(role) {
    const isAdmin = role === 'admin';
    const isManager = role === 'manager';
    return {
        isStaff: isAdmin || isManager,
        canDeleteTransactions: isAdmin,
        canViewAnalytics: isAdmin,
        canManageManagers: isAdmin,
        canProcessTransactions: isAdmin || isManager,
        canManageMaterials: isAdmin || isManager,
    };
}
