'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Plus, Upload, Sparkles, Pencil, Trash2, BookOpen, Download } from 'lucide-react';
import { SkillEditorDialog } from './skill-editor-dialog';
import { SkillImportDialog } from './skill-import-dialog';
import { SkillGenerateDialog } from './skill-generate-dialog';
import type { Skill } from '@/types/skill';

interface SkillsPanelProps {
  projectId?: number | null;
}

export function SkillsPanel({ projectId }: SkillsPanelProps) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [showEditor, setShowEditor] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);

  const fetchSkills = useCallback(async () => {
    try {
      const url = projectId ? `/api/skills?projectId=${projectId}` : '/api/skills';
      const res = await fetch(url);
      if (res.ok) setSkills(await res.json());
    } catch {}
  }, [projectId]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void fetchSkills();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [fetchSkills]);

  const handleEdit = (skill: Skill) => {
    setEditingSkill(skill);
    setShowEditor(true);
  };

  const handleDelete = async (id: number) => {
    try {
      await fetch(`/api/skills/${id}`, { method: 'DELETE' });
      fetchSkills();
    } catch {}
  };

  const handleExport = (skill: Skill) => {
    const frontmatter = `---\nname: ${skill.name}\ndescription: ${skill.description || ''}\n---\n\n`;
    const content = frontmatter + skill.content;
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement('a');
    a.href = url;
    a.download = `${skill.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const globalSkills = skills.filter((s) => s.isGlobal === 1);
  const projectSkills = skills.filter((s) => s.isGlobal !== 1);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5">
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => { setEditingSkill(null); setShowEditor(true); }}>
          <Plus className="h-3 w-3" />
          New
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setShowImport(true)}>
          <Upload className="h-3 w-3" />
          Import
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setShowGenerate(true)}>
          <Sparkles className="h-3 w-3" />
          Generate
        </Button>
      </div>

      <ScrollArea className="max-h-[400px]">
        <div className="space-y-1">
          {projectSkills.length > 0 && (
            <>
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-1 pt-2">
                Project Skills
              </p>
              {projectSkills.map((skill) => (
                <SkillRow
                  key={skill.id}
                  skill={skill}
                  onEdit={() => handleEdit(skill)}
                  onDelete={() => handleDelete(skill.id)}
                  onExport={() => handleExport(skill)}
                />
              ))}
            </>
          )}

          {globalSkills.length > 0 && (
            <>
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-1 pt-2">
                Global Skills
              </p>
              {globalSkills.map((skill) => (
                <SkillRow
                  key={skill.id}
                  skill={skill}
                  onEdit={() => handleEdit(skill)}
                  onDelete={() => handleDelete(skill.id)}
                  onExport={() => handleExport(skill)}
                />
              ))}
            </>
          )}

          {skills.length === 0 && (
            <div className="text-center py-6 text-muted-foreground">
              <BookOpen className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-xs">No skills yet</p>
              <p className="text-[10px] mt-1">Create, import, or generate a skill to get started</p>
            </div>
          )}
        </div>
      </ScrollArea>

      <SkillEditorDialog
        open={showEditor}
        onOpenChange={setShowEditor}
        onSaved={fetchSkills}
        skill={editingSkill}
        projectId={projectId}
      />
      <SkillImportDialog
        open={showImport}
        onOpenChange={setShowImport}
        onImported={fetchSkills}
        projectId={projectId}
      />
      <SkillGenerateDialog
        open={showGenerate}
        onOpenChange={setShowGenerate}
        onGenerated={fetchSkills}
        projectId={projectId}
      />
    </div>
  );
}

function SkillRow({
  skill,
  onEdit,
  onDelete,
  onExport,
}: {
  skill: Skill;
  onEdit: () => void;
  onDelete: () => void;
  onExport: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent group">
      <BookOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium truncate">{skill.name}</p>
        {skill.description && (
          <p className="text-[10px] text-muted-foreground truncate">{skill.description}</p>
        )}
      </div>
      {skill.isGlobal === 1 && (
        <Badge variant="secondary" className="text-[9px] px-1 py-0 shrink-0">
          Global
        </Badge>
      )}
      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <button onClick={onExport} className="h-5 w-5 flex items-center justify-center hover:text-primary" title="Export">
          <Download className="h-3 w-3" />
        </button>
        <button onClick={onEdit} className="h-5 w-5 flex items-center justify-center hover:text-primary" title="Edit">
          <Pencil className="h-3 w-3" />
        </button>
        <button onClick={onDelete} className="h-5 w-5 flex items-center justify-center hover:text-red-400" title="Delete">
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
