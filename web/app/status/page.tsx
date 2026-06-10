import { fetchSystemHealth } from '@/lib/services/sentry-telemetry';
import { StatusDashboardClient } from './status-dashboard-client';

/**
 * SYSTEM STATUS PAGE (Server Entry)
 * --------------------------------
 * Fetches real-time telemetry from Sentry and passes it to the high-fidelity client.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 60; // Cache for 60 seconds

export default async function StatusPage() {
  const subsystems = await fetchSystemHealth();
  
  // Calculate global status
  const hasOutage = subsystems.some(s => s.status === 'outage');
  const hasDegradation = subsystems.some(s => s.status === 'degraded');
  
  const globalStatus = hasOutage ? 'outage' : hasDegradation ? 'degraded' : 'operational';

  return (
    <StatusDashboardClient 
      initialSubsystems={subsystems} 
      globalStatus={globalStatus}
    />
  );
}
