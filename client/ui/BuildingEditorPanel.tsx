import * as React from "react";
import { useStore, useValue, useTable, useRow } from "tinybase/ui-react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "./components/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/card";
import { Input } from "./components/input";
import { Label } from "./components/label";
import { Separator } from "./components/separator";
import {
    Toolbar,
    ToolbarToggleGroup,
    ToolbarToggleItem,
} from "./components/toolbar";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "./components/tooltip";
import { cn } from "./utils";

const PANEL_INITIAL_POSITION = { x: 24, y: 200 };

interface SectionItemProps {
    sectionId: string;
    index: number;
    height: number;
    baseElevation: number;
    isTopmost: boolean;
    onHeightChange: (id: string, height: number) => void;
    onDelete: (id: string) => void;
}

const SectionItem = ({
    sectionId,
    index,
    height,
    baseElevation,
    isTopmost,
    onHeightChange,
    onDelete,
}: SectionItemProps) => {
    // Local state to handle input editing without cursor jumping
    const [localHeight, setLocalHeight] = React.useState(String(height));

    // Sync local state when prop changes (e.g. from undo/redo or other updates),
    // but only if we're not currently editing (this is hard to know perfectly, 
    // but checking if the parsed value matches helps).
    React.useEffect(() => {
        if (parseFloat(localHeight) !== height) {
            setLocalHeight(String(height));
        }
    }, [height]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const valStr = e.target.value;
        setLocalHeight(valStr);
        
        const val = parseFloat(valStr);
        if (!isNaN(val) && val > 0) {
            onHeightChange(sectionId, val);
        }
    };

    return (
        <div className="rounded-md border bg-muted/30 p-3 space-y-3">
            <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Section {index + 1}
                </span>
                {isTopmost && (
                    <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0 hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => onDelete(sectionId)}
                    >
                        <Trash2 className="size-3.5" />
                    </Button>
                )}
            </div>

            <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                    <Label className="text-[10px] text-muted-foreground">Base Elev.</Label>
                    <Input
                        type="number"
                        value={baseElevation.toFixed(1)}
                        disabled
                        className="h-7 bg-muted text-xs"
                    />
                </div>
                <div className="space-y-1.5">
                    <Label className="text-[10px] text-muted-foreground">Height</Label>
                    <Input
                        type="number"
                        step="0.5"
                        min="0.1"
                        value={localHeight}
                        onChange={handleInputChange}
                        className="h-7 text-xs"
                    />
                </div>
            </div>
        </div>
    );
};

