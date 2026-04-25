import React, { useEffect, useRef, useState } from 'react';

interface VirtualizedChangeListProps<T> {
  items: T[];
  rowHeight: number;
  overscan?: number;
  className?: string;
  getKey: (item: T, index: number) => React.Key;
  renderRow: (item: T, index: number, style: React.CSSProperties) => React.ReactNode;
}

export default function VirtualizedChangeList<T>({
  items,
  rowHeight,
  overscan = 6,
  className = '',
  getKey,
  renderRow,
}: VirtualizedChangeListProps<T>) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const updateViewportHeight = () => setViewportHeight(viewport.clientHeight);
    updateViewportHeight();

    const resizeObserver = new ResizeObserver(updateViewportHeight);
    resizeObserver.observe(viewport);

    return () => resizeObserver.disconnect();
  }, []);

  const totalHeight = items.length * rowHeight;
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const endIndex = Math.min(
    items.length,
    Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan,
  );
  const visibleItems = items.slice(startIndex, endIndex);

  return (
    <div
      ref={viewportRef}
      className={`relative overflow-y-auto ${className}`}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div className="relative" style={{ height: totalHeight }}>
        {visibleItems.map((item, visibleIndex) => {
          const index = startIndex + visibleIndex;

          return (
            <React.Fragment key={getKey(item, index)}>
              {renderRow(item, index, {
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: rowHeight,
                transform: `translateY(${index * rowHeight}px)`,
              })}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
