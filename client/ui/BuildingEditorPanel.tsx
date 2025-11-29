import * as React from "react";
import { useStore, useValue } from "tinybase/ui-react";
import { Plus, Trash2 } from "lucide-react";

import { getSortedBuildingSections, WorldsyncStore } from "../../shared/WorldsyncStore";
import { Card, CardContent, CardHeader, CardTitle } from "./components/card";
import { Input } from "./components/input";
import { Label } from "./components/label";
import { Separator } from "./components/separator";
import {
    Toolbar,
    ToolbarToggleGroup,
    ToolbarToggleItem,
    ToolbarSpacer,
    ToolbarButton,
} from "./components/toolbar";
import {
    Tooltip,
    TooltipArrow,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "./components/tooltip";
import { cn } from "./utils";

const PANEL_INITIAL_POSITION = { x: window.innerWidth - 288 - 16, y: 16 }; // 288 = w-72, 16 = spacing

export const BuildingEditorPanel = () => {
    const currentTool = useValue("currentTool", "localStore") as string | undefined;
    const selectedBuildingId = useValue("selectedBuildingId", "localStore") as string | undefined;
    const selectedSectionId = useValue("selectedSectionId", "localStore") as string | undefined;

    const localStore = useStore("localStore");
    const worldsyncStore = useStore("worldsyncStore");

    // Drag state for floating panel
    const [position, setPosition] = React.useState(() => ({
        ...PANEL_INITIAL_POSITION,
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

    // Get sections for this building
    const sections = React.useMemo(() => {
        if (!worldsyncStore || !selectedBuildingId) return [];
        return getSortedBuildingSections(worldsyncStore as unknown as WorldsyncStore, selectedBuildingId);
    }, [worldsyncStore, selectedBuildingId]);

    // Get current section data
    const currentSection = React.useMemo(() => {
        return sections.find((s) => s.sectionId === selectedSectionId) ?? null;
    }, [sections, selectedSectionId]);

    // Check if current section is the topmost (can be deleted)
    const isTopmostSection = React.useMemo(() => {
        if (!currentSection || sections.length === 0) return false;
        const maxIdx = Math.max(...sections.map((s) => s.sectionIdx));
        return currentSection.sectionIdx === maxIdx;
    }, [currentSection, sections]);

    // Get building data
    const building = React.useMemo(() => {
        if (!worldsyncStore || !selectedBuildingId) return null;
        return worldsyncStore.getRow("buildings", selectedBuildingId);
    }, [worldsyncStore, selectedBuildingId]);

    // Don't render if not in building tool mode or no building selected
    if (currentTool !== "building" || !selectedBuildingId) {
        return null;
    }

    const handleSectionChange = (sectionId: string) => {
        localStore?.setValue("selectedSectionId", sectionId);
    };

    const handleHeightChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!worldsyncStore || !selectedSectionId) return;
        const value = parseFloat(e.target.value);
        if (!isNaN(value)) {
            worldsyncStore.setCell("sections", selectedSectionId, "height", value);
        }
    };

    const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!worldsyncStore || !selectedSectionId) return;
        worldsyncStore.setCell("sections", selectedSectionId, "color", e.target.value);
    };

    const handleAddSection = () => {
        if (!worldsyncStore || !selectedBuildingId || sections.length === 0) return;

        // Find the topmost section to copy nodes from
        const topmostSection = sections.reduce((prev, curr) =>
            curr.sectionIdx > prev.sectionIdx ? curr : prev,
        );

        // New section will be placed on top (base elevation is computed from cumulative heights)
        const newSectionIdx = topmostSection.sectionIdx + 1;
        const newSectionId = crypto.randomUUID();

        // Create new section (baseElevation is no longer stored, it's computed)
        worldsyncStore.setRow("sections", newSectionId, {
            bldgId: selectedBuildingId,
            sectionIdx: newSectionIdx,
            height: topmostSection.height, // Copy height from previous section
            color: topmostSection.color, // Copy color from previous section
        });

        // Copy nodes from the topmost section
        const nodeIds = worldsyncStore.getRowIds("nodes");
        for (const nodeId of nodeIds) {
            const node = worldsyncStore.getRow("nodes", nodeId);
            if (node.sectionId === topmostSection.sectionId) {
                const newNodeId = crypto.randomUUID();
                worldsyncStore.setRow("nodes", newNodeId, {
                    sectionId: newSectionId,
                    x: node.x as number,
                    z: node.z as number,
                    idx: node.idx as number,
                });
            }
        }

        // Select the new section
        localStore?.setValue("selectedSectionId", newSectionId);
    };

    const handleRemoveSection = () => {
        if (
            !worldsyncStore ||
            !selectedSectionId ||
            !isTopmostSection ||
            sections.length <= 1
        ) {
            return;
        }

        // Delete all nodes belonging to this section
        const nodeIds = worldsyncStore.getRowIds("nodes");
        for (const nodeId of nodeIds) {
            const node = worldsyncStore.getRow("nodes", nodeId);
            if (node.sectionId === selectedSectionId) {
                worldsyncStore.delRow("nodes", nodeId);
            }
        }

        // Delete the section
        worldsyncStore.delRow("sections", selectedSectionId);

        // Select the new topmost section
        const remainingSections = sections.filter((s) => s.sectionId !== selectedSectionId);
        if (remainingSections.length > 0) {
            const newTopmost = remainingSections.reduce((prev, curr) =>
                curr.sectionIdx > prev.sectionIdx ? curr : prev,
            );
            localStore?.setValue("selectedSectionId", newTopmost.sectionId);
        }
    };

    return (
        <div
            className="pointer-events-auto absolute left-0 top-0 z-20 w-72"
            style={{
                transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
            }}
        >
            <Card className="gap-0 overflow-hidden py-0">
                {/* Drag handle */}
                <div
                    data-panel-drag-handle
                    className={cn(
                        "h-3 w-full bg-muted/70 transition-colors hover:bg-muted/60",
                        "cursor-grab select-none touch-none",
                        isDragging && "cursor-grabbing bg-muted/50",
                    )}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerCancel}
                />
                <CardHeader className="pb-0 pt-3">
                    <CardTitle>Building Editor</CardTitle>
                </CardHeader>

                <CardContent className="space-y-4">
                    {/* Section Selector */}
                    <div className="space-y-2">
                        <Label>Sections</Label>
                        <TooltipProvider delayDuration={120} skipDelayDuration={250}>
                            <Toolbar size="sm" className="w-full justify-between">
                                <ToolbarToggleGroup
                                    type="single"
                                    value={selectedSectionId ?? ""}
                                    onValueChange={(value) => {
                                        if (value) handleSectionChange(value);
                                    }}
                                    className="flex-wrap"
                                >
                                    {sections.map((section, index) => (
                                        <Tooltip key={section.sectionId}>
                                            <TooltipTrigger asChild>
                                                <ToolbarToggleItem
                                                    value={section.sectionId}
                                                    size="sm"
                                                    className="min-w-8 px-2"
                                                >
                                                    {index + 1}
                                                </ToolbarToggleItem>
                                            </TooltipTrigger>
                                            <TooltipContent side="bottom">
                                                <TooltipArrow />
                                                Section {index + 1}
                                            </TooltipContent>
                                        </Tooltip>
                                    ))}
                                </ToolbarToggleGroup>

                                <ToolbarSpacer />

                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <ToolbarButton
                                            size="sm"
                                            variant="ghost"
                                            onClick={handleAddSection}
                                        >
                                            <Plus className="size-4" />
                                        </ToolbarButton>
                                    </TooltipTrigger>
                                    <TooltipContent side="bottom">
                                        <TooltipArrow />
                                        Add section
                                    </TooltipContent>
                                </Tooltip>

                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <ToolbarButton
                                            size="sm"
                                            variant="ghost"
                                            onClick={handleRemoveSection}
                                            disabled={!isTopmostSection || sections.length <= 1}
                                        >
                                            <Trash2 className="size-4" />
                                        </ToolbarButton>
                                    </TooltipTrigger>
                                    <TooltipContent side="bottom">
                                        <TooltipArrow />
                                        {sections.length <= 1
                                            ? "Cannot remove last section"
                                            : !isTopmostSection
                                              ? "Can only remove topmost section"
                                              : "Remove section"}
                                    </TooltipContent>
                                </Tooltip>
                            </Toolbar>
                        </TooltipProvider>
                    </div>

                    <Separator />

                    {/* Section Properties */}
                    {currentSection && (
                        <div className="space-y-3">
                            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                                Section Properties
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1.5">
                                    <Label htmlFor="baseElevation" className="text-xs">
                                        Base Elevation
                                    </Label>
                                    <Input
                                        id="baseElevation"
                                        type="number"
                                        value={currentSection.computedBaseElevation.toFixed(1)}
                                        disabled
                                        className="h-8 bg-muted"
                                    />
                                </div>

                                <div className="space-y-1.5">
                                    <Label htmlFor="height" className="text-xs">
                                        Height
                                    </Label>
                                    <Input
                                        id="height"
                                        type="number"
                                        step="0.5"
                                        min="0.1"
                                        value={currentSection.height}
                                        onChange={handleHeightChange}
                                        className="h-8"
                                    />
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <Label htmlFor="color" className="text-xs">
                                    Color
                                </Label>
                                <div className="flex gap-2">
                                    <Input
                                        id="color"
                                        type="color"
                                        value={currentSection.color}
                                        onChange={handleColorChange}
                                        className="h-8 w-12 p-1 cursor-pointer"
                                    />
                                    <Input
                                        type="text"
                                        value={currentSection.color}
                                        onChange={handleColorChange}
                                        className="h-8 flex-1 font-mono text-xs"
                                        placeholder="#b8c4ce"
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    <Separator />

                    {/* Building Properties */}
                    <div className="space-y-3">
                        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                            Roof
                        </div>

                        <div className="space-y-1.5">
                            <Label className="text-xs">Roof Type</Label>
                            <Toolbar size="sm" className="w-full">
                                <ToolbarToggleGroup
                                    type="single"
                                    value={(building?.roofType as string) ?? "flat"}
                                    onValueChange={(value) => {
                                        if (value && worldsyncStore && selectedBuildingId) {
                                            worldsyncStore.setCell(
                                                "buildings",
                                                selectedBuildingId,
                                                "roofType",
                                                value,
                                            );
                                        }
                                    }}
                                    className="flex-1"
                                >
                                    <ToolbarToggleItem value="flat" size="sm" className="flex-1">
                                        Flat
                                    </ToolbarToggleItem>
                                </ToolbarToggleGroup>
                            </Toolbar>
                        </div>
                    </div>
                </CardContent>
                <div className="h-4" /> {/* Bottom spacing */}
            </Card>
        </div>
    );
};
