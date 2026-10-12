import type { ComponentProps } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

export function MapToolButton({ label, className = '', ...props }: ComponentProps<typeof Button> & { label: string }) {
  return <TooltipProvider delayDuration={300}>
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" {...props} aria-label={label}
          className={`vessel-map-tool-button ${className}`} />
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end" sideOffset={8}>{label}</TooltipContent>
    </Tooltip>
  </TooltipProvider>;
}
