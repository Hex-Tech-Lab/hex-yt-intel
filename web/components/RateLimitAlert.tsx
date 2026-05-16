'use client';

import { Alert, AlertTitle, LinearProgress, Box, Typography } from '@mui/material';
import { Clock } from 'lucide-react';

interface RateLimitAlertProps {
  secondsRemaining: number;
}

export default function RateLimitAlert({ secondsRemaining }: RateLimitAlertProps) {
  const progress = ((60 - secondsRemaining) / 60) * 100; // Assuming max 60 second lockout
  const minutes = Math.floor(secondsRemaining / 60);
  const seconds = secondsRemaining % 60;

  return (
    <Alert
      severity="warning"
      sx={{
        mt: 3,
        mb: 3,
        backgroundColor: '#fff3cd',
        borderColor: '#ffc107',
        borderWidth: 1,
        borderStyle: 'solid',
        borderRadius: 1.5,
        padding: 2,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 1.5,
      }}
    >
      <Clock style={{ marginTop: 4, flexShrink: 0, color: '#f57c00', width: 20, height: 20 }} />
      <Box sx={{ flex: 1 }}>
        <AlertTitle sx={{ fontWeight: 600, color: '#d32f2f', mb: 1, fontSize: '0.95rem' }}>
          Rate Limit Exceeded
        </AlertTitle>
        <Typography variant="body2" sx={{ color: '#666', mb: 1.5 }}>
          You&apos;ve exceeded the request limit. Please try again in:
        </Typography>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            mb: 1.5,
            gap: 2,
          }}
        >
          <Typography
            sx={{
              fontSize: '1.5rem',
              fontWeight: 700,
              color: '#f57c00',
              fontFamily: 'monospace',
              minWidth: 60,
            }}
          >
            {minutes > 0 ? `${minutes}:${seconds.toString().padStart(2, '0')}` : `${seconds}s`}
          </Typography>
          <Typography variant="caption" sx={{ color: '#999' }}>
            {minutes > 0 ? `${minutes} minute${minutes > 1 ? 's' : ''} ${seconds} second${seconds !== 1 ? 's' : ''}` : `${seconds} second${seconds !== 1 ? 's' : ''}`}
          </Typography>
        </Box>
        <LinearProgress
          variant="determinate"
          value={progress}
          sx={{
            height: 6,
            borderRadius: 1,
            backgroundColor: '#ffe0b2',
            '& .MuiLinearProgress-bar': {
              backgroundColor: '#f57c00',
              borderRadius: 1,
            },
          }}
        />
      </Box>
    </Alert>
  );
}
