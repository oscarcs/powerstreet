"use client";

import * as React from "react";
import * as ToolbarPrimitive from "@radix-ui/react-toolbar";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../utils";

const toolbarVariants = cva(
    "flex overflow-hidden rounded-lg border border-border bg-background/95 shadow-sm supports-[backdrop-filter]:bg-background/60 text-foreground",
    {
        variants: {
            size: {
                sm: "min-h-9 gap-1 text-xs",
                default: "min-h-10 gap-1.5 text-sm",
                lg: "min-h-11 gap-2 text-base",
            },
            orientation: {
                horizontal: "flex-row items-center",
                vertical: "flex-col items-stretch",
            },
        },
        defaultVariants: {
            size: "default",
            orientation: "horizontal",
        },
    },
);

type ToolbarProps = React.ComponentPropsWithoutRef<typeof ToolbarPrimitive.Root> &
    VariantProps<typeof toolbarVariants>;

const Toolbar = React.forwardRef<React.ElementRef<typeof ToolbarPrimitive.Root>, ToolbarProps>(
    function Toolbar({ className, size, orientation = "horizontal", ...props }, ref) {
        return (
            <ToolbarPrimitive.Root
                ref={ref}
                orientation={orientation}
                data-slot="toolbar"
                className={cn(toolbarVariants({ size, orientation }), className)}
                {...props}
            />
        );
    },
);

const toolbarItemVariants = cva(
    "inline-flex items-center justify-center rounded-md border border-transparent bg-transparent font-medium transition-colors outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground hover:bg-muted/60 hover:text-foreground data-[state=on]:hover:bg-accent data-[state=on]:hover:text-accent-foreground",
    {
        variants: {
            variant: {
                default: "text-foreground",
                ghost: "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                subtle: "bg-muted/40 text-muted-foreground hover:text-foreground data-[state=on]:bg-muted/80 data-[state=on]:text-foreground",
                outline: "border-border text-foreground hover:bg-muted/30",
            },
            size: {
                sm: "h-8 gap-1.5 px-2 text-xs",
                default: "h-9 gap-1.5 px-2.5 text-sm",
                lg: "h-10 gap-2 px-3 text-base",
                icon: "size-9 gap-0 p-0 text-sm",
            },
        },
        defaultVariants: {
            variant: "default",
            size: "default",
        },
    },
);

type ToolbarItemProps = VariantProps<typeof toolbarItemVariants>;

type ToolbarButtonProps = React.ComponentPropsWithoutRef<typeof ToolbarPrimitive.Button> &
    ToolbarItemProps;

const ToolbarButton = React.forwardRef<
    React.ElementRef<typeof ToolbarPrimitive.Button>,
    ToolbarButtonProps
>(function ToolbarButton({ className, variant, size, ...props }, ref) {
    return (
        <ToolbarPrimitive.Button
            ref={ref}
            data-slot="toolbar-button"
            className={cn(toolbarItemVariants({ variant, size }), className)}
            {...props}
        />
    );
});

type ToolbarToggleItemProps = React.ComponentPropsWithoutRef<typeof ToolbarPrimitive.ToggleItem> &
    ToolbarItemProps;

const ToolbarToggleItem = React.forwardRef<
    React.ElementRef<typeof ToolbarPrimitive.ToggleItem>,
    ToolbarToggleItemProps
>(function ToolbarToggleItem({ className, variant, size, ...props }, ref) {
    return (
        <ToolbarPrimitive.ToggleItem
            ref={ref}
            data-slot="toolbar-toggle-item"
            className={cn(toolbarItemVariants({ variant, size }), className)}
            {...props}
        />
    );
});

type ToolbarToggleGroupProps = React.ComponentPropsWithoutRef<typeof ToolbarPrimitive.ToggleGroup>;

const ToolbarToggleGroup = React.forwardRef<
    React.ElementRef<typeof ToolbarPrimitive.ToggleGroup>,
    ToolbarToggleGroupProps
