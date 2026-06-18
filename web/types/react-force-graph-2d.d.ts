declare module 'react-force-graph-2d' {
  import { Component } from 'react';

  interface ForceGraphProps<N, L> {
    ref?: React.RefObject<ForceGraphInstance | null>;
    width?: number;
    height?: number;
    graphData?: { nodes: N[]; links: L[] };
    backgroundColor?: string;
    cooldownTicks?: number;
    onEngineStop?: () => void;
    nodeRelSize?: number;
    nodeVal?: (node: N) => number;
    nodeLabel?: (node: N) => string;
    enableNodeDrag?: boolean;
    onNodeClick?: (node: N, event: MouseEvent) => void;
    onNodeRightClick?: (node: N, event: MouseEvent) => void;
    onNodeHover?: (node: N | null, previousNode: N | null) => void;
    onBackgroundClick?: (event: MouseEvent) => void;
    linkColor?: (link: L) => string;
    linkWidth?: (link: L) => number;
    linkLineDash?: (link: L) => number[] | null;
    nodeCanvasObject?: (node: N, ctx: CanvasRenderingContext2D, scale: number) => void;
    nodePointerAreaPaint?: (node: N, color: string, ctx: CanvasRenderingContext2D) => void;
    [key: string]: unknown;
  }

  interface ForceGraphInstance {
    d3Force: (name: string, force?: unknown) => unknown;
    zoomToFit: (duration?: number, padding?: number) => void;
    centerAt: (x?: number, y?: number, duration?: number) => void;
    zoom: (scale: number, duration?: number) => void;
  }

  export default class ForceGraph2D<N = Record<string, unknown>, L = Record<string, unknown>> extends Component<
    ForceGraphProps<N, L>
  > {}
}
