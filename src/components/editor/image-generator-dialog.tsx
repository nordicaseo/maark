'use client';

import { useState } from 'react';
import NextImage from 'next/image';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, ImageIcon, Sparkles, ExternalLink } from 'lucide-react';

interface ImageGeneratorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsertImage: (url: string, alt: string) => void;
  contextKeyword?: string;
  projectId?: number | null;
}

export function ImageGeneratorDialog({
  open,
  onOpenChange,
  onInsertImage,
  contextKeyword,
  projectId,
}: ImageGeneratorDialogProps) {
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState('natural');
  const [generating, setGenerating] = useState(false);
  const [generatedUrl, setGeneratedUrl] = useState('');
  const [revisedPrompt, setRevisedPrompt] = useState('');
  const [error, setError] = useState('');
  const [manualUrl, setManualUrl] = useState('');
  const [generatedPreviewError, setGeneratedPreviewError] = useState(false);
  const [manualPreviewError, setManualPreviewError] = useState(false);
  const [mode, setMode] = useState<'generate' | 'url'>('generate');

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setGenerating(true);
    setError('');
    setGeneratedUrl('');
    setRevisedPrompt('');
    setGeneratedPreviewError(false);

    try {
      const res = await fetch('/api/ai/images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim(), style, projectId: projectId ?? undefined }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Generation failed');
        return;
      }

      setGeneratedUrl(data.url);
      setRevisedPrompt(data.revisedPrompt || '');
      setGeneratedPreviewError(false);
    } catch {
      setError('Failed to connect to image generation service');
    } finally {
      setGenerating(false);
    }
  };

  const handleInsert = () => {
    if (mode === 'url') {
      if (manualUrl.trim()) {
        onInsertImage(manualUrl.trim(), prompt.trim() || 'Image');
        handleClose();
      }
    } else if (generatedUrl) {
      onInsertImage(generatedUrl, prompt.trim() || 'AI Generated Image');
      handleClose();
    }
  };

  const handleClose = () => {
    setPrompt('');
    setStyle('natural');
    setGeneratedUrl('');
    setRevisedPrompt('');
    setError('');
    setManualUrl('');
    setGeneratedPreviewError(false);
    setManualPreviewError(false);
    setMode('generate');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <ImageIcon className="h-5 w-5" />
            Insert Image
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0">
          {/* Mode toggle */}
          <div className="flex gap-1 p-1 bg-muted rounded-lg mb-4">
            <button
              className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                mode === 'generate'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setMode('generate')}
            >
              <Sparkles className="h-3 w-3 inline mr-1" />
              AI Generate
            </button>
            <button
              className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                mode === 'url'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setMode('url')}
            >
              <ExternalLink className="h-3 w-3 inline mr-1" />
              From URL
            </button>
          </div>

          {mode === 'generate' ? (
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block">Describe the image</label>
                <Textarea
                  placeholder={
                    contextKeyword
                      ? `e.g., A professional photo related to ${contextKeyword}...`
                      : 'e.g., A modern workspace with a laptop, coffee, and plants...'
                  }
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={3}
                  className="resize-none"
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-1.5 block">Style</label>
                <Select value={style} onValueChange={setStyle}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="natural">Natural</SelectItem>
                    <SelectItem value="photographic">Photographic</SelectItem>
                    <SelectItem value="illustration">Illustration</SelectItem>
                    <SelectItem value="minimal">Minimal</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button
                onClick={handleGenerate}
                disabled={generating || !prompt.trim()}
                className="w-full"
              >
                {generating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-2" />
                    Generate Image
                  </>
                )}
              </Button>

              {error && (
                <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
                  {error}
                </p>
              )}

              {generatedUrl && (
                <div className="space-y-2">
                  <div className="relative rounded-lg overflow-hidden border border-border bg-muted">
                    {generatedPreviewError ? (
                      <div className="px-3 py-6 text-xs text-muted-foreground text-center">
                        Could not load generated image preview.
                      </div>
                    ) : (
                      <NextImage
                        src={generatedUrl}
                        alt={prompt || 'Generated image'}
                        width={1024}
                        height={1024}
                        unoptimized
                        className="w-full h-auto max-h-64 object-contain"
                        onError={() => setGeneratedPreviewError(true)}
                      />
                    )}
                  </div>
                  {revisedPrompt && (
                    <p className="text-xs text-muted-foreground italic">
                      DALL-E refined: {revisedPrompt.substring(0, 150)}
                      {revisedPrompt.length > 150 ? '...' : ''}
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block">Image URL</label>
                <Input
                  placeholder="https://example.com/image.jpg"
                  value={manualUrl}
                  onChange={(e) => {
                    setManualUrl(e.target.value);
                    setManualPreviewError(false);
                  }}
                  type="url"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Alt text</label>
                <Input
                  placeholder="Describe the image..."
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                />
              </div>
              {manualUrl && (
                <div className="rounded-lg overflow-hidden border border-border bg-muted">
                  {manualPreviewError ? (
                    <div className="px-3 py-6 text-xs text-muted-foreground text-center">
                      Could not load image preview from URL.
                    </div>
                  ) : (
                    <NextImage
                      src={manualUrl}
                      alt={prompt || 'Preview'}
                      width={1024}
                      height={1024}
                      unoptimized
                      className="w-full h-auto max-h-64 object-contain"
                      onError={() => setManualPreviewError(true)}
                    />
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-border pt-4 shrink-0">
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={handleInsert}
            disabled={mode === 'generate' ? !generatedUrl : !manualUrl.trim()}
          >
            Insert Image
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
