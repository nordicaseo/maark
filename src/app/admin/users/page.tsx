'use client';

import { useEffect, useState, useCallback } from 'react';
import NextImage from 'next/image';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { InviteDialog } from '@/components/admin/invite-dialog';
import { Users, Clock, UserPlus, Mail, Trash2, Link2 } from 'lucide-react';

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
  token: string;
  inviterName: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);

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
    try {
      const res = await fetch(`/api/admin/invitations/${inviteId}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        setInvitations((prev) => prev.filter((i) => i.id !== inviteId));
      }
    } catch (err) {
      console.error('Failed to revoke invitation', err);
    }
  };

  function getRoleBadgeVariant(role: string) {
    switch (role) {
      case 'owner':
        return 'default' as const;
      case 'admin':
        return 'default' as const;
      case 'editor':
        return 'secondary' as const;
      default:
        return 'outline' as const;
    }
  }

  const pendingInvitations = invitations.filter((i) => !i.acceptedAt);

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
                {u.role === 'owner' ? (
                  <Badge variant="default" className="capitalize">
                    owner
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
                      <SelectItem value="writer">Writer</SelectItem>
                      <SelectItem value="editor">Editor</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
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
      {pendingInvitations.length > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
            <Link2 className="h-5 w-5" />
            Pending Invitations
          </h2>
          <div className="border border-border rounded-lg divide-y divide-border">
            {pendingInvitations.map((inv) => (
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
                    </div>
                    <span className="text-xs text-muted-foreground">
                      Invited {new Date(inv.createdAt).toLocaleDateString()} &middot; Expires{' '}
                      {new Date(inv.expiresAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  onClick={() => handleRevokeInvite(inv.id)}
                  title="Revoke invitation"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Invite Dialog */}
      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onInviteCreated={fetchData}
      />
    </div>
  );
}
