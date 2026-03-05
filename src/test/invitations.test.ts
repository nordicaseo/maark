import { describe, expect, it } from 'vitest';
import { isInvitationExpired, resolveInvitationStatus } from '@/lib/invitations';

describe('invitation helpers', () => {
  it('resolves status precedence correctly', () => {
    expect(
      resolveInvitationStatus({
        acceptedAt: null,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      })
    ).toBe('pending');

    expect(
      resolveInvitationStatus({
        acceptedAt: new Date(),
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      })
    ).toBe('accepted');

    expect(
      resolveInvitationStatus({
        acceptedAt: null,
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      })
    ).toBe('revoked');

    expect(
      resolveInvitationStatus({
        acceptedAt: null,
        revokedAt: null,
        expiresAt: new Date(Date.now() - 60_000),
      })
    ).toBe('expired');
  });

  it('detects expiration safely', () => {
    expect(isInvitationExpired(new Date(Date.now() - 1000))).toBe(true);
    expect(isInvitationExpired(new Date(Date.now() + 1000))).toBe(false);
    expect(isInvitationExpired(null)).toBe(true);
  });
});
