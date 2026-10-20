import { useEffect, useRef, useState } from 'react';

/**
 * Render a long list in pages: the first `pageSize` items immediately, then
 * the next page whenever a sentinel near the bottom scrolls into view.
 * `resetKey` (e.g. the active filters) starts again from the first page.
 *
 * Used by the native lists, which can hold up to 5,000 transactions.
 */
export function useProgressiveList(items, { pageSize = 30, resetKey } = {}) {
  const [limit, setLimit] = useState(pageSize);
  const sentinelRef = useRef(null);
  const total = items.length;

  useEffect(() => {
    setLimit(pageSize);
  }, [resetKey, pageSize]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || limit >= total || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setLimit((current) => current + pageSize);
      },
      { rootMargin: '800px 0px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [limit, total, pageSize]);

  return {
    visible: limit >= total ? items : items.slice(0, limit),
    hasMore: limit < total,
    sentinelRef,
  };
}
