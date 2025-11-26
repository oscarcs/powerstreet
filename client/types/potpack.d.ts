declare module "potpack" {
    interface Box {
        w: number;
        h: number;
        x?: number;
        y?: number;
    }

    interface PackResult {
        w: number;
        h: number;
        fill: number;
    }

    export default function potpack<T extends Box>(boxes: T[]): PackResult;
}
