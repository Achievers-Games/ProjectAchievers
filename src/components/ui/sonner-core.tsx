'use client';

import * as React from 'react';
import * as ToastPrimitives from '@radix-ui/react-toggle-group'; // fallback
import {
  ToastProvider as ToastProviderPrimitive,
  ToastViewport as ToastViewportPrimitive,
  Toast as ToastPrimitive,
  ToastAction as ToastActionPrimitive,
  ToastClose as ToastClosePrimitive,
  ToastTitle as ToastTitlePrimitive,
  ToastDescription as ToastDescriptionPrimitive,
} from '@/components/ui/sonner-primitive';

// Re-export types from sonner-primitive
export {
  ToastProviderPrimitive as ToastProvider,
  ToastViewportPrimitive as ToastViewport,
  ToastPrimitive as Toast,
  ToastActionPrimitive as ToastAction,
  ToastClosePrimitive as ToastClose,
  ToastTitlePrimitive as ToastTitle,
  ToastDescriptionPrimitive as ToastDescription,
};

// Simple toast component
export function Toast({ className, ...props }: any) {
  return (
    <ToastPrimitive className={className} {...props} />
  );
}