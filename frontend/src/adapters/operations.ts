import { api } from '../lib/api.js';

/**
 * `GET /admin/operations/status` — **what is failing quietly** (SRS Revision 169
 * §11). Counts only, by the host monitor's own definitions; Super Admin only.
 */
export interface OperationsStatus {
  jobs: { failed: number; late: number; queues: { name: string; failed: number; late: number }[] };
  storage_retirement: { pending: number; failed: number; late: number; copy_unknown: number };
  /** Backup freshness and the certificate's expiry live on the HOST and are not
   *  visible to the application. Said, never left as a reassuring blank. */
  host_checks: 'not_visible_from_here';
  checked_at: string;
}

export async function fetchOperationsStatus(token: string | null): Promise<OperationsStatus> {
  return (await api<{ data: OperationsStatus }>('/admin/operations/status', { token })).data;
}
