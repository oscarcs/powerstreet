import * as React from "react";
import { useStore, useValue } from "tinybase/ui-react";
import { LandPlot, MousePointer2, SplinePointer, type LucideIcon } from "lucide-react";

import { Toolbar, ToolbarToggleGroup, ToolbarToggleItem } from "./components/toolbar";
import {
    Tooltip,
    TooltipArrow,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "./components/tooltip";
import { cn } from "./utils";

type ToolId = "select" | "draw-streets" | "zoning";

interface ToolDescriptor {
    id: ToolId;
    label: string;
    icon: LucideIcon;
}

const TOOLBAR_INITIAL_POSITION = { x: 24, y: 24 };

const tools: ToolDescriptor[] = [
    { id: "select", label: "Select", icon: MousePointer2 },
    { id: "draw-streets", label: "Draw Streets", icon: SplinePointer },
    { id: "zoning", label: "Zoning", icon: LandPlot },
];

export const MainToolbar = () => {
    const activeTool = (useValue("currentTool", "localStore") as ToolId | undefined);
    const store = useStore("localStore");
    const [position, setPosition] = React.useState(() => ({
        ...TOOLBAR_INITIAL_POSITION,
    }));
    const [isDragging, setIsDragging] = React.useState(false);
    const dragOffset = React.useRef({ x: 0, y: 0 });

    const handlePointerDown = React.useCallback(
        (event: React.PointerEvent<HTMLDivElement>) => {
            if (event.button !== 0) {
                return;
            }

            dragOffset.current = {
                x: event.clientX - position.x,
                y: event.clientY - position.y,
            };

            setIsDragging(true);
            event.currentTarget.setPointerCapture(event.pointerId);
            event.preventDefault();
        },
        [position.x, position.y],
    );

    const handlePointerMove = React.useCallback(
        (event: React.PointerEvent<HTMLDivElement>) => {
            if (!isDragging) {
                return;
            }

            setPosition({
                x: event.clientX - dragOffset.current.x,
                y: event.clientY - dragOffset.current.y,
            });
        },
        [isDragging],
    );

    const handlePointerUp = React.useCallback(
        (event: React.PointerEvent<HTMLDivElement>) => {
            if (!isDragging) {
                return;
            }

            setIsDragging(false);
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
            }
        },
        [isDragging],
    );

    const handlePointerCancel = React.useCallback(
        (event: React.PointerEvent<HTMLDivElement>) => {
            if (!isDragging) {
                return;
            }

            setIsDragging(false);
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
            }
        },
        [isDragging],
    );

    React.useEffect(() => {
        if (!isDragging) {
            return;
        }

        const previousUserSelect = document.body.style.userSelect;
        document.body.style.userSelect = "none";

        return () => {
            document.body.style.userSelect = previousUserSelect;
        };
    }, [isDragging]);

    return (
        <div
            className="pointer-events-auto absolute left-0 top-0 z-20"
            style={{
                transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
            }}
        >
            <Toolbar
                orientation="vertical"
                size="default"
                className="gap-0 p-0 shadow-lg shadow-black/10 backdrop-blur"
            >
                <div
                    data-toolbar-drag-handle
                    className={cn(
                        "h-3 w-full bg-muted/70 transition-colors hover:bg-muted/60",
                        "cursor-grab select-none touch-none",
                        isDragging && "cursor-grabbing bg-muted/50",
                    )}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerCancel}
                ></div>
                <TooltipProvider delayDuration={120} skipDelayDuration={250}>
                    <ToolbarToggleGroup
                        type="single"
                        orientation="vertical"
                        aria-label="Tool selection"
                        value={activeTool}
                        onValueChange={(value) => {
                            if (value) {
                                store?.setValue("currentTool", value);
                            } else {
                                store?.delValue("currentTool");
                            }
                        }}
                        className="items-stretch p-2"
                    >
                        {tools.map((tool) => {
                            const Icon = tool.icon;
                            return (
                                <Tooltip key={tool.id}>
                                    <TooltipTrigger asChild>
                                        <ToolbarToggleItem
                                            value={tool.id}
                                            size="icon"
                                            variant="ghost"
                                            aria-label={tool.label}
                                            className={cn(
                                                "transition-colors",
                                                activeTool === tool.id &&
                                                    "bg-blue-500 text-white shadow-lg shadow-blue-500/30 hover:bg-blue-500 hover:text-white",
                                            )}
                                        >
                                            <Icon className="size-5" />
                                        </ToolbarToggleItem>
                                    </TooltipTrigger>
                                    <TooltipContent
                                        side="right"
                                        align="center"
                                        collisionPadding={12}
                                    >
                                        {tool.label}
                                        <TooltipArrow />
                                    </TooltipContent>
                                </Tooltip>
                            );
                        })}
                    </ToolbarToggleGroup>
                </TooltipProvider>
            </Toolbar>
        </div>
    );
};
