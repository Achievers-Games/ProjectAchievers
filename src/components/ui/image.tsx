import * as React from 'react';
import { cn } from '@/lib/utils';

interface ImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  alt: string;
}

export function Image({ className, ...props }: ImageProps) {
  return (
    <img
      className={cn('max-w-full h-auto inline-block', className)}
      {...props}
      decoding="async"
      loading="lazy"
    />
  );
}