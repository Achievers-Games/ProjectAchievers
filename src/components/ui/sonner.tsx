import { Toaster, toast } from 'sonner';

export { Toaster, toast };

export function Sonner({
  position = 'bottom-right',
  richColors = true,
}: {
  position?: string;
  richColors?: boolean;
} = {}) {
  return (
    <Toaster position={position as any} richColors={richColors} />
  );
}
