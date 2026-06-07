# next.config.ts Annotation

This file contains Next.js application configuration. Only notable or non-obvious entries are documented here.

## serverExternalPackages

```ts
serverExternalPackages: ['pdfkit'],
```

Marks `pdfkit` as a server-external package so Next.js does not bundle it during the build. Required for Vercel deployment where pdfkit's native addon and font assets need to be resolved at runtime rather than baked into the serverless bundle.

## outputFileTracingIncludes

```ts
outputFileTracingIncludes: {
  '/api/analyses/[id]/export/**/*': ['./node_modules/pdfkit/js/data/**'],
},
```

Narrows pdfkit's font data tracing to only the export endpoint route pattern. The broader `/api/**/*` glob was tightened after audit to reduce bundle surface area.

## experimental.optimizePackageImports

```ts
experimental: {
  optimizePackageImports: [
    "@supabase/supabase-js",
    "@supabase/auth-helpers-nextjs",
    "@sentry/nextjs",
  ],
},
```

Tree-shakes unused imports from listed packages to reduce client bundle size.

## security headers

All security-related headers (`X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`, `Referrer-Policy`, `Permissions-Policy`) are applied globally via the `headers()` config. These are standard hardening headers and do not require per-route documentation.