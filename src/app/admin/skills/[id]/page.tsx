'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ArrowLeft,
  Plus,
  Save,
  Loader2,
  ChevronDown,
  ChevronRight,
  Eye,
} from 'lucide-react';
import { SkillPartEditor } from '@/components/skills/skill-part-editor';
import { SKILL_PART_TYPES } from '@/types/skill-part';
import type { SkillPart, SkillPartType } from '@/types/skill-part';
import type { Skill } from '@/types/skill';
import type { Project } from '@/types/project';

interface SkillWithParts extends Skill {
  parts: SkillPart[];
}

export default function SkillBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [skill, setSkill] = useState<SkillWithParts | null>(null);
  const [parts, setParts] = useState<SkillPart[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isGlobal, setIsGlobal] = useState(false);
  const [skillProjectId, setSkillProjectId] = useState<string>('none');
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const fetchSkill = useCallback(async () => {
    try {
      const res = await fetch(`/api/skills/${id}`);
      if (!res.ok) return;
      const data: SkillWithParts = await res.json();
      setSkill(data);
      setName(data.name);
      setDescription(data.description || '');
      setIsGlobal(data.isGlobal === 1);
      setSkillProjectId(data.projectId?.toString() || 'none');
      setParts(data.parts || []);
    } catch {}
    setLoading(false);
  }, [id]);

  useEffect(() => {
    fetchSkill();
    fetch('/api/projects').then(r => r.ok ? r.json() : []).then(setProjects).catch(() => {});
  }, [fetchSkill]);

  const handleSave = async () => {
    setSaving(true);
    try {
      // Save skill metadata
      await fetch(`/api/skills/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          isGlobal: isGlobal ? 1 : 0,
          projectId: isGlobal ? null : (skillProjectId !== 'none' ? parseInt(skillProjectId) : null),
        }),
      });

      // Bulk save parts
      if (parts.length > 0) {
        const existingParts = parts.filter(p => p.id > 0);
        const newParts = parts.filter(p => p.id <= 0);

        // Update existing parts
        if (existingParts.length > 0) {
          await fetch(`/api/skills/${id}/parts`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              parts: existingParts.map((p, i) => ({
                id: p.id,
                label: p.label,
                content: p.content,
                sortOrder: i,
                partType: p.partType,
              })),
            }),
          });
        }

        // Create new parts
        for (const p of newParts) {
          await fetch(`/api/skills/${id}/parts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              partType: p.partType,
              label: p.label,
              content: p.content,
              sortOrder: parts.indexOf(p),
            }),
          });
        }
      }

      // Refresh to get correct IDs
      await fetchSkill();
    } catch {}
    setSaving(false);
  };

  const addPart = (partType: SkillPartType) => {
    const typeInfo = SKILL_PART_TYPES.find(t => t.value === partType);
    const newPart: SkillPart = {
      id: -(Date.now()), // Negative ID = unsaved
      skillId: parseInt(id),
      partType,
      label: typeInfo?.label || 'Custom',
      content: '',
      sortOrder: parts.length,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setParts(prev => [...prev, newPart]);
  };

  const updatePart = (index: number, updated: Partial<SkillPart>) => {
    setParts(prev => prev.map((p, i) => i === index ? { ...p, ...updated } : p));
  };

  const deletePart = async (index: number) => {
    const part = parts[index];
    if (part.id > 0) {
      await fetch(`/api/skills/${id}/parts/${part.id}`, { method: 'DELETE' });
    }
    setParts(prev => prev.filter((_, i) => i !== index));
  };

  const movePart = (index: number, direction: -1 | 1) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= parts.length) return;
    setParts(prev => {
      const copy = [...prev];
      [copy[index], copy[newIndex]] = [copy[newIndex], copy[index]];
      return copy;
    });
  };

  const composedContent = parts
    .map(p => `## ${p.label}\n\n${p.content}`)
    .join('\n\n');

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        Loading skill...
      </div>
    );
  }

  if (!skill) {
    return (
      <div className="text-center py-20">
        <p className="text-muted-foreground">Skill not found</p>
        <Button variant="outline" className="mt-4" onClick={() => router.push('/admin/skills')}>
          Back to Skills
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.push('/admin/skills')}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <h1 className="text-xl font-bold">Skill Builder</h1>
        </div>
        <Button onClick={handleSave} disabled={saving || !name.trim()}>
          {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          Save All
        </Button>
      </div>

      {/* Metadata */}
      <div className="border border-border rounded-lg p-4 space-y-4 bg-card">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block">Name</label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Skill name..." />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Description</label>
            <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="Brief description..." />
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Checkbox id="isGlobal" checked={isGlobal} onCheckedChange={c => setIsGlobal(c === true)} />
            <label htmlFor="isGlobal" className="text-sm">Global skill</label>
          </div>
          {!isGlobal && (
            <Select value={skillProjectId} onValueChange={setSkillProjectId}>
              <SelectTrigger className="w-[200px] h-8 text-sm">
                <SelectValue placeholder="Project..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No project</SelectItem>
                {projects.map(p => (
                  <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* Parts */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            Skill Parts ({parts.length})
          </h2>
          <Select onValueChange={(v) => addPart(v as SkillPartType)}>
            <SelectTrigger className="w-[180px] h-8 text-sm">
              <div className="flex items-center gap-1">
                <Plus className="h-3.5 w-3.5" />
                Add Part
              </div>
            </SelectTrigger>
            <SelectContent>
              {SKILL_PART_TYPES.map(t => (
                <SelectItem key={t.value} value={t.value}>
                  <div>
                    <span className="font-medium">{t.label}</span>
                    <span className="text-muted-foreground ml-2 text-xs">{t.description}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {parts.length === 0 && (
          <div className="border border-dashed border-border rounded-lg p-12 text-center text-muted-foreground">
            <p className="text-sm">No parts yet. Add a part to start building this skill.</p>
            <p className="text-xs mt-1">Each part represents a section like Brand Voice, Technical Details, etc.</p>
          </div>
        )}

        {parts.map((part, index) => (
          <SkillPartEditor
            key={part.id}
            part={part}
            onChange={updated => updatePart(index, updated)}
            onDelete={() => deletePart(index)}
            onMoveUp={() => movePart(index, -1)}
            onMoveDown={() => movePart(index, 1)}
            isFirst={index === 0}
            isLast={index === parts.length - 1}
          />
        ))}
      </div>

      {/* Preview */}
      {parts.length > 0 && (
        <div className="border border-border rounded-lg bg-card">
          <button
            onClick={() => setShowPreview(!showPreview)}
            className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium hover:bg-accent/50 transition-colors"
          >
            {showPreview ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <Eye className="h-4 w-4" />
            Preview Composed Skill
          </button>
          {showPreview && (
            <div className="px-4 pb-4 border-t border-border">
              <pre className="mt-3 text-xs font-mono text-muted-foreground whitespace-pre-wrap bg-muted/50 rounded-md p-4 max-h-[400px] overflow-auto">
                {composedContent || 'No content yet'}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
