import { test as base, expect, type Page } from '@playwright/test';
import { initialWatchlist } from '../src/data/vessel-workflow';

// Existing feature tests exercise an approved session through the same HTTP contracts.
// Authentication itself is tested against a real isolated API in auth-ui.spec.ts.
export const test = base.extend({
  page: async ({ page }, use) => {
    let snapshot: { revision: number; workspace: unknown; destinations: Record<string, string> } | null = null;
    // No test request may fall through to a developer's running operational server.
    await page.route('**/api/**', route => route.fulfill({ status: 503, json: { detail: 'No fixture for this API' } }));
    await page.route('**/api/auth/**', route => {
      const path = new URL(route.request().url()).pathname;
      return route.fulfill({ json: path.endsWith('/csrf') ? { token: 'fixture-csrf' } : path.endsWith('/bootstrap-status') ? { setupRequired: false } : {
        user: { id: '00000000-0000-4000-8000-000000000001', username: 'fixture-admin', displayName: 'Fixture Admin', role: 'admin', status: 'active', version: 1, createdAt: 0, reviewedAt: null, mustChangePassword: 0 }, scope: 'full',
      } });
    });
    await page.route('**/api/me/vessel-workspace', async route => {
      if (!snapshot) {
        let legacy;
        try {
          legacy = await page.evaluate(() => ({ workspace: localStorage.getItem('genforecast.vessel-workspace.v1'), destinations: localStorage.getItem('genforecast.vessel-route-destinations.v1') }));
        } catch (error) {
          // Clock installation/navigation can cancel the previous document's request.
          if (/Execution context was destroyed|Frame was detached|Target page, context or browser has been closed/.test(String(error))) {
            await route.abort().catch(() => {}); return;
          }
          throw error;
        }
        snapshot = { revision: 0, workspace: legacy.workspace ? JSON.parse(legacy.workspace) : { version: 1, watchlist: initialWatchlist, vessels: [], voyages: [] }, destinations: JSON.parse(legacy.destinations || '{}') };
      }
      if (route.request().method() === 'PUT') {
        const next = route.request().postDataJSON();
        if (next.revision !== snapshot.revision) return route.fulfill({ status: 409, json: { code: 'workspace_conflict', detail: 'Fixture conflict' } });
        snapshot = { ...next, revision: next.revision + 1 };
      }
      await route.fulfill({ json: snapshot });
    });
    await page.route('**/api/admin/users?**', route => route.fulfill({ json: { users: [], hasMore: false } }));
    await use(page);
  },
});
export { expect };
export async function readSavedWorkspace(page: Page) {
  await expect(page.getByText('관심 선박을 계정에 저장하는 중…', { exact: true })).toHaveCount(0);
  return page.evaluate(async () => (await (await fetch('/api/me/vessel-workspace')).json()).workspace);
}
