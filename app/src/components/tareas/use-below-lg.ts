import { useEffect, useState } from 'react';

/** true por debajo del breakpoint lg (1024px): vista móvil/tablet del shell. */
export function useBelowLg(): boolean {
  const [below, setBelow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches,
  );
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 1023px)');
    const onChange = () => setBelow(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return below;
}
