'use client';

import { useEffect, useState, useCallback } from 'react';
import NextImage from 'next/image';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { InviteDialog } from '@/components/admin/invite-dialog';
import { Users, Clock, UserPlus, Mail, Trash2, Link2, ShieldCheck, RotateCcw, RefreshCw, Loader2 } from 'lucide-react';
import { useAuth } from '@/components/auth/auth-provider';
import { hasRole } from '@/lib/permissions';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface User {
  id: string;
  name: string | null;
  email: string;
  role: string;
  image: string | null;
  createdAt: string;
}

interface Invitation {
  id: number;
  email: string | null;
  role: string;
  projectIds?: number[] | null;
  projectRole?: string | null;
  token: string;
  inviterName: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt?: string | null;
  lastSentAt?: string | null;
  status?: 'pending' | 'accepted' | 'expired' | 'revoked';
  createdAt: string;
}

interface ProjectAccessRow {
  projectId: number;
  projectName: string;
  assigned: boolean;
  assignedRole: 'admin' | 'editor' | 'writer' | 'client' | null;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function AdminUsersPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [accessLoading, setAccessLoading] = useState(false);
  const [accessSaving, setAccessSaving] = useState(false);
  const [accessUser, setAccessUser] = useState<User | null>(null);
  const [accessRows, setAccessRows] = useState<ProjectAccessRow[]>([]);
  const [inviteActionId, setInviteActionId] = useState<number | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [usersRes, invitesRes] = await Promise.all([
        fetch('/api/admin/users'),
        fetch('/api/admin/invitations'),
      ]);

