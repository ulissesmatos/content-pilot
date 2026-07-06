'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Recarrega os dados do RSC em intervalo fixo enquanto `enabled` (runs em andamento). */
export function AutoRefresh({ enabled, intervalMs = 3000 }: { enabled: boolean; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [enabled, intervalMs, router]);
  return null;
}
