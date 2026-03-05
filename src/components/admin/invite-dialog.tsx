'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Copy, Check, Loader2, UserPlus, Link2 } from 'lucide-react';
import { useAuth } from '@/components/auth/auth-provider';

interface InviteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInviteCreated?: () => void;
}

interface ProjectOption {
  id: number;
  name: string;
}

export function InviteDialog({ open, onOpenChange, onInviteCreated }: InviteDialogProps) {
  const { user } = useAuth();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('writer');
  const [projectRole, setProjectRole] = useState('writer');
  const [projectOptions, setProjectOptions] = useState<ProjectOption[]>([]);
  const [selectedProjectIds, setSelectedProjectIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isRootInvite = role === 'owner' || role === 'super_admin';
  const canInviteRootRoles = user?.role === 'owner';

  useEffect(() => {
    if (!open) return;
    fetch('/api/projects')
      .then((res) => (res.ok ? res.json() : []))
      .then((rows) => {
        const normalized = Array.isArray(rows)
          ? rows
              .map((row) => ({
                id: Number(row.id),
                name: String(row.name ?? ''),
              }))
              .filter((row) => Number.isFinite(row.id) && row.id > 0 && row.name)
          : [];
        setProjectOptions(normalized);
      })
      .catch(() => setProjectOptions([]));
  }, [open]);

  useEffect(() => {
    if (!isRootInvite) return;
    setSelectedProjectIds([]);
  }, [isRootInvite]);

  const toggleProject = (projectId: number) => {
    setSelectedProjectIds((prev) =>
      prev.includes(projectId)
        ? prev.filter((id) => id !== projectId)
        : [...prev, projectId]
    );
  };

  const handleCreate = async () => {
    setLoading(true);
    setError(null);

    try {
      if (!isRootInvite && selectedProjectIds.length === 0) {
        throw new Error('Select at least one project for this invitation.');
      }

      const res = await fetch('/api/admin/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim() || undefined,
          role,
          projectRole: isRootInvite ? undefined : projectRole,
          projectIds: isRootInvite ? [] : selectedProjectIds,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create invitation');
      }

      const data = await res.json();
      setInviteUrl(data.inviteUrl);
      onInviteCreated?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClose = (open: boolean) => {
    if (!open) {
      // Reset state when closing
      setEmail('');
      setRole('writer');
      setProjectRole('writer');
      setSelectedProjectIds([]);
      setInviteUrl(null);
      setCopied(false);
      setError(null);
    }
    onOpenChange(open);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogTitle className="flex items-center gap-2">
          <UserPlus className="h-5 w-5" />
          Invite User
        </DialogTitle>

        {!inviteUrl ? (
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="invite-email">Email (optional)</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="user@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Leave blank to create a generic invite link anyone can use.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="client">Client</SelectItem>
                  <SelectItem value="writer">Writer</SelectItem>
                  <SelectItem value="editor">Editor</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  {canInviteRootRoles && <SelectItem value="super_admin">Super Admin</SelectItem>}
                  {canInviteRootRoles && <SelectItem value="owner">Owner</SelectItem>}
                </SelectContent>
              </Select>
            </div>

            {!isRootInvite && (
              <>
                <div className="space-y-2">
                  <Label>Project Role</Label>
                  <Select value={projectRole} onValueChange={setProjectRole}>
                    <SelectTrigger>
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
                <div className="space-y-2">
                  <Label>Projects</Label>
                  <div className="max-h-36 overflow-y-auto rounded-md border border-border">
                    {projectOptions.length === 0 ? (
                      <p className="px-3 py-2 text-xs text-muted-foreground">
                        No projects available.
                      </p>
                    ) : (
                      projectOptions.map((project) => {
                        const selected = selectedProjectIds.includes(project.id);
                        return (
                          <label
                            key={project.id}
                            className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-accent/40"
                          >
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => toggleProject(project.id)}
                            />
                            <span className="truncate">{project.name}</span>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>
              </>
            )}

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            <Button
              onClick={handleCreate}
              disabled={loading}
              className="w-full"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Link2 className="h-4 w-4 mr-2" />
              )}
              Create Invite Link
            </Button>
          </div>
        ) : (
          <div className="space-y-4 pt-2">
            <p className="text-sm text-muted-foreground">
              Share this link with the person you want to invite. It expires in 7 days.
            </p>

            <div className="flex items-center gap-2">
              <Input
                value={inviteUrl}
                readOnly
                className="font-mono text-xs"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={handleCopy}
                className="shrink-0"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>

            <Button
              variant="outline"
              onClick={() => {
                setInviteUrl(null);
                setEmail('');
              }}
              className="w-full"
            >
              Create Another
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
