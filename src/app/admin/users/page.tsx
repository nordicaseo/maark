'use client';

import { useEffect, useState, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Users, Shield, Pencil, Clock } from 'lucide-react';

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

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/stats');
      if (!res.ok) return;
      // For Phase 2, we just show the user count from stats.
      // Fetching full user list will be implemented when the /api/admin/users endpoint is ready.
    } catch (err) {
      console.error('Failed to fetch users', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Attempt to load users from a dedicated endpoint
    async function loadUsers() {
      try {
        const res = await fetch('/api/admin/users');
        if (res.ok) {
          const data = await res.json();
          setUsers(data);
        }
      } catch {
        // Endpoint may not exist yet - that's OK for Phase 2 stub
      } finally {
        setLoading(false);
      }
    }
    loadUsers();
  }, []);

  /* ── Helpers ────────────────────────────────────────────────────── */

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
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="h-6 w-6" /> Users
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            View all users in the system. User management coming in Phase 2.
          </p>
        </div>
        {/* Phase 2: Add user invite button */}
      </div>

      {users.length === 0 ? (
        <div className="border border-dashed border-border rounded-lg p-12 text-center text-muted-foreground">
          <Users className="h-10 w-10 mx-auto mb-3 opacity-50" />
          <p className="font-medium">No users found</p>
          <p className="text-sm mt-1">
            Users will appear here once they sign in via authentication.
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
                  <img
                    src={u.image}
                    alt={u.name || u.email}
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
                    <Badge variant={getRoleBadgeVariant(u.role)} className="text-xs capitalize">
                      {u.role}
                    </Badge>
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {u.email}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                Joined {new Date(u.createdAt).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Phase 2 notice */}
      <div className="mt-6 p-4 bg-accent/30 rounded-lg border border-border">
        <div className="flex items-center gap-2 text-sm">
          <Shield className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">
            <strong className="text-foreground">Phase 2:</strong> User invitations,
            role management, and team assignments will be available in a future
            update.
          </span>
        </div>
      </div>
    </div>
  );
}
