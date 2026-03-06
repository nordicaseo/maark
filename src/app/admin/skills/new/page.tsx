'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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
  ArrowRight,
  Globe,
  Upload,
  Loader2,
  Plus,
  Trash2,
  Sparkles,
  Save,
} from 'lucide-react';
import { SkillPartEditor } from '@/components/skills/skill-part-editor';
import { SKILL_PART_TYPES } from '@/types/skill-part';
import type { SkillPart, SkillPartType } from '@/types/skill-part';

type WizardStep = 'sources' | 'review' | 'save';

interface GeneratedResult {
  skillName: string;
  skillDescription: string;
  parts: Array<{
    partType: string;
    label: string;
    content: string;
  }>;
}

export default function SkillWizardPage() {
  const router = useRouter();
  const [step, setStep] = useState<WizardStep>('sources');

  // Sources step
  const [urls, setUrls] = useState<string[]>(['']);
  const [files, setFiles] = useState<File[]>([]);
  const [description, setDescription] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState('');

  // Review step
  const [parts, setParts] = useState<SkillPart[]>([]);
  const [skillName, setSkillName] = useState('');
  const [skillDescription, setSkillDescription] = useState('');

  // Save step
  const [isGlobal, setIsGlobal] = useState(false);
  const [projectId, setProjectId] = useState<string>('none');
  const [projects, setProjects] = useState<Array<{ id: number; name: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [addPartPickerKey, setAddPartPickerKey] = useState(0);

  const addUrl = () => setUrls(prev => [...prev, '']);
  const removeUrl = (i: number) => setUrls(prev => prev.filter((_, idx) => idx !== i));
  const updateUrl = (i: number, val: string) =>
    setUrls(prev => prev.map((u, idx) => idx === i ? val : u));

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(prev => [...prev, ...Array.from(e.target.files!)]);
    }
  };

  const removeFile = (i: number) => setFiles(prev => prev.filter((_, idx) => idx !== i));

  const analyze = async () => {
    setAnalyzing(true);
    setError('');

    try {
      const validUrls = urls.filter(u => u.trim());
      let result: GeneratedResult | null = null;

      if (validUrls.length > 0) {
        // Use structured URL analysis
        const res = await fetch('/api/skills/from-url/structured', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            urls: validUrls,
            description: description.trim() || undefined,
            projectId: projectId !== 'none' ? parseInt(projectId, 10) : undefined,
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Failed to analyze URLs');
        }

        result = await res.json();
      } else if (files.length > 0) {
        // Use file analysis
        const formData = new FormData();
        files.forEach(f => formData.append('files', f));
        if (description.trim()) formData.append('description', description.trim());
        if (projectId !== 'none') formData.append('projectId', projectId);

        const res = await fetch('/api/skills/from-files', {
          method: 'POST',
          body: formData,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Failed to analyze files');
        }

        result = await res.json();
      } else if (description.trim()) {
        // Use description-only — returns structured JSON with multiple parts
        const res = await fetch('/api/skills/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            description: description.trim(),
            projectId: projectId !== 'none' ? parseInt(projectId, 10) : undefined,
          }),
        });

        if (!res.ok) throw new Error('Failed to generate skill');

        result = await res.json();
      } else {
        setError('Provide at least one URL, file, or description');
        setAnalyzing(false);
        return;
      }

      if (result) {
        setSkillName(result.skillName || 'New Skill');
        setSkillDescription(result.skillDescription || '');
        setParts(
          result.parts.map((p, i) => ({
            id: -(Date.now() + i),
            skillId: 0,
            partType: p.partType as SkillPartType,
            label: p.label,
            content: p.content,
            sortOrder: i,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }))
        );
        setStep('review');

        // Fetch projects for save step
        fetch('/api/projects').then(r => r.ok ? r.json() : []).then(setProjects).catch(() => {});
      }
    } catch (err: unknown) {
      setError((err as { message?: string })?.message || 'Analysis failed');
    } finally {
      setAnalyzing(false);
    }
  };

  const addPart = (partType: SkillPartType) => {
    const typeInfo = SKILL_PART_TYPES.find(t => t.value === partType);
    setParts(prev => [
      ...prev,
      {
        id: -(Date.now()),
        skillId: 0,
        partType,
        label: typeInfo?.label || 'Custom',
        content: '',
        sortOrder: prev.length,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);
  };

  const handleAddPartType = (partType: string) => {
    addPart(partType as SkillPartType);
    // Reset picker so selecting the same type again continues to work.
    setAddPartPickerKey((prev) => prev + 1);
  };

  const updatePart = (index: number, updated: Partial<SkillPart>) => {
    setParts(prev => prev.map((p, i) => i === index ? { ...p, ...updated } : p));
  };

  const deletePart = (index: number) => {
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

  const handleSave = async () => {
    if (!skillName.trim()) return;
    setSaving(true);

    try {
      // Create the skill
      const composedContent = parts.map(p => `## ${p.label}\n\n${p.content}`).join('\n\n');
      const res = await fetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: skillName.trim(),
          description: skillDescription.trim() || null,
          content: composedContent,
          isGlobal: isGlobal ? 1 : 0,
          projectId: isGlobal ? null : (projectId !== 'none' ? parseInt(projectId) : null),
        }),
      });

      if (!res.ok) throw new Error('Failed to create skill');
      const skill = await res.json();

      // Create parts
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        await fetch(`/api/skills/${skill.id}/parts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            partType: p.partType,
            label: p.label,
            content: p.content,
            sortOrder: i,
          }),
        });
      }

      router.push(`/admin/skills/${skill.id}`);
    } catch (err: unknown) {
      setError((err as { message?: string })?.message || 'Failed to save skill');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.push('/admin/skills')}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Sparkles className="h-5 w-5" /> Auto-Create Skill
        </h1>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-sm">
        {(['sources', 'review', 'save'] as WizardStep[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            {i > 0 && <ArrowRight className="h-3 w-3 text-muted-foreground" />}
            <span
              className={`px-3 py-1 rounded-full text-xs font-medium ${
                step === s
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {i + 1}. {s.charAt(0).toUpperCase() + s.slice(1)}
            </span>
          </div>
        ))}
      </div>

      {error && (
        <div className="text-sm text-red-400 bg-red-500/10 rounded-lg p-3">
          {error}
        </div>
      )}

      {/* Step 1: Sources */}
      {step === 'sources' && (
        <div className="space-y-6">
          {/* URLs */}
          <div className="border border-border rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2 mb-2">
              <Globe className="h-4 w-4 text-muted-foreground" />
              <h3 className="font-medium text-sm">Website URLs</h3>
            </div>
            {urls.map((url, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  value={url}
                  onChange={e => updateUrl(i, e.target.value)}
                  placeholder="https://example.com"
                  className="flex-1"
                />
                {urls.length > 1 && (
                  <Button variant="ghost" size="sm" onClick={() => removeUrl(i)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={addUrl}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add URL
            </Button>
          </div>

          {/* Files */}
          <div className="border border-border rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2 mb-2">
              <Upload className="h-4 w-4 text-muted-foreground" />
              <h3 className="font-medium text-sm">Upload Files</h3>
              <span className="text-xs text-muted-foreground">(.txt, .md)</span>
            </div>
            <input
              type="file"
              multiple
              accept=".txt,.md,.markdown,.csv"
              onChange={handleFileChange}
              className="text-sm"
            />
            {files.length > 0 && (
              <div className="space-y-1">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span className="truncate">{f.name}</span>
                    <span className="text-xs text-muted-foreground">({(f.size / 1024).toFixed(1)}KB)</span>
                    <button onClick={() => removeFile(i)} className="text-red-400 hover:text-red-300">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Description */}
          <div className="border border-border rounded-lg p-4">
            <h3 className="font-medium text-sm mb-2">Additional Context (optional)</h3>
            <Textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Describe the brand, target audience, or any specific instructions..."
              rows={3}
            />
          </div>

          <Button
            onClick={analyze}
            disabled={analyzing || (urls.every(u => !u.trim()) && files.length === 0 && !description.trim())}
            className="w-full"
          >
            {analyzing ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Analyzing...</>
            ) : (
              <><Sparkles className="h-4 w-4 mr-2" /> Analyze &amp; Generate Parts</>
            )}
          </Button>
        </div>
      )}

      {/* Step 2: Review Parts */}
      {step === 'review' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Review Generated Parts ({parts.length})</h2>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setStep('sources')}>
                <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Back
              </Button>
              <Select key={addPartPickerKey} onValueChange={handleAddPartType}>
                <SelectTrigger className="w-[160px] h-8 text-xs">
                  <SelectValue placeholder="Add Part" />
                </SelectTrigger>
                <SelectContent>
                  {SKILL_PART_TYPES.map(t => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

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

          <Button onClick={() => setStep('save')} disabled={parts.length === 0} className="w-full">
            Continue to Save <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </div>
      )}

      {/* Step 3: Save */}
      {step === 'save' && (
        <div className="space-y-4">
          <Button variant="outline" size="sm" onClick={() => setStep('review')}>
            <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Back to Review
          </Button>

          <div className="border border-border rounded-lg p-4 space-y-4 bg-card">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Skill Name</label>
              <Input value={skillName} onChange={e => setSkillName(e.target.value)} placeholder="Skill name..." />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Description</label>
              <Input value={skillDescription} onChange={e => setSkillDescription(e.target.value)} placeholder="Brief description..." />
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Checkbox id="wizGlobal" checked={isGlobal} onCheckedChange={c => setIsGlobal(c === true)} />
                <label htmlFor="wizGlobal" className="text-sm">Global skill</label>
              </div>
              {!isGlobal && (
                <Select value={projectId} onValueChange={setProjectId}>
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

          <div className="text-sm text-muted-foreground">
            This will create a skill with {parts.length} part{parts.length !== 1 ? 's' : ''}.
          </div>

          <Button onClick={handleSave} disabled={saving || !skillName.trim()} className="w-full">
            {saving ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Creating...</>
            ) : (
              <><Save className="h-4 w-4 mr-2" /> Create Skill</>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
