export function filterAndSortMaterials(materials, {
    searchTerm = '',
    stockFilter = 'all',
    unitFilter = 'all',
    sortMode = 'reference',
    lowStockThreshold = 5,
} = {}) {
    const term = searchTerm.trim().toLowerCase();
    return materials
        .filter((material) => {
            const matchesSearch =
                String(material.name || '').toLowerCase().includes(term) ||
                String(material.reference_number ?? '').toLowerCase().includes(term);
            const matchesUnit = unitFilter === 'all' || material.unit === unitFilter;
            const matchesStock =
                stockFilter === 'all' ||
                (stockFilter === 'in' && material.quantity > lowStockThreshold) ||
                (stockFilter === 'low' && material.quantity > 0 && material.quantity <= lowStockThreshold) ||
                (stockFilter === 'out' && material.quantity === 0);
            return matchesSearch && matchesUnit && matchesStock;
        })
        .sort((a, b) => {
            if (sortMode === 'name') return String(a.name).localeCompare(String(b.name));
            if (sortMode === 'quantity-asc') return a.quantity - b.quantity;
            if (sortMode === 'quantity-desc') return b.quantity - a.quantity;
            return String(a.reference_number).localeCompare(
                String(b.reference_number),
                undefined,
                { numeric: true },
            );
        });
}
