export interface FileLoaderPort {
  load(path: string): Promise<any>;
  getImports(ast: any): string[];
}
