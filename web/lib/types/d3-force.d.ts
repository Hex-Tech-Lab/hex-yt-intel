declare module 'd3-force' {
  export function forceCollide<NodeDatum = any>(radius?: number | ((node: NodeDatum, index: number, groups: NodeDatum[]) => number)): any;
  export function forceCenter<NodeDatum = any>(x?: number, y?: number): any;
  export function forceManyBody<NodeDatum = any>(): any;
  export function forceLink<NodeDatum = any, LinkDatum = any>(links?: LinkDatum[]): any;
  export function forceX<NodeDatum = any>(x?: number | ((node: NodeDatum, index: number, groups: NodeDatum[]) => number)): any;
  export function forceY<NodeDatum = any>(y?: number | ((node: NodeDatum, index: number, groups: NodeDatum[]) => number)): any;
  export function forceRadial<NodeDatum = any>(radius: number | ((node: NodeDatum, index: number, groups: NodeDatum[]) => number), x?: number, y?: number): any;
}
