export class SourceRegistry {
  private map = new Map<string, any>();

  has(path: string) {
    return this.map.has(path);
  }

  get(path: string) {
    return this.map.get(path);
  }

  add(path: string, ast: any) {
    this.map.set(path, ast);
  }
}
