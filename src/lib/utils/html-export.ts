/**
 * Clean TipTap editor HTML for Shopify export.
 * - Strips comment-highlight spans (preserves inner content)
 * - Removes data-comment-id and editor-specific attributes
 * - Removes TipTap-specific classes
 * - Leaves <img src="..." alt="..."> tags intact
 */
export function cleanHtmlForExport(rawHtml: string): string {
  return rawHtml
    // Strip comment mark spans entirely (keep inner content)
    .replace(/<span[^>]*data-comment-id="[^"]*"[^>]*>([\s\S]*?)<\/span>/g, '$1')
    // Remove tiptap-specific class attributes
    .replace(/\s*class="[^"]*tiptap[^"]*"/g, '')
    .replace(/\s*class="[^"]*editor-comment-highlight[^"]*"/g, '')
    .replace(/\s*class="[^"]*comment-highlight[^"]*"/g, '')
    // Remove data attributes
    .replace(/\s*data-[a-z-]+="[^"]*"/g, '')
    // Clean up empty class attributes that might remain
    .replace(/\s*class=""/g, '');
}
