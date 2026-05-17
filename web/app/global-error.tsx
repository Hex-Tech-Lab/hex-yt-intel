'use client';

import * as Sentry from '@sentry/nextjs';
import NextError from 'next/error';

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  const statusCode = 'statusCode' in error ? Number(error.statusCode) : 500;

  Sentry.captureException(error);

  return (
    <html>
      <body>
        <NextError statusCode={statusCode} />
      </body>
    </html>
  );
}