export const BuildingEditorPanel = () => {
    const currentTool = useValue("currentTool", "localStore") as string | undefined;
    const selectedBuildingId = useValue("selectedBuildingId", "localStore") as string | undefined;

    const worldsyncStore = useStore("worldsyncStore");

    // Subscribe to tables/rows to ensure reactivity
    const sectionsTable = useTable("sections", "worldsyncStore");
    const buildingRow = useRow("buildings", selectedBuildingId || "", "worldsyncStore");

    // Drag state for floating panel
    const [position, setPosition] = React.useState(() => ({
        ...PANEL_INITIAL_POSITION,
    }));
    const [isDragging, setIsDragging] = React.useState(false);
    const dragOffset = React.useRef({ x: 0, y: 0 });

    const handlePointerDown = React.useCallback(
        (event: React.PointerEvent<HTMLDivElement>) => {
            if (event.button !== 0) return;
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
            if (!isDragging) return;
            setPosition({
                x: event.clientX - dragOffset.current.x,
                y: event.clientY - dragOffset.current.y,
            });
        },
        [isDragging],
    );

    const handlePointerUp = React.useCallback(
        (event: React.PointerEvent<HTMLDivElement>) => {
            if (!isDragging) return;
            setIsDragging(false);
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
            }
        },
        [isDragging],
    );

    React.useEffect(() => {
        if (!isDragging) return;
        const previousUserSelect = document.body.style.userSelect;
        document.body.style.userSelect = "none";
        return () => {
            document.body.style.userSelect = previousUserSelect;
        };
    }, [isDragging]);

    // Compute sections data
    const sectionsData = React.useMemo(() => {
        if (!selectedBuildingId || !sectionsTable) return [];

        const buildingBaseElevation = (buildingRow?.baseElevation as number) || 0;
        
        const relevantSections = Object.entries(sectionsTable)
            .filter(([_, section]) => section.bldgId === selectedBuildingId)
            .map(([id, section]) => ({
                id,
                ...section,
                sectionIdx: section.sectionIdx as number,
                height: section.height as number,
            }))
            .sort((a, b) => a.sectionIdx - b.sectionIdx);

        let cumulativeHeight = buildingBaseElevation;
        return relevantSections.map(section => {
            const computedBaseElevation = cumulativeHeight;
            cumulativeHeight += section.height;
            return { ...section, computedBaseElevation };
        });
    }, [selectedBuildingId, sectionsTable, buildingRow]);

    // Don't render if not in building tool mode or no building selected
    if (currentTool !== "select" || !selectedBuildingId) {
        return null;
    }

    const handleHeightChange = (sectionId: string, newHeight: number) => {
        if (!worldsyncStore) return;
        worldsyncStore.setCell("sections", sectionId, "height", newHeight);
    };

    const handleAddSection = () => {
        if (!worldsyncStore || !selectedBuildingId || sectionsData.length === 0) return;

        const topmostSection = sectionsData[sectionsData.length - 1];
        const newSectionIdx = topmostSection.sectionIdx + 1;
        const newSectionId = crypto.randomUUID();

        worldsyncStore.setRow("sections", newSectionId, {
            bldgId: selectedBuildingId,
            sectionIdx: newSectionIdx,
            height: topmostSection.height,
        });

        // Copy nodes from the topmost section
        const nodeIds = worldsyncStore.getRowIds("nodes");
        for (const nodeId of nodeIds) {
            const node = worldsyncStore.getRow("nodes", nodeId);
            if (node.sectionId === topmostSection.id) {
                const newNodeId = crypto.randomUUID();
                worldsyncStore.setRow("nodes", newNodeId, {
                    sectionId: newSectionId,
                    x: node.x as number,
                    z: node.z as number,
                    idx: node.idx as number,
                });
            }
        }
    };

    const handleRemoveSection = (sectionId: string) => {
        if (!worldsyncStore) return;

        // Delete all nodes belonging to this section
        const nodeIds = worldsyncStore.getRowIds("nodes");
        for (const nodeId of nodeIds) {
            const node = worldsyncStore.getRow("nodes", nodeId);
            if (node.sectionId === sectionId) {
                worldsyncStore.delRow("nodes", nodeId);
            }
        }

        // Delete the section
        worldsyncStore.delRow("sections", sectionId);
    };

    return (
        <div
            className="pointer-events-auto absolute left-0 top-0 z-20 w-72"
            style={{
                transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
            }}
        >
            <Card className="gap-0 overflow-hidden py-0 shadow-lg">
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
                />
                <CardHeader className="pb-2 pt-3">
                    <CardTitle className="flex items-center justify-between">
                        <span>Building Editor</span>
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 max-h-[80vh] overflow-y-auto">
                    
                    {/* Sections List */}
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <Label>Sections</Label>
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="h-6 px-2 text-xs"
                                            onClick={handleAddSection}
                                        >
                                            <Plus className="mr-1 size-3" />
                                            Add Section
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Add new section on top</TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        </div>

                        <div className="space-y-2">
                            {sectionsData.map((section, index) => (
                                <SectionItem
                                    key={section.id}
                                    sectionId={section.id}
                                    index={index}
                                    height={section.height}
                                    baseElevation={section.computedBaseElevation}
                                    isTopmost={index === sectionsData.length - 1 && sectionsData.length > 1}
                                    onHeightChange={handleHeightChange}
                                    onDelete={handleRemoveSection}
                                />
                            ))}
                        </div>
                    </div>

                    <Separator />

                    {/* Building Properties */}
                    <div className="space-y-3">
                        <div className="space-y-1.5">
                            <Label className="text-xs">Roof Type</Label>
                            <Toolbar size="sm" className="w-full">
                                <ToolbarToggleGroup
                                    type="single"
                                    value={(buildingRow?.roofType as string) || "flat"}
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
                                    {/* Add more roof types here if needed */}
                                </ToolbarToggleGroup>
                            </Toolbar>
                        </div>
                    </div>
                </CardContent>
                <div className="h-4" />
            </Card>
        </div>
    );
};
