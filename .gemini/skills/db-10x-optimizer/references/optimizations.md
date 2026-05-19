# Database Optimization Patterns (PostgreSQL / Supabase)

Use these patterns to enhance database performance, safety, and scalability.

## 1. High-Performance Indexing

### Composite Indexes for Cache Lookups
When a route frequently queries by multiple columns (e.g., `user_id` + `video_id`), a composite index is mandatory.
```sql
CREATE INDEX idx_table_composite ON public.table_name(user_id, video_id, created_at DESC);
```

### Foreign Key Indexing
PostgreSQL does not automatically index foreign keys. Always index them to speed up JOINs and filtered queries.
```sql
CREATE INDEX idx_table_user_id ON public.table_name(user_id);
```

### Vector Search Optimization (pgvector)
For semantic search, use HNSW (Hierarchical Navigable Small World) for maximum speed or IVFFlat for lower memory usage.
```sql
-- HNSW (Recommended for performance)
CREATE INDEX idx_table_embedding ON public.table_name USING hnsw (embedding vector_cosine_ops);

-- IVFFlat (Better for large datasets with lower memory)
CREATE INDEX idx_table_embedding_ivfflat ON public.table_name USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

## 2. Relational Safety & Integrity

### Cascading Deletes
Prevent orphaned data and constraint violations by ensuring related rows are deleted automatically.
```sql
ALTER TABLE public.child_table 
ADD CONSTRAINT table_user_id_fkey 
FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
```

### Auth Linkage (Supabase)
Ensure the public users table maps 1:1 to the secure auth system.
```sql
id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE
```

### Data Constraints (CHECK)
Protect against negative quotas or invalid states.
```sql
ALTER TABLE public.users ADD CONSTRAINT check_analyses_used_non_negative CHECK (analyses_used >= 0);
```

## 3. Scale & Concurrency

### Atomic Increments (RPC)
Avoid race conditions in serverless environments by using database-level atomic operations.
```sql
CREATE OR REPLACE FUNCTION increment_user_quota(target_user_id uuid)
RETURNS void AS $$
BEGIN
  UPDATE public.users
  SET analyses_used = analyses_used + 1
  WHERE id = target_user_id;
END;
$$ LANGUAGE plpgsql;
```

### Row Level Security (RLS)
Always enable RLS if client-side libraries (@supabase/supabase-js) are used.
```sql
ALTER TABLE public.analyses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can only view their own analyses" 
ON public.analyses FOR SELECT 
USING (auth.uid() = user_id);
```
