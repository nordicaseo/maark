'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Loader2,
  BarChart3,
  Check,
  Download,
  FileText,
  FileCode,
  FileType,
} from 'lucide-react';
import type { Document, ContentType, DocumentStatus } from '@/types/document';
import { CONTENT_TYPE_LABELS, STATUS_LABELS } from '@/types/document';

interface TopBarProps {
  document: Document | null;
  saveStatus: 'idle' | 'saving' | 'saved';
  analyzing: boolean;
  onAnalyze: () => void;
  onUpdate: (updates: Partial<Document>) => void;
  onExport: (format: 'html' | 'markdown' | 'text') => void;
  leftOpen: boolean;
  rightOpen: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
}

export function TopBar({
  document,
  saveStatus,
  analyzing,
  onAnalyze,
  onUpdate,
  onExport,
  leftOpen,
  rightOpen,
  onToggleLeft,
  onToggleRight,
}: TopBarProps) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState('');

  const handleTitleClick = () => {
    if (!document) return;
    setTitle(document.title);
    setEditingTitle(true);
  };

  const handleTitleBlur = () => {
    if (document && title.trim() && title !== document.title) {
      onUpdate({ title: title.trim() } as Partial<Document>);
    }
    setEditingTitle(false);
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    }
    if (e.key === 'Escape') {
      setEditingTitle(false);
    }
  };

  return (
    <div className="h-14 border-b border-border flex items-center gap-3 px-4 shrink-0">
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={onToggleLeft}
      >
        {leftOpen ? (
          <PanelLeftClose className="h-4 w-4" />
        ) : (
          <PanelLeftOpen className="h-4 w-4" />
        )}
      </Button>

      {document ? (
        <>
          {/* Title */}
          {editingTitle ? (
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={handleTitleBlur}
              onKeyDown={handleTitleKeyDown}
              className="bg-transparent border-b border-primary text-foreground font-medium px-1 py-0.5 outline-none min-w-[200px]"
              autoFocus
            />
          ) : (
            <button
              onClick={handleTitleClick}
              className="font-medium text-foreground hover:text-primary truncate max-w-[300px] text-left"
            >
              {document.title}
            </button>
          )}

          <div className="flex-1" />

          {/* Content Type */}
          <Select
            value={document.contentType}
            onValueChange={(val) =>
              onUpdate({ contentType: val } as Partial<Document>)
            }
          >
            <SelectTrigger className="w-[150px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(CONTENT_TYPE_LABELS).map(([key, label]) => (
                <SelectItem key={key} value={key}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Status */}
          <Select
            value={document.status}
            onValueChange={(val) =>
              onUpdate({ status: val } as Partial<Document>)
            }
          >
            <SelectTrigger className="w-[120px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(STATUS_LABELS).map(([key, label]) => (
                <SelectItem key={key} value={key}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Word Count */}
          <span className="text-xs text-muted-foreground tabular-nums">
            {document.wordCount || 0} words
          </span>

          {/* Save Status */}
          <span className="text-xs text-muted-foreground flex items-center gap-1 w-16">
            {saveStatus === 'saving' && (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                Saving
              </>
            )}
            {saveStatus === 'saved' && (
              <>
                <Check className="h-3 w-3 text-green-500" />
                Saved
              </>
            )}
          </span>

          {/* Export */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 h-8">
                <Download className="h-3.5 w-3.5" />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onExport('html')}>
                <FileCode className="h-4 w-4 mr-2" />
                HTML Document
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onExport('markdown')}>
                <FileType className="h-4 w-4 mr-2" />
                Markdown
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onExport('text')}>
                <FileText className="h-4 w-4 mr-2" />
                Plain Text
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Analyze */}
          <Button
            size="sm"
            onClick={onAnalyze}
            disabled={analyzing || !document.plainText}
            className="gap-1.5"
          >
            {analyzing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <BarChart3 className="h-3.5 w-3.5" />
            )}
            Analyze
          </Button>
        </>
      ) : (
        <div className="flex-1" />
      )}

      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={onToggleRight}
      >
        {rightOpen ? (
          <PanelRightClose className="h-4 w-4" />
        ) : (
          <PanelRightOpen className="h-4 w-4" />
        )}
      </Button>
    </div>
  );
}
