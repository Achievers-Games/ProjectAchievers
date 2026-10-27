import * as React from 'react';
import { cn } from '@/lib/utils';

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number;
}

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('shrink-0 overflow-hidden rounded-full h-4 w-full bg-secondary', className)}
      {...props}
    >
      <div className="h-full bg-primary w-full" style={{ width: `${value ?? 0}%` }} />
    </div>
  )
);
Progress.displayName = 'Progress';

export { Progress };