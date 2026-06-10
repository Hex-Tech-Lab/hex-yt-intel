/** The signed streaming token handed to the client for direct browser→worker flow. */
export interface StreamToken {
  sig: string;
  exp: number;
}
