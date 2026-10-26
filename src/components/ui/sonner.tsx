'use client';

import { Toast, ToastAction, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from '@/components/ui/sonner-core';

export { ToastProvider, ToastViewport };

export function Sonner({ position = 'bottom-right', richColors = true }: { position?: string; richColors?: boolean } = {}) {
  return (
    <ToastProvider>
      <ToastViewport position={position as any} richColors={richColors} />
    </ToastProvider>
  );
}