>(function ToolbarToggleGroup({ className, ...props }, ref) {
    return (
        <ToolbarPrimitive.ToggleGroup
            ref={ref}
            data-slot="toolbar-toggle-group"
            className={cn(
                "flex items-center gap-1.5 data-[orientation=vertical]:flex-col data-[orientation=vertical]:items-stretch",
                className,
            )}
            {...props}
        />
    );
});

type ToolbarGroupProps = React.ComponentProps<"div">;

const ToolbarGroup = React.forwardRef<HTMLDivElement, ToolbarGroupProps>(function ToolbarGroup(
    { className, ...props },
    ref,
) {
    return (
        <div
            ref={ref}
            data-slot="toolbar-group"
            className={cn("flex items-center gap-1.5", className)}
            {...props}
        />
    );
});

type ToolbarSeparatorProps = React.ComponentPropsWithoutRef<typeof ToolbarPrimitive.Separator>;

const ToolbarSeparator = React.forwardRef<
    React.ElementRef<typeof ToolbarPrimitive.Separator>,
    ToolbarSeparatorProps
>(function ToolbarSeparator({ className, ...props }, ref) {
    return (
        <ToolbarPrimitive.Separator
            ref={ref}
            data-slot="toolbar-separator"
            className={cn(
                "bg-border my-1.5 h-px w-full shrink-0 data-[orientation=vertical]:mx-1.5 data-[orientation=vertical]:my-0 data-[orientation=vertical]:h-6 data-[orientation=vertical]:w-px",
                className,
            )}
            {...props}
        />
    );
});

type ToolbarLinkProps = React.ComponentPropsWithoutRef<typeof ToolbarPrimitive.Link> &
    ToolbarItemProps;

const ToolbarLink = React.forwardRef<
    React.ElementRef<typeof ToolbarPrimitive.Link>,
    ToolbarLinkProps
>(function ToolbarLink({ className, variant, size, ...props }, ref) {
    return (
        <ToolbarPrimitive.Link
            ref={ref}
            data-slot="toolbar-link"
            className={cn(toolbarItemVariants({ variant, size }), className)}
            {...props}
        />
    );
});

type ToolbarTextProps = React.ComponentProps<"span">;

const ToolbarText = React.forwardRef<HTMLSpanElement, ToolbarTextProps>(function ToolbarText(
    { className, ...props },
    ref,
) {
    return (
        <span
            ref={ref}
            data-slot="toolbar-text"
            className={cn("text-sm text-muted-foreground", className)}
            {...props}
        />
    );
});

type ToolbarSpacerProps = React.ComponentProps<"div">;

const ToolbarSpacer = React.forwardRef<HTMLDivElement, ToolbarSpacerProps>(function ToolbarSpacer(
    { className, ...props },
    ref,
) {
    return (
        <div
            ref={ref}
            data-slot="toolbar-spacer"
            className={cn("flex-1", className)}
            aria-hidden
            {...props}
        />
    );
});

Toolbar.displayName = ToolbarPrimitive.Root.displayName;
ToolbarButton.displayName = ToolbarPrimitive.Button.displayName;
ToolbarToggleItem.displayName = ToolbarPrimitive.ToggleItem.displayName;
ToolbarToggleGroup.displayName = ToolbarPrimitive.ToggleGroup.displayName;
ToolbarGroup.displayName = "ToolbarGroup";
ToolbarSeparator.displayName = ToolbarPrimitive.Separator.displayName;
ToolbarLink.displayName = ToolbarPrimitive.Link.displayName;
ToolbarText.displayName = "ToolbarText";
ToolbarSpacer.displayName = "ToolbarSpacer";

export {
    Toolbar,
    ToolbarButton,
    ToolbarGroup,
    ToolbarLink,
    ToolbarSeparator,
    ToolbarSpacer,
    ToolbarText,
    ToolbarToggleGroup,
    ToolbarToggleItem,
    toolbarVariants,
};
