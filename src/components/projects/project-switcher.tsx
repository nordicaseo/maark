'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChevronsUpDown, FolderOpen, Plus, Check, Layers } from 'lucide-react';
import { ProjectDialog } from './project-dialog';
import type { Project } from '@/types/project';

interface ProjectSwitcherProps {
  activeProjectId: number | null;
  onProjectChange: (projectId: number | null) => void;
}

export function ProjectSwitcher({ activeProjectId, onProjectChange }: ProjectSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [showCreate, setShowCreate] = useState(false);

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/projects');
      if (res.ok) setProjects(await res.json());
    } catch {}
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const activeProject = projects.find((p) => p.id === activeProjectId);

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            className="w-full justify-between h-9 px-3 text-xs font-medium"
          >
            <span className="flex items-center gap-2 truncate">
              {activeProject ? (
                <>
                  <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                  {activeProject.name}
                </>
              ) : (
                <>
                  <Layers className="h-3.5 w-3.5 shrink-0" />
                  All Documents
                </>
              )}
            </span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-1" align="start">
          <ScrollArea className="max-h-[300px]">
            <button
              className={`flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-xs hover:bg-accent ${
                activeProjectId === null ? 'bg-accent' : ''
              }`}
              onClick={() => {
                onProjectChange(null);
                setOpen(false);
              }}
            >
              <Layers className="h-3.5 w-3.5" />
              All Documents
              {activeProjectId === null && <Check className="h-3 w-3 ml-auto" />}
            </button>

            {projects.length > 0 && (
              <div className="border-t border-border my-1" />
            )}

            {projects.map((project) => (
              <button
                key={project.id}
                className={`flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-xs hover:bg-accent ${
                  activeProjectId === project.id ? 'bg-accent' : ''
                }`}
                onClick={() => {
                  onProjectChange(project.id);
                  setOpen(false);
                }}
              >
                <FolderOpen className="h-3.5 w-3.5" />
                <span className="truncate">{project.name}</span>
                {activeProjectId === project.id && (
                  <Check className="h-3 w-3 ml-auto shrink-0" />
                )}
              </button>
            ))}
          </ScrollArea>

          <div className="border-t border-border mt-1 pt-1">
            <button
              className="flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-xs hover:bg-accent text-muted-foreground"
              onClick={() => {
                setOpen(false);
                setShowCreate(true);
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              New Project
            </button>
          </div>
        </PopoverContent>
      </Popover>

      <ProjectDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        onSaved={() => {
          fetchProjects();
        }}
      />
    </>
  );
}
