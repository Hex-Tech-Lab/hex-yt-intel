/**
 * Zero-dependency GraphQL client for Supabase pg_graphql
 * Provides typed query/mutation execution with built-in error handling
 * 
 * @deprecated Use the standard Supabase PostgREST Client library (`@supabase/supabase-js`) instead.
 */

interface GraphQLError {
  message: string;
  extensions?: {
    code?: string;
  };
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: GraphQLError[];
}

/**
 * @deprecated Migrate data fetch requirements to `@supabase/supabase-js`.
 */
export class GraphQLClient {
  private endpoint: string;
  private anonKey: string;
  private timeout: number;

  constructor(
    endpoint: string,
    anonKey: string,
    timeout: number = 30000
  ) {
    this.endpoint = endpoint;
    this.anonKey = anonKey;
    this.timeout = timeout;
  }

  async query<T = any>(
    query: string,
    variables?: Record<string, any>
  ): Promise<T> {
    return this.execute<T>(query, variables);
  }

  async mutation<T = any>(
    query: string,
    variables?: Record<string, any>
  ): Promise<T> {
    return this.execute<T>(query, variables);
  }

  private async execute<T = any>(
    query: string,
    variables?: Record<string, any>
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.endpoint}/graphql/v1`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.anonKey}`,
          'Apikey': this.anonKey,
        },
        body: JSON.stringify({
          query,
          variables,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(
          `GraphQL request failed: ${response.status} ${response.statusText}`
        );
      }

      const result: GraphQLResponse<T> = await response.json();

      if (result.errors && result.errors.length > 0) {
        const errorMessage = result.errors
          .map((err) => err.message)
          .join('; ');
        throw new Error(`GraphQL error: ${errorMessage}`);
      }

      if (!result.data) {
        throw new Error('GraphQL response missing data field');
      }

      return result.data;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new Error(
            `GraphQL request timeout (${this.timeout}ms)`
          );
        }
        throw error;
      }

      throw new Error(
        `GraphQL request failed: ${String(error)}`
      );
    }
  }
}

/**
 * Factory function to create GraphQL client for Supabase
 * Automatically pulls endpoint and key from environment
 * Fails fast on missing/invalid credentials
 * 
 * @deprecated Use standard Supabase client initialization instead.
 */
export function createSupabaseGraphQLClient(): GraphQLClient {
  const endpoint = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!endpoint) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL environment variable is required for GraphQL client. Set it in your environment.'
    );
  }

  if (!anonKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_ANON_KEY environment variable is required for GraphQL client. Set it in your environment.'
    );
  }

  try {
    new URL(endpoint);
  } catch {
    throw new Error(
      `NEXT_PUBLIC_SUPABASE_URL must be a valid URL. Received: ${endpoint}`
    );
  }

  return new GraphQLClient(endpoint, anonKey, 30000);
}

/**
 * Example: Query analyses by user
 * Usage:
 *   const client = createSupabaseGraphQLClient();
 *   const result = await client.query<{ analysesCollection: { edges: Array<{ node: Analysis }> } }>(
 *     `query GetAnalyses($userId: String!) {
 *        analysesCollection(filter: { user_id: { eq: $userId } }, first: 10) {
 *          edges { node { id title markdown } }
 *        }
 *      }`,
 *     { userId: 'user-123' }
 *   );
 */
