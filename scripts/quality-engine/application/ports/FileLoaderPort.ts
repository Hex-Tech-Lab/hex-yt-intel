export interface FileLoaderPort {
  load(path: string): Promise<any>;
  loadFromText(path: string, text: string): Promise<any>;
  getImports(ast: any): string[];
}
