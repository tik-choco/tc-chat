import { describe, expect, it, vi } from 'vitest';
vi.mock('@tik-choco/mistlib', () => ({}));
import { captureMistBuildInfo, getMistBuildSnapshot, parseBuildInfo } from './mistBuildInfo';
describe('mistlib runtime diagnostics', () => {
  it('handles old engines without claiming verification', () => {
    captureMistBuildInfo();
    expect(getMistBuildSnapshot().state).toBe('unverified');
  });
  it('copies only validated build fields and preserves dirty', () => {
    const info = { version: '0.6.2', commit: 'abc1234', dirty: true, profile: 'release', target: 'wasm32-unknown-unknown' };
    expect(parseBuildInfo(JSON.stringify({ ...info, privatePath: 'C:/secret' }))).toEqual(info);
    expect(parseBuildInfo({ ...info, commit: 'C:/secret' })).toBeNull();
    expect(parseBuildInfo({ ...info, dirty: 'false' })).toBeNull();
    expect(parseBuildInfo('broken json')).toBeNull();
  });
});
