'use client';

import { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, Pencil, Trash2, Cpu, Settings2 } from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Provider {
  id: number;
  name: string;
  displayName: string;
  apiKey: string;
  isActive: number | boolean;
  createdAt: string;
  updatedAt: string;
}

interface ModelConfig {
  id: number;
  action: string;
  providerId: number;
  model: string;
  maxTokens: number;
  temperature: number;
  providerName: string;
  providerDisplayName: string;
}

const PROVIDER_NAMES = ['anthropic', 'openai'] as const;

const ACTIONS = [
  { value: 'writing', label: 'Writing' },
  { value: 'rewriting', label: 'Rewriting' },
  { value: 'formatting', label: 'Formatting' },
  { value: 'skill_generation', label: 'Skill Generation' },
];

const MODEL_OPTIONS: Record<string, string[]> = {
  anthropic: [
    'claude-sonnet-4-20250514',
    'claude-opus-4-20250514',
    'claude-haiku-4-20250514',
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
  ],
  openai: [
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4-turbo',
    'o3',
    'o3-mini',
    'o4-mini',
  ],
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function AdminAIPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [configs, setConfigs] = useState<ModelConfig[]>([]);
  const [loading, setLoading] = useState(true);

  // Provider dialog state
  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [providerForm, setProviderForm] = useState({
    name: 'anthropic' as string,
    displayName: '',
    apiKey: '',
    isActive: true,
  });

  // Config dialog state
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<ModelConfig | null>(null);
  const [configForm, setConfigForm] = useState({
    action: '',
    providerId: '',
    model: '',
    maxTokens: 4096,
    temperature: 1.0,
  });

  /* ── Fetching ───────────────────────────────────────────────────── */

  const fetchProviders = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/ai/providers');
      if (res.ok) setProviders(await res.json());
    } catch (err) {
      console.error('Failed to fetch providers', err);
    }
  }, []);

  const fetchConfigs = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/ai/config');
      if (res.ok) setConfigs(await res.json());
    } catch (err) {
      console.error('Failed to fetch configs', err);
    }
  }, []);

  useEffect(() => {
    Promise.all([fetchProviders(), fetchConfigs()]).finally(() =>
      setLoading(false)
    );
  }, [fetchProviders, fetchConfigs]);

  /* ── Provider CRUD ──────────────────────────────────────────────── */

  function openNewProvider() {
    setEditingProvider(null);
    setProviderForm({ name: 'anthropic', displayName: '', apiKey: '', isActive: true });
    setProviderDialogOpen(true);
  }

  function openEditProvider(p: Provider) {
    setEditingProvider(p);
    setProviderForm({
      name: p.name,
      displayName: p.displayName || '',
      apiKey: '',
      isActive: !!p.isActive,
    });
    setProviderDialogOpen(true);
  }

  async function saveProvider() {
    if (editingProvider) {
      const body: any = {
        name: providerForm.name,
        displayName: providerForm.displayName,
        isActive: providerForm.isActive,
      };
      if (providerForm.apiKey) body.apiKey = providerForm.apiKey;
      await fetch(`/api/admin/ai/providers/${editingProvider.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } else {
      await fetch('/api/admin/ai/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(providerForm),
      });
    }
    setProviderDialogOpen(false);
    fetchProviders();
  }

  async function deleteProvider(id: number) {
    if (!confirm('Delete this provider? Any model configs using it will also be deleted.')) return;
    await fetch(`/api/admin/ai/providers/${id}`, { method: 'DELETE' });
    fetchProviders();
    fetchConfigs();
  }

  /* ── Config CRUD ────────────────────────────────────────────────── */

  function openNewConfig() {
    setEditingConfig(null);
    setConfigForm({ action: '', providerId: '', model: '', maxTokens: 4096, temperature: 1.0 });
    setConfigDialogOpen(true);
  }

  function openEditConfig(c: ModelConfig) {
    setEditingConfig(c);
    setConfigForm({
      action: c.action,
      providerId: String(c.providerId),
      model: c.model,
      maxTokens: c.maxTokens,
      temperature: c.temperature,
    });
    setConfigDialogOpen(true);
  }

  async function saveConfig() {
    await fetch('/api/admin/ai/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: configForm.action,
        providerId: Number(configForm.providerId),
        model: configForm.model,
        maxTokens: configForm.maxTokens,
        temperature: configForm.temperature,
      }),
    });
    setConfigDialogOpen(false);
    fetchConfigs();
  }

  /* ── Helpers ────────────────────────────────────────────────────── */

  const selectedProviderForConfig = providers.find(
    (p) => String(p.id) === configForm.providerId
  );
  const availableModels = selectedProviderForConfig
    ? MODEL_OPTIONS[selectedProviderForConfig.name] || []
    : [];

  /* ── Render ─────────────────────────────────────────────────────── */

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        Loading AI configuration...
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* ── Providers Section ──────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Cpu className="h-5 w-5" /> AI Providers
            </h2>
            <p className="text-sm text-muted-foreground">
              Configure API keys for each AI provider.
            </p>
          </div>
          <Button size="sm" onClick={openNewProvider}>
            <Plus className="h-4 w-4 mr-1" /> Add Provider
          </Button>
        </div>

        {providers.length === 0 ? (
          <div className="border border-dashed border-border rounded-lg p-8 text-center text-muted-foreground">
            No providers configured yet. Add one to get started.
          </div>
        ) : (
          <div className="border border-border rounded-lg divide-y divide-border">
            {providers.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <div>
                    <span className="font-medium">{p.displayName || p.name}</span>
                    <span className="text-xs text-muted-foreground ml-2">
                      ({p.name})
                    </span>
                  </div>
                  <Badge variant={p.isActive ? 'default' : 'secondary'}>
                    {p.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                  <span className="text-xs text-muted-foreground font-mono">
                    Key: {p.apiKey}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openEditProvider(p)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteProvider(p.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Model Config Section ───────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Settings2 className="h-5 w-5" /> Model Configuration
            </h2>
            <p className="text-sm text-muted-foreground">
              Choose which provider and model to use for each action.
            </p>
          </div>
          <Button size="sm" onClick={openNewConfig}>
            <Plus className="h-4 w-4 mr-1" /> Set Config
          </Button>
        </div>

        {configs.length === 0 ? (
          <div className="border border-dashed border-border rounded-lg p-8 text-center text-muted-foreground">
            No model configs set yet. Configure one for each action.
          </div>
        ) : (
          <div className="border border-border rounded-lg divide-y divide-border">
            {configs.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between px-4 py-3"
              >
                <div className="flex items-center gap-4">
                  <Badge variant="outline" className="capitalize">
                    {c.action.replace('_', ' ')}
                  </Badge>
                  <span className="text-sm">
                    {c.providerDisplayName}{' '}
                    <span className="text-muted-foreground font-mono text-xs">
                      {c.model}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    max_tokens: {c.maxTokens} | temp: {c.temperature}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => openEditConfig(c)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Provider Dialog ────────────────────────────────────────── */}
      <Dialog open={providerDialogOpen} onOpenChange={setProviderDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingProvider ? 'Edit Provider' : 'Add Provider'}
            </DialogTitle>
            <DialogDescription>
              {editingProvider
                ? 'Update the provider details below.'
                : 'Configure a new AI provider with its API key.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium mb-1 block">Provider</label>
              <Select
                value={providerForm.name}
                onValueChange={(v) =>
                  setProviderForm((f) => ({ ...f, name: v }))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDER_NAMES.map((n) => (
                    <SelectItem key={n} value={n}>
                      {n.charAt(0).toUpperCase() + n.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">
                Display Name
              </label>
              <Input
                value={providerForm.displayName}
                onChange={(e) =>
                  setProviderForm((f) => ({
                    ...f,
                    displayName: e.target.value,
                  }))
                }
                placeholder="e.g. Anthropic Production"
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">
                API Key{editingProvider ? ' (leave blank to keep current)' : ''}
              </label>
              <Input
                type="password"
                value={providerForm.apiKey}
                onChange={(e) =>
                  setProviderForm((f) => ({ ...f, apiKey: e.target.value }))
                }
                placeholder={editingProvider ? '********' : 'sk-...'}
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="provider-active"
                checked={providerForm.isActive}
                onChange={(e) =>
                  setProviderForm((f) => ({
                    ...f,
                    isActive: e.target.checked,
                  }))
                }
                className="rounded border-border"
              />
              <label htmlFor="provider-active" className="text-sm">
                Active
              </label>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setProviderDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={saveProvider}>
              {editingProvider ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Config Dialog ──────────────────────────────────────────── */}
      <Dialog open={configDialogOpen} onOpenChange={setConfigDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingConfig ? 'Edit Model Config' : 'Set Model Config'}
            </DialogTitle>
            <DialogDescription>
              Choose which provider and model to use for this action.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium mb-1 block">Action</label>
              <Select
                value={configForm.action}
                onValueChange={(v) =>
                  setConfigForm((f) => ({ ...f, action: v }))
                }
                disabled={!!editingConfig}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select action" />
                </SelectTrigger>
                <SelectContent>
                  {ACTIONS.map((a) => (
                    <SelectItem key={a.value} value={a.value}>
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">Provider</label>
              <Select
                value={configForm.providerId}
                onValueChange={(v) =>
                  setConfigForm((f) => ({ ...f, providerId: v, model: '' }))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select provider" />
                </SelectTrigger>
                <SelectContent>
                  {providers
                    .filter((p) => p.isActive)
                    .map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.displayName || p.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">Model</label>
              <Select
                value={configForm.model}
                onValueChange={(v) =>
                  setConfigForm((f) => ({ ...f, model: v }))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select model" />
                </SelectTrigger>
                <SelectContent>
                  {availableModels.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-1 block">
                  Max Tokens
                </label>
                <Input
                  type="number"
                  value={configForm.maxTokens}
                  onChange={(e) =>
                    setConfigForm((f) => ({
                      ...f,
                      maxTokens: parseInt(e.target.value, 10) || 4096,
                    }))
                  }
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">
                  Temperature
                </label>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  max="2"
                  value={configForm.temperature}
                  onChange={(e) =>
                    setConfigForm((f) => ({
                      ...f,
                      temperature: parseFloat(e.target.value) || 1.0,
                    }))
                  }
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfigDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={saveConfig}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
