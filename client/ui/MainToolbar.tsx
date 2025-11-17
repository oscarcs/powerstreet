import * as React from "react"
import {
    Building,
    LandPlot,
    MousePointer2,
    SplinePointer,
    type LucideIcon,
} from "lucide-react"

import {
    Toolbar,
    ToolbarSeparator,
    ToolbarToggleGroup,
    ToolbarToggleItem,
} from "./components/toolbar"
import {
    Tooltip,
    TooltipArrow,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "./components/tooltip"
import { cn } from "./utils"

type ToolId = "select" | "draw-streets" | "zoning" | "building"

interface ToolDescriptor {
    id: ToolId
    label: string
    icon: LucideIcon
}

const TOOLBAR_INITIAL_POSITION = { x: 24, y: 24 }

const tools: ToolDescriptor[] = [
    { id: "select", label: "Select", icon: MousePointer2 },
    { id: "draw-streets", label: "Draw Streets", icon: SplinePointer },
    { id: "zoning", label: "Zoning", icon: LandPlot },
    { id: "building", label: "Building", icon: Building },
]

export const MainToolbar = () => {
    const [activeTool, setActiveTool] = React.useState<ToolId>("select")
    const [position, setPosition] = React.useState(() => ({ ...TOOLBAR_INITIAL_POSITION }))
    const [isDragging, setIsDragging] = React.useState(false)
    const dragOffset = React.useRef({ x: 0, y: 0 })

    const handlePointerDown = React.useCallback(
        (event: React.PointerEvent<HTMLDivElement>) => {
            if (event.button !== 0) {
                return
            }

            dragOffset.current = {
                x: event.clientX - position.x,
                y: event.clientY - position.y,
            }

            setIsDragging(true)
            event.currentTarget.setPointerCapture(event.pointerId)
            event.preventDefault()
        },
        [position.x, position.y]
    )

    const handlePointerMove = React.useCallback(
        (event: React.PointerEvent<HTMLDivElement>) => {
            if (!isDragging) {
                return
            }

            setPosition({
                x: event.clientX - dragOffset.current.x,
                y: event.clientY - dragOffset.current.y,
            })
        },
        [isDragging]
    )

    const handlePointerUp = React.useCallback(
        (event: React.PointerEvent<HTMLDivElement>) => {
            if (!isDragging) {
                return
            }

            setIsDragging(false)
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId)
            }
        },
        [isDragging]
    )

    const handlePointerCancel = React.useCallback(
        (event: React.PointerEvent<HTMLDivElement>) => {
            if (!isDragging) {
                return
            }

            setIsDragging(false)
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId)
            }
        },
        [isDragging]
    )

    React.useEffect(() => {
        if (!isDragging) {
            return
        }

        const previousUserSelect = document.body.style.userSelect
        document.body.style.userSelect = "none"

        return () => {
            document.body.style.userSelect = previousUserSelect
        }
    }, [isDragging])

    return (
        <div
            className="pointer-events-auto absolute left-0 top-0 z-20"
            style={{ transform: `translate3d(${position.x}px, ${position.y}px, 0)` }}
        >
            <Toolbar
                orientation="vertical"
                size="default"
                className="gap-2 p-2 shadow-lg shadow-black/10 backdrop-blur"
            >
                <div
                    data-toolbar-drag-handle
                    className={cn(
                        "rounded-md px-2 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground transition-colors",
                        "cursor-grab select-none touch-none",
                        isDragging && "cursor-grabbing text-foreground"
                    )}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerCancel}
                >
                </div>
                <ToolbarSeparator />
                <TooltipProvider delayDuration={120} skipDelayDuration={250}>
                    <ToolbarToggleGroup
                        type="single"
                        orientation="vertical"
                        aria-label="Tool selection"
                        value={activeTool}
                        onValueChange={(value) => {
                            if (!value) {
                                return
                            }

                            setActiveTool(value as ToolId)
                        }}
                        className="items-stretch"
                    >
                        {tools.map((tool) => {
                            const Icon = tool.icon
                            return (
                                <Tooltip key={tool.id}>
                                    <TooltipTrigger asChild>
                                        <ToolbarToggleItem
                                            value={tool.id}
                                            size="icon"
                                            variant="ghost"
                                            aria-label={tool.label}
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
                            )
                        })}
                    </ToolbarToggleGroup>
                </TooltipProvider>
            </Toolbar>
        </div>
    )
}
