import { getServerSession } from 'next-auth';
import { authConfig } from './auth/nextauth-config';
import { authProvider } from './auth/provider-factory';

export { authProvider };

export async function getAuth() {
  return getServerSession(authConfig);
}
