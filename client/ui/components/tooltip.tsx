"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

import { cn } from "../utils";

const TooltipProvider = TooltipPrimitive.Provider;

const Tooltip = TooltipPrimitive.Root;

const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipPortal = TooltipPrimitive.Portal;

const TooltipContent = React.forwardRef<
    React.ElementRef<typeof TooltipPrimitive.Content>,
    React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(function TooltipContent({ className, sideOffset = 6, ...props }, ref) {
    return (
        <TooltipPortal>
            <TooltipPrimitive.Content
                ref={ref}
                sideOffset={sideOffset}
                className={cn(
                    "z-50 overflow-hidden rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-lg backdrop-blur",
                    "data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95",
                    "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
                    "data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1",
                    className,
                )}
                {...props}
            />
        </TooltipPortal>
    );
});

const TooltipArrow = React.forwardRef<
    React.ElementRef<typeof TooltipPrimitive.Arrow>,
    React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Arrow>
>(function TooltipArrow({ className, ...props }, ref) {
    return (
        <TooltipPrimitive.Arrow ref={ref} className={cn("fill-border/80", className)} {...props} />
    );
});

Tooltip.displayName = TooltipPrimitive.Root.displayName;
TooltipTrigger.displayName = TooltipPrimitive.Trigger.displayName;
TooltipPortal.displayName = TooltipPrimitive.Portal.displayName;
TooltipProvider.displayName = TooltipPrimitive.Provider.displayName;
TooltipContent.displayName = TooltipPrimitive.Content.displayName;
TooltipArrow.displayName = TooltipPrimitive.Arrow.displayName;

export { Tooltip, TooltipArrow, TooltipContent, TooltipPortal, TooltipProvider, TooltipTrigger };