      if (usersRes.ok) {
        setUsers(await usersRes.json());
      }
      if (invitesRes.ok) {
        setInvitations(await invitesRes.json());
      }
    } catch (err) {
      console.error('Failed to fetch data', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /* ── Handlers ───────────────────────────────────────────────────── */

  const handleRoleChange = async (userId: string, newRole: string) => {
    try {
      const res = await fetch(`/api/admin/users/${userId}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      });

      if (res.ok) {
        setUsers((prev) =>
          prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u))
        );
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to update role');
      }
    } catch (err) {
      console.error('Failed to update role', err);
    }
  };

  const handleRevokeInvite = async (inviteId: number) => {
    setInviteActionId(inviteId);
    try {
      const res = await fetch(`/api/admin/invitations/${inviteId}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        await fetchData();
      }
    } catch (err) {
      console.error('Failed to revoke invitation', err);
    } finally {
      setInviteActionId(null);
    }
  };

  const handleInvitationAction = async (
    inviteId: number,
    action: 'resend' | 'regenerate'
  ) => {
    setInviteActionId(inviteId);
    try {
      const res = await fetch(`/api/admin/invitations/${inviteId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to ${action} invitation`);
      }

      const data = await res.json();
      await fetchData();

      if (data.inviteUrl) {
        await navigator.clipboard.writeText(String(data.inviteUrl));
      }
    } catch (err) {
      console.error(`Failed to ${action} invitation`, err);
      alert((err as Error).message || `Failed to ${action} invitation`);
    } finally {
      setInviteActionId(null);
    }
  };

  const openAccessManager = async (targetUser: User) => {
    setAccessOpen(true);
    setAccessLoading(true);
    setAccessUser(targetUser);
    setAccessRows([]);

    try {
      const res = await fetch(`/api/admin/users/${targetUser.id}/projects`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to load project access');
      }
      const data = await res.json();
      const rows = Array.isArray(data.projects) ? data.projects : [];
      setAccessRows(
        rows.map((row: ProjectAccessRow) => ({
          projectId: Number(row.projectId),
          projectName: String(row.projectName || ''),
          assigned: Boolean(row.assigned),
          assignedRole: row.assignedRole || 'writer',
        }))
      );
    } catch (err) {
      console.error('Failed to load user project access', err);
      setAccessRows([]);
    } finally {
      setAccessLoading(false);
    }
  };

  const toggleProjectAssignment = (projectId: number, assigned: boolean) => {
    setAccessRows((prev) =>
      prev.map((row) =>
        row.projectId === projectId
          ? {
              ...row,
              assigned,
              assignedRole: assigned ? row.assignedRole || 'writer' : row.assignedRole,
            }
          : row
      )
    );
  };

  const updateProjectAssignmentRole = (
    projectId: number,
    role: 'admin' | 'editor' | 'writer' | 'client'
  ) => {
    setAccessRows((prev) =>
      prev.map((row) =>
        row.projectId === projectId
          ? {
              ...row,
              assigned: true,
              assignedRole: role,
            }
          : row
      )
    );
  };

  const saveAccessChanges = async () => {
    if (!accessUser) return;
    setAccessSaving(true);
    try {
      const assignments = accessRows
        .filter((row) => row.assigned)
        .map((row) => ({
          projectId: row.projectId,
          role: row.assignedRole || 'writer',
        }));

      const res = await fetch(`/api/admin/users/${accessUser.id}/projects`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignments }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update project access');
      }
      setAccessOpen(false);
    } catch (err) {
      console.error('Failed to save project access', err);
      alert((err as Error).message || 'Failed to save project access');
    } finally {
      setAccessSaving(false);
    }
  };

  function getRoleBadgeVariant(role: string) {
    switch (role) {
      case 'owner':
      case 'super_admin':
        return 'default' as const;
      case 'admin':
        return 'default' as const;
      case 'editor':
        return 'secondary' as const;
      default:
        return 'outline' as const;
    }
  }

  const invitationRows = invitations;
  const canEditRoles = Boolean(user && hasRole(user.role, 'super_admin'));

  function inviteStatus(invitation: Invitation): 'pending' | 'accepted' | 'expired' | 'revoked' {
    if (invitation.status) return invitation.status;
    if (invitation.revokedAt) return 'revoked';
    if (invitation.acceptedAt) return 'accepted';
    if (new Date(invitation.expiresAt).getTime() < Date.now()) return 'expired';
    return 'pending';
  }

  function inviteStatusBadgeVariant(status: ReturnType<typeof inviteStatus>) {
    switch (status) {
      case 'accepted':
        return 'default' as const;
      case 'revoked':
        return 'outline' as const;
      case 'expired':
        return 'secondary' as const;
      default:
        return 'secondary' as const;
    }
  }

  /* ── Render ─────────────────────────────────────────────────────── */

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        Loading users...
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="h-6 w-6" /> Users
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage team members and invitations.
          </p>
        </div>
        <Button onClick={() => setInviteOpen(true)}>
          <UserPlus className="h-4 w-4 mr-2" />
          Invite User
        </Button>
      </div>

      {/* Users List */}
      {users.length === 0 ? (
        <div className="border border-dashed border-border rounded-lg p-12 text-center text-muted-foreground">
          <Users className="h-10 w-10 mx-auto mb-3 opacity-50" />
          <p className="font-medium">No users found</p>
          <p className="text-sm mt-1">
            Users will appear here once they sign in.
          </p>
        </div>
      ) : (
        <div className="border border-border rounded-lg divide-y divide-border">
          {users.map((u) => (
            <div
              key={u.id}
              className="flex items-center justify-between px-4 py-3"
            >
              <div className="flex items-center gap-3">
                {u.image ? (
                  <NextImage
                    src={u.image}
                    alt={u.name || u.email}
                    width={32}
                    height={32}
                    unoptimized
                    className="h-8 w-8 rounded-full"
                  />
                ) : (
                  <div className="h-8 w-8 rounded-full bg-accent flex items-center justify-center text-xs font-medium">
                    {(u.name || u.email).charAt(0).toUpperCase()}
                  </div>
                )}
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">
                      {u.name || 'Unnamed'}
                    </span>
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {u.email}
                  </span>
                </div>
              </div>

                <div className="flex items-center gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8"
                    onClick={() => void openAccessManager(u)}
                  >
                    <ShieldCheck className="h-3.5 w-3.5 mr-1" />
                    Access
                  </Button>
                  {u.role === 'owner' || !canEditRoles ? (
                    <Badge variant="default" className="capitalize">
                      {u.role}
                  </Badge>
                ) : (
                  <Select
                    value={u.role}
                    onValueChange={(val) => handleRoleChange(u.id, val)}
                  >
                    <SelectTrigger className="w-28 h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="client">Client</SelectItem>
                      <SelectItem value="writer">Writer</SelectItem>
                      <SelectItem value="editor">Editor</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="super_admin">Super Admin</SelectItem>
                    </SelectContent>
                  </Select>
                )}
                <div className="flex items-center gap-1 text-xs text-muted-foreground min-w-[100px]">
                  <Clock className="h-3.5 w-3.5" />
                  Joined {new Date(u.createdAt).toLocaleDateString()}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pending Invitations */}
      {invitationRows.length > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
            <Link2 className="h-5 w-5" />
            Invitations
          </h2>
          <div className="border border-border rounded-lg divide-y divide-border">
            {invitationRows.map((inv) => {
              const status = inviteStatus(inv);
              const isBusy = inviteActionId === inv.id;
              const canResend = status === 'pending';
              const canRegenerate = status === 'expired' || status === 'revoked';
              const canRevoke = status === 'pending' || status === 'expired';
              return (
              <div
                key={inv.id}
                className="flex items-center justify-between px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-accent/50 flex items-center justify-center">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        {inv.email || 'Open invite link'}
                      </span>
                      <Badge variant={getRoleBadgeVariant(inv.role)} className="text-xs capitalize">
                        {inv.role}
                      </Badge>
                      <Badge variant={inviteStatusBadgeVariant(status)} className="text-xs capitalize">
                        {status}
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      Invited {new Date(inv.createdAt).toLocaleDateString()} &middot; Expires{' '}
                      {new Date(inv.expiresAt).toLocaleDateString()}
                      {Array.isArray(inv.projectIds) && inv.projectIds.length > 0
                        ? ` · ${inv.projectIds.length} project${inv.projectIds.length === 1 ? '' : 's'} (${inv.projectRole || 'writer'})`
                        : ''}
                      {inv.lastSentAt
                        ? ` · Last sent ${new Date(inv.lastSentAt).toLocaleString()}`
                        : ''}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  {canResend && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground"
                      onClick={() => void handleInvitationAction(inv.id, 'resend')}
                      title="Resend invitation"
                      disabled={isBusy}
                    >
                      {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    </Button>
                  )}
                  {canRegenerate && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground"
                      onClick={() => void handleInvitationAction(inv.id, 'regenerate')}
                      title="Regenerate invitation"
                      disabled={isBusy}
                    >
                      {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                    </Button>
                  )}
                  {canRevoke && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => void handleRevokeInvite(inv.id)}
                      title="Revoke invitation"
                      disabled={isBusy}
                    >
                      {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </Button>
                  )}
                </div>
              </div>
            );
            })}
          </div>
        </div>
      )}

      {/* Invite Dialog */}
      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onInviteCreated={fetchData}
      />

      <Dialog open={accessOpen} onOpenChange={setAccessOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              Project Access {accessUser ? `· ${accessUser.name || accessUser.email}` : ''}
            </DialogTitle>
          </DialogHeader>

          {accessLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Loading project access...</div>
          ) : accessRows.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No manageable projects found for this admin scope.
            </div>
          ) : (
            <div className="max-h-[52vh] overflow-y-auto space-y-2 pr-1">
              {accessRows.map((row) => (
                <div
                  key={row.projectId}
                  className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
                >
                  <label className="flex items-center gap-2 min-w-0">
                    <input
                      type="checkbox"
                      checked={row.assigned}
                      onChange={(event) =>
                        toggleProjectAssignment(row.projectId, event.target.checked)
                      }
                    />
                    <span className="text-sm truncate">{row.projectName}</span>
                  </label>
                  <Select
                    value={row.assignedRole || 'writer'}
                    onValueChange={(value) =>
                      updateProjectAssignmentRole(
                        row.projectId,
                        value as 'admin' | 'editor' | 'writer' | 'client'
                      )
                    }
                    disabled={!row.assigned}
                  >
                    <SelectTrigger className="w-28 h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="client">Client</SelectItem>
                      <SelectItem value="writer">Writer</SelectItem>
                      <SelectItem value="editor">Editor</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setAccessOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveAccessChanges} disabled={accessSaving || accessLoading}>
              {accessSaving ? 'Saving...' : 'Save Access'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
