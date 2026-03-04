import { generateHTML, type JSONContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Underline from '@tiptap/extension-underline';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { textToHtml } from '@/lib/utils/html-normalize';

const htmlExtensions = [
  StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }),
  Image,
  Underline,
  Highlight.configure({ multicolor: true }),
  Link.configure({ openOnClick: false }),
  Table.configure({ resizable: false }),
  TableRow,
  TableCell,
  TableHeader,
  TaskList,
  TaskItem,
];

function isTiptapJson(value: unknown): value is JSONContent {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.prototype.hasOwnProperty.call(value, 'type')
  );
}

export function contentToHtml(
  content: unknown,
  fallbackPlainText?: string | null
): string {
  if (typeof content === 'string') {
    return content;
  }

  if (isTiptapJson(content)) {
    try {
      return generateHTML(content, htmlExtensions);
    } catch {
      // Ignore and fallback to plain text.
    }
  }

  if (fallbackPlainText && fallbackPlainText.trim().length > 0) {
    return textToHtml(fallbackPlainText);
  }

  return '';
}
